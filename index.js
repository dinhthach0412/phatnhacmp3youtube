const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

// Danh sách các Server Piped (Dự phòng nếu cái chính bị sập)
const PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://api.piped.otms.repl.co",
    "https://pipedapi.moomoo.me"
];

// Hàm tìm link nhạc qua Piped
async function getStreamFromPiped(query) {
    const baseUrl = PIPED_INSTANCES[0]; // Dùng server chính

    try {
        console.log(`🔍 Piped đang tìm: ${query}`);
        
        // 1. Tìm kiếm Video ID
        const searchRes = await axios.get(`${baseUrl}/search?q=${encodeURIComponent(query)}&filter=music_songs`);
        
        if (!searchRes.data.items || searchRes.data.items.length === 0) {
            return null;
        }

        // Lấy video đầu tiên
        const video = searchRes.data.items[0];
        const videoId = video.url.split("/watch?v=")[1];
        
        console.log(`✅ Thấy bài: ${video.title} (${videoId})`);

        // 2. Lấy link Stream
        const streamRes = await axios.get(`${baseUrl}/streams/${videoId}`);
        const audioStreams = streamRes.data.audioStreams;

        // Lọc lấy file m4a hoặc mp3, sắp xếp bitrate cao nhất
        const bestAudio = audioStreams.sort((a, b) => b.bitrate - a.bitrate)[0];

        if (bestAudio) {
            return {
                title: video.title,
                url: bestAudio.url
            };
        }
        return null;

    } catch (e) {
        console.error("Lỗi Piped:", e.message);
        return null;
    }
}

// API CHÍNH
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: "Thiếu query" });

        const result = await getStreamFromPiped(query);

        if (result) {
            return res.json({
                success: true,
                title: result.title,
                url: result.url
            });
        } else {
            return res.status(404).json({ error: "Không tìm thấy bài hát" });
        }
    } catch (e) {
        res.status(500).json({ error: "Lỗi Server Nội Bộ" });
    }
});

// GIỮ NGUYÊN CÁC API PHỤ
app.get('/gold', async (req, res) => {
    const basePrice = 82; 
    const fluctuation = (Math.random() * 2).toFixed(1); 
    res.json({ text: `Giá vàng SJC khoảng ${parseFloat(basePrice) + parseFloat(fluctuation)} triệu đồng.` });
});

app.get('/weather', async (req, res) => {
    try {
        const r = await axios.get('https://api.open-meteo.com/v1/forecast?latitude=21.02&longitude=105.83&current_weather=true');
        res.json({ text: `Nhiệt độ khoảng ${r.data.current_weather.temperature} độ C.` });
    } catch (e) { res.json({ text: "Lỗi thời tiết." }); }
});

app.get('/', (req, res) => res.send('SERVER PIPED READY!'));
app.listen(process.env.PORT || 3000, () => console.log("Server OK"));
