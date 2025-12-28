const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
app.use(cors());

// --- 1. TẠO FILE COOKIES ---
if (process.env.YT_COOKIES) {
    try {
        console.log("🍪 Đang tạo file cookies.txt...");
        fs.writeFileSync('cookies.txt', process.env.YT_COOKIES);
        console.log("✅ Đã tạo file cookies.txt thành công!");
    } catch (err) {
        console.error("❌ Lỗi tạo cookies:", err);
    }
}

// --- 2. HÀM STREAM TRỰC TIẾP (ĐÃ FIX THEO GÓP Ý CHUYÊN GIA) ---
function streamYtAudio(query, res) {
    console.log(`🚀 Đang xử lý: ${query}`);

    const args = [
        `ytsearch1:${query}`,
        
        // FIX 2: Ép format để không bị lỗi 500
        '-f', 'bestaudio[ext=m4a]/bestaudio/best', 
        
        '-x',                   
        '--audio-format', 'mp3',
        
        // FIX 1: Audio quality dùng số (0-9) chứ không dùng '128K'
        '--audio-quality', '5', // 5 tương đương khoảng 128kbps
        
        // FIX 3: Bỏ qua kiểm tra SSL (Render hay bị lỗi cái này)
        '--no-check-certificate',
        
        '-o', '-', // Xuất ra stdout
        
        '--cookies', 'cookies.txt',
        '--force-ipv4',             
        '--no-playlist',
        '--no-warnings',
        
        // Fake User Agent
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    ];

    // FIX 5: Dùng đường dẫn tuyệt đối (Khớp với Dockerfile đã cài ở /usr/local/bin)
    const ytPath = '/usr/local/bin/yt-dlp';
    
    // Spawn tiến trình
    const yt = spawn(ytPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });

    // Thiết lập Header
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // FIX 4: Đóng kết nối rõ ràng để ESP32 không bị treo Socket
    res.setHeader('Connection', 'close');

    // --- PIPING ---
    yt.stdout.pipe(res);

    // Xử lý lỗi
    yt.on('error', (err) => {
        console.error("❌ Lỗi không tìm thấy yt-dlp (Kiểm tra Dockerfile):", err);
    });

    yt.on('close', (code) => {
        if (code !== 0) {
            console.error(`❌ yt-dlp kết thúc với mã lỗi: ${code}`);
            if (!res.headersSent) res.status(404).send('Not found');
        } else {
            console.log("✅ Stream kết thúc thành công.");
        }
    });

    // Nếu ESP32 ngắt kết nối
    res.on('close', () => {
        console.log("⚠️ Client ngắt kết nối -> Kill yt-dlp");
        yt.kill();
    });
}

// --- 3. API TÌM KIẾM ---
app.get('/search', (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });

    console.log(`🔍 ESP32 tìm: ${q}`);

    // Trả về link Stream ngay lập tức
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;

    res.json({
        success: true,
        title: q, 
        artist: "Youtube",
        url: myServerUrl
    });
});

// --- 4. API STREAM ---
app.get('/stream', (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");
    
    streamYtAudio(q, res);
});

// Test
app.get('/', (req, res) => { res.send('SERVER PERFECT (DIRECT PIPE + 5 FIXES) 🚀'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
