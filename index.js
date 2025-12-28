const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

// --- DANH SÁCH "VÉT CẠN" (Mix giữa Piped và các Mirror lạ) ---
// Server lạ thường ít chặn IP Render hơn server nổi tiếng
const PIPED_INSTANCES = [
    "https://pipedapi.tokhmi.xyz",       // Server này thường dễ tính
    "https://api.piped.privacydev.net",
    "https://pipedapi.smnz.de",
    "https://api.piped.ug",
    "https://pipedapi.adminforge.de",
    "https://pipedapi.ducks.party",
    "https://api.piped.projectsegfau.lt",
    "https://pipedapi.kavin.rocks",      // Để lại nhưng xếp sau
    "https://api.piped.yt",
    "https://pipedapi.moomoo.me",
    "https://piped-api.garudalinux.org",
    "https://pa.il.ax",
    "https://pipedapi.r4fo.com",
    "https://api.piped.sh"
];

// Hàm tìm link gốc
async function getOriginalStream(query) {
    // Fake User-Agent random để tránh bị phát hiện là 1 bot cố định
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];

    for (const baseUrl of PIPED_INSTANCES) {
        try {
            const randomAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
            const headers = { 'User-Agent': randomAgent };
            
            console.log(`Trying: ${baseUrl}...`);
            
            // 1. Tìm kiếm (Bỏ filter music_songs để tìm rộng hơn, tránh bị trả về rỗng)
            const searchRes = await axios.get(`${baseUrl}/search`, {
                params: { q: query }, // Bỏ filter để dễ tìm ra kết quả hơn
                headers: headers,
                timeout: 3500 // Giảm timeout xuống để lướt qua server chết nhanh hơn
            });

            if (!searchRes.data.items || searchRes.data.items.length === 0) {
                // console.log(`   -> ${baseUrl}: Không có kết quả.`);
                continue;
            }

            // Lọc lấy video đầu tiên (bỏ qua playlist/channel)
            const video = searchRes.data.items.find(item => item.type === 'stream');
            if (!video) continue;

            const videoId = video.url.split("/watch?v=")[1];
            
            // 2. Lấy link stream
            const streamRes = await axios.get(`${baseUrl}/streams/${videoId}`, { 
                headers: headers,
                timeout: 3500 
            });
            const audioStreams = streamRes.data.audioStreams;

            // Ưu tiên lấy m4a
            let bestAudio = audioStreams.find(s => s.mimeType.includes("audio/mp4"));
            if (!bestAudio) bestAudio = audioStreams.sort((a, b) => b.bitrate - a.bitrate)[0];

            if (bestAudio) {
                console.log(`✅ THÀNH CÔNG TẠI: ${baseUrl} | Bài: ${video.title}`);
                return { title: video.title, artist: "Youtube", url: bestAudio.url };
            }
        } catch (e) {
            // Không in lỗi chi tiết nữa để đỡ rác log, chỉ in mã lỗi
            const status = e.response ? e.response.status : e.code;
            console.log(`   ❌ Fail: ${baseUrl} (${status})`);
        }
    }
    return null;
}

// API 1: TÌM KIẾM
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        console.log("🔍 ESP32 đang tìm:", query);
        const result = await getOriginalStream(query);
        
        if (result) {
            const myServerUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(result.url)}`;
            return res.json({ success: true, title: result.title, artist: result.artist, url: myServerUrl });
        } else {
            console.log("💀 CHẾT CẢ DÀN SERVER: Không tìm được bài nào.");
            return res.status(404).json({ error: "All servers failed" });
        }
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// API 2: STREAM (DÙNG AXIOS TẢI -> PIPE VÀO FFMPEG)
app.get('/stream', async (req, res) => {
    const audioUrl = req.query.url;
    if (!audioUrl) return res.status(400).send("No URL provided");

    console.log("🚀 Transcode (Axios -> FFmpeg)...");
    
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        const response = await axios({
            method: 'get',
            url: audioUrl,
            responseType: 'stream', 
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        ffmpeg(response.data)
            .audioCodec('libmp3lame')
            .format('mp3')
            .audioBitrate(128)
            .audioChannels(2)
            .audioFrequency(44100)
            .outputOptions(['-preset ultrafast', '-movflags frag_keyframe+empty_moov'])
            .on('error', (err) => {
                if (err.message && !err.message.includes('Output stream closed')) {
                    console.error('🔥 Lỗi Transcode:', err.message);
                }
            })
            .pipe(res, { end: true });

    } catch (error) {
        console.error("❌ Lỗi tải nhạc nguồn:", error.message);
        if (!res.headersSent) res.status(502).send('Bad Gateway');
    }
});

app.get('/', (req, res) => { res.send('SERVER ALIVE (MULTI-MIRROR) 🚀'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
