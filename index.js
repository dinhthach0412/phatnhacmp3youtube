const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

// --- CẬP NHẬT DANH SÁCH SERVER PIPED MỚI (Tránh kavin.rocks đang lỗi) ---
const PIPED_INSTANCES = [
    "https://pipedapi.drgns.space",       // Server này thường khá ngon
    "https://api.piped.privacy.com.de",
    "https://pipedapi.moomoo.me",
    "https://piped-api.garudalinux.org",
    "https://api.piped.otms.repl.co"
];

// Hàm tìm link gốc
async function getOriginalStream(query) {
    // Fake User-Agent xịn để tìm kiếm không bị chặn
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    for (const baseUrl of PIPED_INSTANCES) {
        try {
            console.log(`Trying server: ${baseUrl}...`);
            const searchRes = await axios.get(`${baseUrl}/search`, {
                params: { q: query, filter: 'music_songs' },
                headers: headers,
                timeout: 5000 
            });

            if (!searchRes.data.items || searchRes.data.items.length === 0) continue;

            const video = searchRes.data.items[0];
            const videoId = video.url.split("/watch?v=")[1];
            
            const streamRes = await axios.get(`${baseUrl}/streams/${videoId}`, { 
                headers: headers,
                timeout: 5000 
            });
            const audioStreams = streamRes.data.audioStreams;

            // Ưu tiên lấy m4a
            let bestAudio = audioStreams.find(s => s.mimeType.includes("audio/mp4"));
            if (!bestAudio) bestAudio = audioStreams.sort((a, b) => b.bitrate - a.bitrate)[0];

            if (bestAudio) {
                console.log(`✅ Tìm thấy tại: ${baseUrl}`);
                return { title: video.title, artist: "Youtube", url: bestAudio.url };
            }
        } catch (e) {
            console.error(`❌ Lỗi tại ${baseUrl}: ${e.message}`);
        }
    }
    return null;
}

// API 1: TÌM KIẾM
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        console.log("ESP32 tìm bài:", query);
        const result = await getOriginalStream(query);
        
        if (result) {
            // Trả về HTTPS cứng
            const myServerUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(result.url)}`;
            return res.json({ success: true, title: result.title, artist: result.artist, url: myServerUrl });
        } else {
            return res.status(404).json({ error: "Not found" });
        }
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// --- API 2: STREAM (DÙNG AXIOS TẢI -> PIPE VÀO FFMPEG) ---
// Cách này khắc phục lỗi 5XX và ffmpeg exit code 1
app.get('/stream', async (req, res) => {
    const audioUrl = req.query.url;
    if (!audioUrl) return res.status(400).send("No URL provided");

    console.log("🚀 Bắt đầu Transcode (Axios -> FFmpeg)...");
    
    // Set Header cho ESP32
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        // BƯỚC 1: Dùng Axios tải luồng nhạc (Giả danh trình duyệt để không bị chặn)
        const response = await axios({
            method: 'get',
            url: audioUrl,
            responseType: 'stream', // Quan trọng: Lấy dạng dòng chảy
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.youtube.com/'
            }
        });

        // BƯỚC 2: Nhét luồng nhạc từ Axios vào FFmpeg
        ffmpeg(response.data)
            .audioCodec('libmp3lame')
            .format('mp3')
            .audioBitrate(128)
            .audioChannels(2)
            .audioFrequency(44100)
            .outputOptions([
                '-preset ultrafast',             
                '-movflags frag_keyframe+empty_moov'
            ])
            .on('error', (err) => {
                // Lỗi client ngắt kết nối thì bỏ qua, lỗi khác thì in ra
                if (err.message && !err.message.includes('Output stream closed')) {
                    console.error('🔥 Lỗi Transcode:', err.message);
                }
            })
            .pipe(res, { end: true }); // Bơm MP3 về cho ESP32

    } catch (error) {
        console.error("❌ Lỗi khi tải nguồn nhạc:", error.message);
        // Nếu link Piped chết, trả về lỗi để ESP32 biết
        if (!res.headersSent) res.status(502).send('Bad Gateway');
    }
});

app.get('/', (req, res) => { res.send('SERVER OK (AXIOS PIPE MODE)'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
