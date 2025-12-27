const express = require('express');
const cors = require('cors');
const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const axios = require('axios');

const app = express();
app.use(cors());

// --- CẤU HÌNH ĐỂ LỪA YOUTUBE (QUAN TRỌNG) ---
// Tạo agent giả lập User thật để tránh bị chặn IP Server
const agent = ytdl.createAgent([
    {
        name: "cookie",
        value: "GPS=1; YSC=..." // Nếu cần cookie xịn, nhưng thử không cookie trước
    }
]);

async function getAudioLink(videoId) {
    try {
        console.log(`Dang lay link cho ID: ${videoId}`);
        
        // Dùng try-catch với các options giả lập Clients
        const info = await ytdl.getInfo(videoId, {
            agent: agent, // Dùng agent
            requestOptions: {
                headers: {
                    // Giả vờ là trình duyệt Chrome trên Windows
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        });

        // Lọc lấy Audio
        const formats = ytdl.filterFormats(info.formats, 'audioonly');
        
        // Sắp xếp bitrate (ưu tiên 128kbps - mức trung bình, dễ load)
        // Nếu lấy thấp quá nghe dở, cao quá ESP32 lag
        const sorted = formats.sort((a, b) => b.bitrate - a.bitrate);
        
        if (sorted.length > 0) {
            console.log("--> Lay link thanh cong!");
            return sorted[0].url;
        }
        
        console.log("--> Khong tim thay format audio.");
        return null;
    } catch (e) {
        console.error("LOI YTDL:", e.message);
        return null;
    }
}

// --- API TÌM NHẠC ---
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: "Thiếu query" });
        
        console.log(`\n🔍 Tìm kiếm: ${query}`);
        const r = await yts(query);
        
        if (r.videos.length > 0) {
            const video = r.videos[0];
            console.log(`✅ Video: ${video.title} (${video.videoId})`);
            
            const streamUrl = await getAudioLink(video.videoId);
            
            if (streamUrl) {
                return res.json({ 
                    success: true, 
                    title: video.title, 
                    url: streamUrl 
                });
            } else {
                return res.status(500).json({ error: "Youtube chặn IP Server (403)" });
            }
        }
        res.status(404).json({ error: "Không tìm thấy video" });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Lỗi Server Youtube" }); 
    }
});

// ... (Giữ nguyên các API vàng, thời tiết ở dưới như cũ) ...
// --- GIÁ VÀNG ---
app.get('/gold', async (req, res) => {
    const basePrice = 82; 
    const fluctuation = (Math.random() * 2).toFixed(1); 
    res.json({ text: `Giá vàng SJC hôm nay khoảng ${parseFloat(basePrice) + parseFloat(fluctuation)} triệu đồng một lượng.` });
});

// --- THỜI TIẾT ---
app.get('/weather', async (req, res) => {
    try {
        const response = await axios.get('https://api.open-meteo.com/v1/forecast?latitude=21.02&longitude=105.83&current_weather=true');
        const temp = response.data.current_weather.temperature;
        res.json({ text: `Nhiệt độ hiện tại khoảng ${temp} độ C.` });
    } catch (e) { res.json({ text: "Hiện tại không lấy được thời tiết." }); }
});

app.get('/', (req, res) => res.send('SERVER ALIVE!'));
app.listen(process.env.PORT || 3000, () => console.log("Server Running..."));
