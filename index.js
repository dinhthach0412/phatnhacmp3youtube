const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

// --- CẤU HÌNH PIPED ---
const PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://api.piped.otms.repl.co",
    "https://pipedapi.moomoo.me"
];

async function getStreamFromPiped(query) {
    const baseUrl = PIPED_INSTANCES[0];
    try {
        console.log(`🔍 Piped đang tìm: ${query}`);
        const searchRes = await axios.get(`${baseUrl}/search?q=${encodeURIComponent(query)}&filter=music_songs`);
        
        if (!searchRes.data.items || searchRes.data.items.length === 0) return null;

        const video = searchRes.data.items[0];
        const videoId = video.url.split("/watch?v=")[1];
        console.log(`✅ Thấy bài: ${video.title} (${videoId})`);

        const streamRes = await axios.get(`${baseUrl}/streams/${videoId}`);
        const audioStreams = streamRes.data.audioStreams;
        const bestAudio = audioStreams.sort((a, b) => b.bitrate - a.bitrate)[0];

        if (bestAudio) {
            return { title: video.title, url: bestAudio.url };
        }
        return null;
    } catch (e) {
        console.error("Lỗi Piped:", e.message);
        return null;
    }
}

// --- API 1: TÌM NHẠC ---
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: "Thiếu query" });
        const result = await getStreamFromPiped(query);
        if (result) return res.json({ success: true, title: result.title, url: result.url });
        else return res.status(404).json({ error: "Không tìm thấy bài hát" });
    } catch (e) { res.status(500).json({ error: "Lỗi Server" }); }
});

// --- API 2: GIÁ COIN ---
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

// --- API 4: GIÁ VÀNG ---
app.get('/gold', async (req, res) => {
    const basePrice = 82; 
    const fluctuation = (Math.random() * 2).toFixed(1); 
    res.json({ text: `Giá vàng SJC khoảng ${parseFloat(basePrice) + parseFloat(fluctuation)} triệu đồng.` });
});

// --- API 5: THỜI TIẾT ---
app.get('/weather', async (req, res) => {
    try {
        const r = await axios.get('https://api.open-meteo.com/v1/forecast?latitude=21.02&longitude=105.83&current_weather=true');
        res.json({ text: `Nhiệt độ khoảng ${r.data.current_weather.temperature} độ C.` });
    } catch (e) { res.json({ text: "Lỗi thời tiết." }); }
});

app.get('/', (req, res) => res.send('SERVER OK!'));
app.listen(process.env.PORT || 3000, () => console.log("Server Running..."));
