const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
app.use(cors());

// --- 1. TẠO FILE COOKIES (Vẫn giữ cái này để chống bị chặn 100%) ---
if (process.env.YT_COOKIES) {
    try {
        console.log("🍪 Đang tạo file cookies.txt...");
        fs.writeFileSync('cookies.txt', process.env.YT_COOKIES);
        console.log("✅ Đã tạo file cookies.txt thành công!");
    } catch (err) {
        console.error("❌ Lỗi tạo cookies:", err);
    }
}

// --- 2. HÀM STREAM TRỰC TIẾP (Theo phong cách ChatGPT nhưng xịn hơn) ---
function streamYtAudio(query, res) {
    console.log(`🚀 Đang xử lý: ${query}`);

    const args = [
        `ytsearch1:${query}`,   // Tìm và lấy video đầu tiên
        
        // Các tham số ép yt-dlp tải và convert luôn
        '-x',                   // Extract audio (Chỉ lấy tiếng)
        '--audio-format', 'mp3',// Chuyển sang MP3
        '--audio-quality', '128K', // Bitrate 128kbps (Nhẹ cho ESP32)
        
        // Xuất thẳng ra Standard Output (để Node.js hứng)
        '-o', '-',              
        
        // Cấu hình mạng và Cookies
        '--cookies', 'cookies.txt', // <--- QUAN TRỌNG: Vẫn dùng Cookies để bất tử
        '--force-ipv4',             // Ép IPv4 cho ổn định
        '--no-playlist',
        '--no-warnings',
        
        // Giả lập trình duyệt (để Youtube không nghi ngờ)
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    ];

    // Spawn tiến trình yt-dlp
    // stdio: ['ignore', 'pipe', 'ignore'] -> Chỉ quan tâm đầu ra (stdout)
    const yt = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'ignore'] });

    // Thiết lập Header ngay lập tức để ESP32 sướng
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    // --- PHẦN KẾT NỐI ỐNG NƯỚC (PIPING) ---
    // Dữ liệu từ yt-dlp chảy thẳng vào res (phản hồi cho ESP32)
    // Node.js không can thiệp, không tốn RAM
    yt.stdout.pipe(res);

    // Xử lý khi kết thúc
    yt.on('close', (code) => {
        if (code !== 0) {
            console.error(`❌ yt-dlp bị lỗi hoặc không tìm thấy bài (Code: ${code})`);
            // Nếu chưa gửi header thì báo lỗi, gửi rồi thì thôi (ngắt kết nối)
            if (!res.headersSent) res.status(404).send('Not found');
        } else {
            console.log("✅ Stream kết thúc thành công.");
        }
    });

    // Nếu ESP32 ngắt kết nối giữa chừng (chuyển bài), ta giết yt-dlp ngay để đỡ tốn CPU
    res.on('close', () => {
        console.log("⚠️ Client ngắt kết nối -> Kill yt-dlp");
        yt.kill();
    });
}

// --- 3. API TÌM KIẾM (Giờ đây chỉ đơn giản là tạo link stream) ---
app.get('/search', (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });

    console.log(`🔍 ESP32 tìm: ${q}`);

    // Trả về link Stream của chính server này
    // Lưu ý: Không cần tìm Title hay Artist nữa để tiết kiệm thời gian
    // Robot sẽ hát ngay lập tức!
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;

    res.json({
        success: true,
        title: q,          // Lấy luôn từ khóa làm tên bài (đỡ phải query Youtube 2 lần)
        artist: "Youtube",
        url: myServerUrl
    });
});

// --- 4. API STREAM (Thực hiện nhiệm vụ nặng) ---
app.get('/stream', (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");
    
    streamYtAudio(q, res);
});

// Test
app.get('/', (req, res) => { res.send('SERVER ULTRA-FAST (PIPE MODE) 🚀'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
