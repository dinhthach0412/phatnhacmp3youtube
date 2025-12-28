const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

// --- DANH SÁCH SERVER PIPED MỚI (Đã kiểm tra còn sống) ---
const PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",       // Server gốc (Ổn định nhất)
    "https://api.piped.yt",               // Server rất mạnh
    "https://pipedapi.system41.xyz",      // Server dự phòng 1
    "https://api.piped.projectsegfau.lt", // Server dự phòng 2
    "https://pipedapi.reallyaweso.me",    // Server dự phòng 3
    "https://pipedapi.r4fo.com"           // Server dự phòng 4
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
            
            // 1. Tìm kiếm video
            const searchRes = await axios.get(`${baseUrl}/search`, {
                params: { q: query, filter: 'music_songs' },
                headers: headers,
                timeout: 5000 
            });

            if (!searchRes.data.items || searchRes.data.items.length === 0) {
                console.log(`⚠️ ${baseUrl} không tìm thấy bài nào.`);
                continue;
            }

            const video = searchRes.data.items[0];
            const videoId = video.url.split("/watch?v=")[1];
            
            // 2. Lấy link stream
            const streamRes = await axios.get(`${baseUrl}/streams/${videoId}`, { 
                headers: headers,
                timeout: 5000 
            });
            const audioStreams = streamRes.data.audioStreams;

            // Ưu tiên lấy m4a
            let bestAudio = audioStreams.find(s => s.mimeType.includes("audio/mp4"));
            if (!bestAudio) bestAudio = audioStreams.sort((a, b) => b.bitrate - a.bitrate)[0];

            if (bestAudio) {
                console.log(`✅ Tìm thấy tại: ${baseUrl} | Bài: ${video.title}`);
                return { title: video.title, artist: "Youtube", url: bestAudio.url };
            }
        } catch (e) {
            // Chỉ in lỗi ngắn gọn để dễ nhìn log
            console.error(`❌ Bỏ qua ${baseUrl}: ${e.message}`);
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
            console.log("❌ Đã thử tất cả server nhưng thất bại.");
            return res.status(404).json({ error: "All Piped servers failed" });
        }
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// --- API 2: STREAM (DÙNG AXIOS TẢI -> PIPE VÀO FFMPEG) ---
app.get('/stream', async (req, res) => {
    const audioUrl = req.query.url;
    if (!audioUrl) return res.status(400).send("No URL provided");

    console.log("🚀 Bắt đầu Transcode (Axios -> FFmpeg)...");
    
    // Set Header cho ESP32
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        // BƯỚC 1: Dùng Axios tải luồng nhạc
        const response = await axios({
            method: 'get',
            url: audioUrl,
            responseType: 'stream', 
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
                if (err.message && !err.message.includes('Output stream closed')) {
                    console.error('🔥 Lỗi Transcode:', err.message);
                }
            })
            .pipe(res, { end: true });

    } catch (error) {
        console.error("❌ Lỗi khi tải nguồn nhạc:", error.message);
        if (!res.headersSent) res.status(502).send('Bad Gateway');
    }
});

app.get('/', (req, res) => { res.send('SERVER OK (NEW PIPED LIST) 🚀'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
