const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

// --- DANH SÁCH SERVER PIPED ---
const PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://piped-api.garudalinux.org",
    "https://api.piped.privacy.com.de",
    "https://pipedapi.moomoo.me"
];

// Hàm tìm link gốc (AAC/M4A)
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

            // Lấy link M4A hoặc bitrate cao nhất
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

// --- API 1: TÌM KIẾM (Robot gọi cái này) ---
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        console.log("ESP32 yêu cầu bài:", query);

        const result = await getOriginalStream(query);
        
        if (result) {
            // Thay vì trả về link Youtube, ta trả về link của CHÍNH SERVER NÀY
            // Để server này làm nhiệm vụ chuyển đổi sang MP3
            const myServerUrl = `${req.protocol}://${req.get('host')}/stream?url=${encodeURIComponent(result.url)}`;
            
            return res.json({ 
                success: true, 
                title: result.title, 
                artist: result.artist,
                url: myServerUrl // Robot sẽ gọi lại route /stream ở dưới
            });
        } else {
            return res.status(404).json({ error: "Not found" });
        }
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// --- API 2: STREAM & CONVERT TO MP3 (Quan trọng nhất) ---
app.get('/stream', (req, res) => {
    const audioUrl = req.query.url;
    if (!audioUrl) return res.status(400).send("No URL provided");

    console.log("Đang Transcode sang MP3...");

    // Thiết lập Header để Robot hiểu đây là file MP3
    res.setHeader('Content-Type', 'audio/mpeg');

    // Dùng FFmpeg chuyển đổi AAC -> MP3 và stream thẳng cho Robot
    ffmpeg(audioUrl)
        .format('mp3')
        .audioCodec('libmp3lame')
        .audioBitrate(128) // 128kbps là đủ cho ESP32
        .on('error', (err) => {
            console.error('Lỗi Transcode:', err.message);
            if (!res.headersSent) res.status(500).send('Stream Error');
        })
        .pipe(res, { end: true });
});

// --- API GIÁ VÀNG/COIN GIỮ NGUYÊN ---
app.get('/coin', async (req, res) => { /* Giữ nguyên code cũ của bạn */ 
    res.json({ text: "Giá Coin Demo" }); 
});
app.get('/gold', async (req, res) => { 
    res.json({ text: "Giá Vàng Demo" }); 
});
app.get('/weather', async (req, res) => { 
    res.json({ text: "Thời tiết Demo" }); 
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server MP3 Converter running on port ${PORT}`));
