const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

const PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://piped-api.garudalinux.org",
    "https://api.piped.privacy.com.de",
    "https://pipedapi.moomoo.me"
];

async function getOriginalStream(query) {
    for (const baseUrl of PIPED_INSTANCES) {
        try {
            console.log(`Trying server: ${baseUrl}...`);
            const searchRes = await axios.get(`${baseUrl}/search`, {
                params: { q: query, filter: 'music_songs' },
                timeout: 3000
            });

            if (!searchRes.data.items || searchRes.data.items.length === 0) continue;

            const video = searchRes.data.items[0];
            const videoId = video.url.split("/watch?v=")[1];
            
            const streamRes = await axios.get(`${baseUrl}/streams/${videoId}`, { timeout: 3000 });
            const audioStreams = streamRes.data.audioStreams;

            let bestAudio = audioStreams.find(s => s.mimeType.includes("audio/mp4"));
            if (!bestAudio) bestAudio = audioStreams.sort((a, b) => b.bitrate - a.bitrate)[0];

            if (bestAudio) {
                return { title: video.title, artist: "Youtube", url: bestAudio.url, id: videoId };
            }
        } catch (e) {
            console.error(`Skipping ${baseUrl}: ${e.message}`);
        }
    }
    return null;
}

// --- API 1: TÌM KIẾM ---
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        console.log("ESP32 yêu cầu bài:", query);

        const result = await getOriginalStream(query);
        
        if (result) {
            // --- SỬA LỖI 301 TẠI ĐÂY ---
            // Thay req.protocol bằng 'https' cứng
            const myServerUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(result.url)}`;
            
            return res.json({ 
                success: true, 
                title: result.title, 
                artist: result.artist,
                url: myServerUrl 
            });
        } else {
            return res.status(404).json({ error: "Not found" });
        }
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// --- API 2: STREAM & CONVERT (Đã tối ưu tốc độ) ---
app.get('/stream', (req, res) => {
    const audioUrl = req.query.url;
    if (!audioUrl) return res.status(400).send("No URL provided");

    console.log("Đang Transcode sang MP3 (Ultrafast)...");
    res.setHeader('Content-Type', 'audio/mpeg');

    ffmpeg(audioUrl)
        .audioCodec('libmp3lame')
        .format('mp3')
        .audioBitrate(128)     // 128kbps là đủ nghe
        .audioChannels(2)      // Ép Stereo
        .outputOptions([
            '-preset ultrafast',             // QUAN TRỌNG: Chuyển đổi siêu tốc
            '-movflags frag_keyframe+empty_moov' // Tối ưu cho streaming (phát ngay khi có dữ liệu)
        ])
        .on('error', (err) => {
            // Lỗi khi client ngắt kết nối là bình thường, không cần log rác
            if (err.message !== 'Output stream closed') {
                console.error('Lỗi Transcode:', err.message);
            }
            if (!res.headersSent) res.status(500).send('Stream Error');
        })
        .pipe(res, { end: true });
});

// API phụ
app.get('/coin', async (req, res) => { res.json({ text: "Giá Coin Demo" }); });
app.get('/gold', async (req, res) => { res.json({ text: "Giá Vàng Demo" }); });
app.get('/weather', async (req, res) => { res.json({ text: "Thời tiết Demo" }); });
app.get('/', (req, res) => { res.send('SERVER OK (HTTPS FIXED) 🚀'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
