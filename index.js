const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs'); // Thêm thư viện quản lý file

const app = express();
app.use(cors());

// --- BƯỚC QUAN TRỌNG: TẠO FILE COOKIES TỪ BIẾN MÔI TRƯỜNG ---
// Render sẽ lấy nội dung từ biến YT_COOKIES và ghi ra file cookies.txt
if (process.env.YT_COOKIES) {
    try {
        console.log("🍪 Đang tạo file cookies.txt từ biến môi trường...");
        fs.writeFileSync('cookies.txt', process.env.YT_COOKIES);
        console.log("✅ Đã tạo file cookies.txt thành công!");
    } catch (err) {
        console.error("❌ Lỗi tạo cookies:", err);
    }
} else {
    console.warn("⚠️ CẢNH BÁO: Chưa có biến YT_COOKIES trên Render. Có thể bị chặn!");
}

function getYtDlpLink(query) {
    return new Promise((resolve, reject) => {
        // Cấu hình lệnh yt-dlp CÓ SỬ DỤNG COOKIES
        const args = [
            `ytsearch1:${query}`, 
            '-f', 'bestaudio',    
            '--get-url',          
            '--no-warnings',
            '--cookies', 'cookies.txt', // <--- CHÌA KHÓA VẠN NĂNG Ở ĐÂY
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' // Fake User Agent
        ];

        const ytDlp = spawn('yt-dlp', args);

        let outputUrl = '';
        let errorLog = '';

        ytDlp.stdout.on('data', (data) => {
            outputUrl += data.toString().trim();
        });

        ytDlp.stderr.on('data', (data) => {
            errorLog += data.toString();
        });

        ytDlp.on('close', (code) => {
            if (code === 0 && outputUrl) {
                const finalUrl = outputUrl.split('\n')[0];
                resolve(finalUrl);
            } else {
                // In lỗi ra để debug nếu cần
                console.error(`yt-dlp error log: ${errorLog}`);
                reject(new Error(`yt-dlp exited with code ${code}`));
            }
        });
    });
}

// API 1: TÌM KIẾM
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        console.log("🔍 ESP32 đang tìm (Cookies Mode):", query);
        
        const audioUrl = await getYtDlpLink(query);
        console.log("✅ yt-dlp tìm thấy link:", audioUrl.substring(0, 30) + "...");

        const myServerUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(audioUrl)}`;
        
        return res.json({ 
            success: true, 
            title: query,       
            artist: "Youtube", 
            url: myServerUrl 
        });

    } catch (e) { 
        console.error("❌ yt-dlp thất bại:", e.message);
        res.status(500).json({ error: "Server Error (Check Cookies)" }); 
    }
});

// API 2: STREAM (Dùng Axios tải -> Pipe vào FFmpeg)
const axios = require('axios');
app.get('/stream', async (req, res) => {
    const audioUrl = req.query.url;
    if (!audioUrl) return res.status(400).send("No URL provided");

    console.log("🚀 Transcode...");
    res.setHeader('Content-Type', 'audio/mpeg');

    try {
        const response = await axios({
            method: 'get',
            url: audioUrl,
            responseType: 'stream', 
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        ffmpeg(response.data)
            .audioCodec('libmp3lame')
            .format('mp3')
            .audioBitrate(128)
            .audioChannels(2)
            .outputOptions(['-preset ultrafast', '-movflags frag_keyframe+empty_moov'])
            .on('error', (err) => {})
            .pipe(res, { end: true });

    } catch (error) {
        if (!res.headersSent) res.status(502).send('Bad Gateway');
    }
});

app.get('/', (req, res) => { res.send('SERVER ALIVE (COOKIES AUTH) 🚀'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
