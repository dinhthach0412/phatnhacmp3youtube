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
// 💰 API 1: XEM GIÁ COIN (Binance)
// Gọi: /coin?symbol=BTC
app.get('/coin', async (req, res) => {
    try {
        let symbol = req.query.symbol || "BTC";
        symbol = symbol.toUpperCase();
        
        // Mẹo: Nếu user nói "Bitcoin" -> Chuyển thành BTC, "Ether" -> ETH
        if (symbol === "BITCOIN") symbol = "BTC";
        if (symbol === "ETHER" || symbol === "ETHEREUM") symbol = "ETH";
        if (symbol === "USDT") symbol = "USDT"; // Giá USDT/VND thì hơi khó lấy chính xác trên binance quốc tế, thường lấy qua P2P, nhưng lấy tạm giá global

        // Gọi Binance API (Cặp giao dịch với USDT)
        const pair = symbol + "USDT";
        const url = `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`;
        
        const response = await axios.get(url);
        const price = parseFloat(response.data.price);
        
        // Format giá đẹp ($95,000.00)
        const priceStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price);
        
        res.json({ 
            text: `Giá ${symbol} hiện tại là ${priceStr} (theo Binance).` 
        });

    } catch (e) {
        console.error(e);
        res.json({ text: "Không tìm thấy giá đồng coin này trên Binance." });
    }
});

// 💱 API 2: TỶ GIÁ NGOẠI TỆ (Dùng API Free)
// Gọi: /currency?from=USD&to=VND
app.get('/currency', async (req, res) => {
    try {
        let from = req.query.from || "USD";
        let to = req.query.to || "VND";
        from = from.toUpperCase();
        to = to.toUpperCase();

        // API miễn phí (cập nhật hàng ngày)
        const url = `https://api.exchangerate-api.com/v4/latest/${from}`;
        const response = await axios.get(url);
        
        const rate = response.data.rates[to];
        if (rate) {
            // Format số tiền (25,000)
            const rateStr = new Intl.NumberFormat('vi-VN').format(rate);
            res.json({ 
                text: `1 ${from} đổi được khoảng ${rateStr} ${to}.` 
            });
        } else {
            res.json({ text: `Không tìm thấy tỷ giá từ ${from} sang ${to}.` });
        }

    } catch (e) {
        res.json({ text: "Lỗi lấy tỷ giá ngoại tệ." });
    }
});

    // 🪙 CÔNG CỤ 4: GIÁ COIN (BINANCE)
    AddTool("self.finance.coin", 
        "Tra cứu giá tiền ảo (Crypto) từ Binance.\n"
        "Dùng khi hỏi: 'giá bitcoin', 'eth bao nhiêu', 'giá coin hôm nay'.", 
        PropertyList({
            Property("symbol", kPropertyTypeString) // Ví dụ: BTC, ETH, SOL
        }),
        [](const PropertyList& props) -> ReturnValue {
            std::string symbol = "BTC";
            if (props.has("symbol")) symbol = props["symbol"].value<std::string>();

            // Gọi Server Nodejs
            std::string resp = call_api_get("/coin?symbol=" + symbol);
            
            cJSON* json = cJSON_Parse(resp.c_str());
            std::string text = "Lỗi mạng coin.";
            if (json) {
                cJSON* t = cJSON_GetObjectItem(json, "text");
                if (t) text = t->valuestring;
                cJSON_Delete(json);
            }
            return "{\"result\": \"" + text + "\"}";
        });

    // 💵 CÔNG CỤ 5: TỶ GIÁ NGOẠI TỆ
    AddTool("self.finance.currency", 
        "Tra cứu, chuyển đổi tỷ giá ngoại tệ (USD, EUR, Tệ, Yên...).\n"
        "Dùng khi hỏi: '1 đô là bao nhiêu tiền việt', 'tỷ giá yên nhật', 'đổi tiền'.", 
        PropertyList({
            Property("from_currency", kPropertyTypeString), // Ví dụ: USD, JPY, CNY
            Property("to_currency", kPropertyTypeString)    // Mặc định là VND nếu không nói
        }),
        [](const PropertyList& props) -> ReturnValue {
            std::string from = "USD";
            std::string to = "VND";

            if (props.has("from_currency")) from = props["from_currency"].value<std::string>();
            if (props.has("to_currency")) to = props["to_currency"].value<std::string>();
            
            // Xử lý AI hay trả về tên dài -> rút gọn
            if (from == "đô la" || from == "đô") from = "USD";
            if (from == "nhân dân tệ" || from == "tệ") from = "CNY";
            if (from == "yên") from = "JPY";
            if (from == "euro") from = "EUR";

            std::string resp = call_api_get("/currency?from=" + from + "&to=" + to);
            
            cJSON* json = cJSON_Parse(resp.c_str());
            std::string text = "Lỗi lấy tỷ giá.";
            if (json) {
                cJSON* t = cJSON_GetObjectItem(json, "text");
                if (t) text = t->valuestring;
                cJSON_Delete(json);
            }
            return "{\"result\": \"" + text + "\"}";
        });
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
