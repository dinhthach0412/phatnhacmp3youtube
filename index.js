const express = require('express');
const cors = require('cors');
const { ZingMp3 } = require("zingmp3-api-full");

const app = express();
app.use(cors());

// Cổng mặc định (Render sẽ tự cấp cổng qua biến PORT)
const port = process.env.PORT || 3000;

// API chính: /search?q=ten_bai_hat
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ error: "Thiếu tên bài hát (q=...)" });
        }

        console.log(`--> ESP32 đang tìm: ${query}`);

        // 1. Tìm kiếm bài hát
        const searchResult = await ZingMp3.search(query);
        
        // Kiểm tra xem có bài nào không
        if (searchResult.data && searchResult.data.items && searchResult.data.items.length > 0) {
            // Lấy bài đầu tiên (độ chính xác cao nhất)
            // Lọc qua mảng items để tìm object có type là 'song' (vì nó trả về cả playlist/video)
            const song = searchResult.data.items.find(item => item.sectionType === 'song' || (item.encodeId && item.title));
            
            if (!song) {
                 return res.status(404).json({ error: "Không tìm thấy bài hát nào hợp lệ" });
            }

            console.log(`--> Đã thấy bài: ${song.title} (${song.encodeId})`);

            // 2. Lấy link stream (128kbps là đủ cho ESP32 và dễ load nhất)
            const streamResult = await ZingMp3.getStreaming(song.encodeId);

            if (streamResult.data && streamResult.data["128"]) {
                // Link ngon! Trả về cho ESP32
                // Lưu ý: Link Zing có redirect, nhưng ESP32 (V87) của bạn xử lý được.
                const directUrl = streamResult.data["128"];
                
                return res.json({
                    success: true,
                    title: song.title,
                    artist: song.artistsNames,
                    url: directUrl
                });
            } else {
                // Bài này có thể là VIP hoặc bị chặn
                return res.status(403).json({ error: "Bài này VIP hoặc không có link stream" });
            }
        } else {
            return res.status(404).json({ error: "Không tìm thấy bài hát" });
        }

    } catch (error) {
        console.error("Lỗi Server:", error);
        res.status(500).json({ error: "Lỗi nội bộ Server" });
    }
});

// Trang chủ để test xem server sống hay chết
app.get('/', (req, res) => {
    res.send('<h1>Server Nhạc ESP32 Đang Chạy! 🚀</h1><p>Hãy gọi: /search?q=son+tung</p>');
});

app.listen(port, () => {
    console.log(`Server đang chạy tại cổng ${port}`);
});
