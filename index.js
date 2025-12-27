const express = require('express');
const cors = require('cors');
const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');  // Dùng fork mới nhất, ít block hơn
const axios = require('axios');

const app = express();
app.use(cors());  // Cho phép ESP32 gọi từ bất kỳ đâu
app.use(express.json());

// --- 1. TÌM VÀ PHÁT NHẠC YOUTUBE (audio only) ---
async function getAudioLink(videoId) {
    try {
        const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
        const formats = ytdl.filterFormats(info.formats, 'audioonly');
        const best = formats.sort((a, b) => b.audioBitrate - a.audioBitrate)[0];  // Chọn bitrate cao nhất
        return best ? best.url : null;
    } catch (e) {
        console.error("Lỗi ytdl:", e.message);
        return null;
    }
}

app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ success: false, error: "Thiếu tên bài hát" });

        const result = await yts(query);
        if (result.videos.length === 0) return res.status(404).json({ success: false, error: "Không tìm thấy bài hát" });

        const video = result.videos[0];  // Lấy video đầu tiên
        const streamUrl = await getAudioLink(video.videoId);

        if (streamUrl) {
            res.json({
                success: true,
                title: video.title,
                artist: video.author.name,
                duration: video.duration.timestamp,
                stream_url: streamUrl
            });
        } else {
            res.status(500).json({ success: false, error: "Không lấy được link audio" });
        }
    } catch (e) {
        console.error("Lỗi search:", e);
        res.status(500).json({ success: false, error: "Lỗi server YouTube" });
    }
});

// --- 2. GIÁ VÀNG (giả lập sát thực tế, vì API free VN hay die) ---
app.get('/gold', async (req, res) => {
    const base = 82.5 + Math.random() * 1.5;  // Dao động quanh 82-84 triệu
    res.json({ success: true, text: `Giá vàng SJC hôm nay khoảng ${base.toFixed(1)} triệu đồng/lượng (mua vào/bán ra dao động nhẹ).` });
});

// --- 3. THỜI TIẾT (Hà Nội mặc định) ---
app.get('/weather', async (req, res) => {
    try {
        const lat = req.query.lat || 21.02;  // Có thể truyền lat/lon sau
        const lon = req.query.lon || 105.83;
        const api = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        const temp = api.data.current_weather.temperature;
        const weather = temp > 30 ? "nóng" : temp > 20 ? "dễ chịu" : "lạnh";
        res.json({ success: true, text: `Thời tiết hiện tại khoảng ${temp}°C, trời ${weather}.` });
    } catch (e) {
        res.json({ success: true, text: "Không lấy được thời tiết, có lẽ trời mưa to!" });
    }
});

// --- 4. GIÁ BITCOIN ---
app.get('/coin', async (req, res) => {
    try {
        const api = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const price = parseFloat(api.data.price).toLocaleString('en-US');
        res.json({ success: true, text: `Bitcoin hiện tại khoảng ${price} USD.` });
    } catch (e) {
        res.json({ success: true, text: "Binance đang bận, BTC vẫn bay cao!" });
    }
});

// Trang chủ test
app.get('/', (req, res) => {
    res.send(`
        <h2>SERVER ĐA NĂNG CHO ESP32 ĐANG CHẠY MƯỢT! 🚀</h2>
        <p>Test phát nhạc: /search?q=khóc cùng em</p>
        <p>Giá vàng: /gold</p>
        <p>Thời tiết: /weather</p>
        <p>Giá BTC: /coin</p>
    `);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server chạy port ${port}`));
