const express = require('express');
const cors = require('cors');
const yts = require('yt-search');
const play = require('play-dl');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. TÌM VÀ PHÁT NHẠC YOUTUBE (dùng play-dl - ổn định hơn ytdl-core) ---
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ success: false, error: "Thiếu tên bài hát" });

        // Tìm video YouTube
        const result = await yts(query);
        if (result.videos.length === 0) return res.status(404).json({ success: false, error: "Không tìm thấy bài hát" });

        const video = result.videos[0];  // Lấy video đầu tiên
        const videoUrl = video.url;     // https://www.youtube.com/watch?v=...

        // Lấy stream audio từ play-dl
        const stream = await play.stream(videoUrl, { quality: 0 });  // quality 0 = cao nhất

        if (stream && stream.stream) {
            res.json({
                success: true,
                title: video.title,
                artist: video.author.name,
                duration: video.duration.timestamp,
                stream_url: stream.stream.url  // Link direct MP3/Opus
            });
        } else {
            res.status(500).json({ success: false, error: "Không lấy được link audio (play-dl lỗi)" });
        }
    } catch (e) {
        console.error("Lỗi search/play-dl:", e.message);
        res.status(500).json({ success: false, error: "Lỗi server YouTube" });
    }
});

// --- Các phần còn lại giữ nguyên (giá vàng, thời tiết, coin) ---
app.get('/gold', async (req, res) => {
    const base = 82.5 + Math.random() * 1.5;
    res.json({ success: true, text: `Giá vàng SJC hôm nay khoảng ${base.toFixed(1)} triệu đồng/lượng.` });
});

app.get('/weather', async (req, res) => {
    try {
        const lat = req.query.lat || 21.02;
        const lon = req.query.lon || 105.83;
        const api = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        const temp = api.data.current_weather.temperature;
        const weather = temp > 30 ? "nóng" : temp > 20 ? "dễ chịu" : "lạnh";
        res.json({ success: true, text: `Thời tiết hiện tại khoảng ${temp}°C, trời ${weather}.` });
    } catch (e) {
        res.json({ success: true, text: "Không lấy được thời tiết!" });
    }
});

app.get('/coin', async (req, res) => {
    try {
        const api = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const price = parseFloat(api.data.price).toLocaleString('en-US');
        res.json({ success: true, text: `Bitcoin hiện tại khoảng ${price} USD.` });
    } catch (e) {
        res.json({ success: true, text: "Binance đang bận!" });
    }
});

app.get('/', (req, res) => {
    res.send(`
        <h2>SERVER ĐA NĂNG CHO ESP32 ĐANG CHẠY MƯỢT! 🚀</h2>
        <p>Test nhạc YouTube: /search?q=khóc cùng em</p>
        <p>Giá vàng: /gold</p>
        <p>Thời tiết: /weather</p>
        <p>Giá BTC: /coin</p>
    `);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server chạy port ${port}`));
