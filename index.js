const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(cors());

// --- 0. TỰ ĐỘNG CẬP NHẬT YT-DLP KHI KHỞI ĐỘNG ---
console.log("🔄 Đang kiểm tra cập nhật yt-dlp...");
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.stdout.on('data', d => console.log(`Update log: ${d}`));
updateProcess.on('close', (code) => {
    console.log(`✅ Cập nhật hoàn tất (Code ${code}). Bắt đầu server...`);
    startServer();
});

// --- 1. TẠO FILE COOKIES ---
if (process.env.YT_COOKIES) {
    try {
        fs.writeFileSync('cookies.txt', process.env.YT_COOKIES);
        console.log("🍪 Đã nạp Cookies.");
    } catch (err) { console.error("❌ Lỗi tạo cookies:", err); }
}

// --- 2. HÀM LẤY LINK (CÓ LOG CHI TIẾT) ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        console.log(`1️⃣ Đang xin Link Youtube cho: "${query}"...`);
        
        const args = [
            `ytsearch1:${query}`,
            '-f', 'bestaudio',
            '--get-url',
            '--force-ipv4',
            '--no-playlist',
            '--no-warnings'
        ];

        // Nếu có file cookies thì thêm vào, không thì thôi (thử vận may)
        if (fs.existsSync('cookies.txt')) {
            args.push('--cookies', 'cookies.txt');
            console.log("   -> Đang dùng Cookies để xác thực.");
        } else {
            console.log("   -> KHÔNG tìm thấy Cookies, chạy chế độ ẩn danh.");
        }

        const yt = spawn('/usr/local/bin/yt-dlp', args);

        let url = '';
        let errorLog = ''; // Biến để hứng lỗi
        
        yt.stdout.on('data', d => url += d.toString());
        yt.stderr.on('data', d => errorLog += d.toString()); // Hứng lỗi vào đây

        yt.on('close', code => {
            if (code === 0 && url.trim()) {
                const finalUrl = url.trim().split('\n')[0];
                console.log("✅ LẤY LINK THÀNH CÔNG!");
                resolve(finalUrl);
            } else {
                // IN RA LỖI ĐỂ BIẾT ĐƯỜNG SỬA
                console.error(`❌ YT-DLP THẤT BẠI. LÝ DO:\n${errorLog}`);
                resolve(null);
            }
        });
    });
}

// --- 3. API TÌM KIẾM ---
app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });

    console.log(`🔍 ESP32 tìm: ${q}`);
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    
    // Trả về luôn để ESP32 gọi stream
    res.json({ success: true, title: q, artist: "Youtube", url: myServerUrl });
});

// --- 4. API STREAM (Axios + FFmpeg Fix lỗi -6) ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    // Lấy Link thật
    const audioUrl = await getAudioUrl(q);
    
    if (!audioUrl) {
        return res.status(404).send("YT-DLP Error - Check Server Log");
    }

    console.log("🚀 Bắt đầu Stream & Convert...");
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Connection', 'close');

    try {
        const response = await axios({
            url: audioUrl,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        ffmpeg(response.data)
            .audioCodec('libmp3lame')
            .audioBitrate(128)
            .audioChannels(2)
            .audioFrequency(44100)
            .format('mp3')
            .outputOptions(['-vn', '-map_metadata', '-1', '-preset', 'ultrafast'])
            .on('error', err => {
                if (!err.message.includes('Output stream closed')) console.error('🔥 FFmpeg error:', err.message);
            })
            .pipe(res, { end: true });

    } catch (e) {
        console.error("❌ Lỗi Axios:", e.message);
        if (!res.headersSent) res.status(502).send('Stream Error');
    }
});

function startServer() {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
