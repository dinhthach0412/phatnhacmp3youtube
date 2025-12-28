const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

// --- DANH SÁCH SERVER PIPED (DỰ PHÒNG KHI LINK CHẾT) ---
const PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://piped-api.garudalinux.org",
    "https://api.piped.privacy.com.de",
    "https://pipedapi.moomoo.me",
    "https://api.piped.otms.repl.co"
];

// Hàm tìm link nhạc (Tự động thử server khác nếu lỗi)
async function getStreamFromPiped(query) {
    for (const baseUrl of PIPED_INSTANCES) {
        try {
            console.log(`Trying server: ${baseUrl}...`);
            
            // 1. Tìm kiếm bài hát
            const searchRes = await axios.get(`${baseUrl}/search`, {
                params: { q: query, filter: 'music_songs' },
                timeout: 4000 // Đợi tối đa 4 giây
            });

            if (!searchRes.data.items || searchRes.data.items.length === 0) {
                console.log(`Server ${baseUrl} không tìm thấy bài nào.`);
                continue; // Thử server tiếp theo
            }

            const video = searchRes.data.items[0];
            const videoId = video.url.split("/watch?v=")[1];
            console.log(`✅ Thấy bài: ${video.title} (${videoId})`);

            // 2. Lấy link Stream âm thanh
            const streamRes = await axios.get(`${baseUrl}/streams/${videoId}`, { timeout: 4000 });
            const audioStreams = streamRes.data.audioStreams;

            if (!audioStreams || audioStreams.length === 0) continue;

            // --- QUAN TRỌNG: LỌC LẤY FILE M4A (AAC) CHO ESP32 ---
            // ESP32 chơi file .m4a (AAC) rất tốt, nhưng chơi .webm (Opus) rất tệ
            let bestAudio = audioStreams.find(s => s.mimeType.includes("audio/mp4"));

            // Nếu không có mp4 thì đành lấy file chất lượng cao nhất (hên xui)
            if (!bestAudio) {
                console.log("⚠️ Không có M4A, dùng tạm stream khác...");
                bestAudio = audioStreams.sort((a, b) => b.bitrate - a.bitrate)[0];
            }

            if (bestAudio) {
                console.log(`🎯 Chọn stream: ${bestAudio.mimeType} | Server: ${baseUrl}`);
                return { title: video.title, url: bestAudio.url };
            }

        } catch (e) {
            console.error(`❌ Server ${baseUrl} lỗi: ${e.message}`);
            // Lỗi thì vòng lặp sẽ tự nhảy sang server tiếp theo trong danh sách
        }
    }
    return null; // Thử hết danh sách mà vẫn thất bại
}

// --- API 1: TÌM NHẠC CHO ESP32 ---
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: "Thiếu query" });
        
        const result = await getStreamFromPiped(query);
        
        if (result) {
            // Trả về JSON chuẩn cho ESP32
            return res.json({ 
                success: true, 
                title: result.title, 
                url: result.url 
            });
        } else {
            return res.status(404).json({ error: "Không tìm thấy hoặc Server bận" });
        }
    } catch (e) { 
        res.status(500).json({ error: "Lỗi Server nội bộ" }); 
    }
});

// --- API 2: GIÁ COIN (Binance) ---
app.get('/coin', async (req, res) => {
    try {
        let symbol = req.query.symbol || "BTC";
        symbol = symbol.toUpperCase();
        if (symbol === "BITCOIN") symbol = "BTC";
        if (symbol === "ETHER" || symbol === "ETHEREUM") symbol = "ETH";
        
        const pair = symbol + "USDT";
        const url = `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`;
        const response = await axios.get(url);
        const price = parseFloat(response.data.price);
        const priceStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price);
        
        res.json({ text: `Giá ${symbol} hiện tại là ${priceStr} (theo Binance).` });
    } catch (e) { res.json({ text: "Không tìm thấy giá đồng coin này." }); }
});

// --- API 3: TỶ GIÁ NGOẠI TỆ ---
app.get('/currency', async (req, res) => {
    try {
        let from = req.query.from || "USD";
        let to = req.query.to || "VND";
        from = from.toUpperCase(); to = to.toUpperCase();

        const url = `https://api.exchangerate-api.com/v4/latest/${from}`;
        const response = await axios.get(url);
        const rate = response.data.rates[to];
        
        if (rate) {
            const rateStr = new Intl.NumberFormat('vi-VN').format(rate);
            res.json({ text: `1 ${from} đổi được khoảng ${rateStr} ${to}.` });
        } else { res.json({ text: `Không tìm thấy tỷ giá.` }); }
    } catch (e) { res.json({ text: "Lỗi lấy tỷ giá." }); }
});

// --- API 4: GIÁ VÀNG (Giả lập tham khảo) ---
app.get('/gold', async (req, res) => {
    // Vì API vàng miễn phí rất hiếm, ta dùng giá cơ sở + dao động ngẫu nhiên để demo
    const basePrice = 82; 
    const fluctuation = (Math.random() * 2).toFixed(1); 
    res.json({ text: `Giá vàng SJC khoảng ${parseFloat(basePrice) + parseFloat(fluctuation)} triệu đồng.` });
});

// --- API 5: THỜI TIẾT ---
app.get('/weather', async (req, res) => {
    try {
        // Mặc định Hà Nội (21.02, 105.83). Bạn có thể sửa tọa độ.
        const r = await axios.get('https://api.open-meteo.com/v1/forecast?latitude=21.02&longitude=105.83&current_weather=true');
        res.json({ text: `Nhiệt độ hiện tại khoảng ${r.data.current_weather.temperature} độ C.` });
    } catch (e) { res.json({ text: "Không lấy được thông tin thời tiết." }); }
});

// Kiểm tra Server sống hay chết
app.get('/', (req, res) => res.send('SERVER XIAOZHI VIETNAM OK!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server Running on port ${PORT}...`));
