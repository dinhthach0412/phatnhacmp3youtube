const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

// Danh sách Server Piped (Đã cập nhật các server ổn định hơn)
const PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://api.piped.privacy.com.de",
    "https://pipedapi.moomoo.me",
    "https://piped-api.garudalinux.org"
];

async function getOriginalStream(query) {
    for (const baseUrl of PIPED_INSTANCES) {
        try {
            console.log(`Trying server: ${baseUrl}...`);
            const searchRes = await axios.get(`${baseUrl}/search`, {
                params: { q: query, filter: 'music_songs' },
                timeout: 4000 
            });

            if (!searchRes.data.items || searchRes.data.items.length === 0) continue;

            const video = searchRes.data.items[0];
            const videoId = video.url.split("/watch?v=")[1];
            
            const streamRes = await axios.get(`${baseUrl}/streams/${videoId}`, { timeout: 4000 });
            const audioStreams = streamRes.data.audioStreams;

            let bestAudio = audioStreams.find(s => s.mimeType.includes("audio/mp4"));
            if (!bestAudio) bestAudio = audioStreams.sort((a, b) => b.bitrate - a.bitrate)[0];

            if (bestAudio) {
                console.log(`✅ Tìm thấy link gốc tại: ${baseUrl}`);
                return { title: video.title, artist: "Youtube", url: bestAudio.url, id: videoId };
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
            // Trả về HTTPS cứng để tránh lỗi 301
            const myServerUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(result.url)}`;
            return res.json({ success: true, title: result.title, artist: result.artist, url: myServerUrl });
        } else {
            return res.status(404).json({ error: "Not found" });
        }
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// API 2: STREAM & CONVERT (FIX LỖI 0 BYTES)
app.get('/stream', (req, res) => {
    const audioUrl = req.query.url;
    if (!audioUrl) return res.status(400).send("No URL provided");

    console.log("🚀 Bắt đầu Transcode...");
    
    // Thiết lập Header ngay lập tức để ESP32 không đợi
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    ffmpeg(audioUrl)
        // QUAN TRỌNG: Fake User-Agent để không bị chặn kết nối đầu vào
        .inputOptions([
            '-headers', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5'
        ])
        .audioCodec('libmp3lame')
        .format('mp3')
        .audioBitrate(128)
        .audioChannels(2)
        .audioFrequency(44100) // Chuẩn hóa tần số lấy mẫu
        .outputOptions([
            '-preset ultrafast',             
            '-movflags frag_keyframe+empty_moov'
        ])
        // Log để xem FFmpeg có chạy không hay chết đứng
        .on('start', (commandLine) => {
            console.log('Spawned Ffmpeg with command: ' + commandLine);
        })
        .on('progress', (progress) => {
            // In ra tiến độ để biết nhạc đang chảy (chỉ in mỗi khi xử lý được 1 đoạn)
            if (progress.timemark) console.log('Processing: ' + progress.timemark);
        })
        .on('error', (err) => {
            console.error('🔥 Lỗi Transcode:', err.message);
            if (!res.headersSent) res.status(500).send('Stream Error');
        })
        .on('end', () => {
            console.log('✅ Kết thúc Transcode.');
        })
        .pipe(res, { end: true });
});

app.get('/', (req, res) => { res.send('SERVER OK (USER-AGENT FIXED)'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
