const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(cors());

// --- 0. UPDATE YT-DLP (Để chắc chắn bản mới nhất) ---
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => console.log("✅ YT-DLP Update Check Done."));

// --- 1. GIẢI MÃ COOKIES TỪ BASE64 (FIX LỖI MẤT DÒNG) ---
if (process.env.YT_COOKIES) {
    try {
        console.log("🍪 Đang giải mã Cookies từ Base64...");
        // Giải mã chuỗi Base64 thành text gốc có xuống dòng đàng hoàng
        const decodedCookies = Buffer.from(process.env.YT_COOKIES, 'base64').toString('utf-8');
        fs.writeFileSync('cookies.txt', decodedCookies);
        console.log("✅ Đã tạo file cookies.txt CHUẨN ĐỊNH DẠNG!");
    } catch (err) {
        console.error("❌ Lỗi giải mã cookies:", err);
    }
}

// --- 2. HÀM LẤY LINK ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        console.log(`1️⃣ Đang xin Link Youtube cho: "${query}"...`);
        
        const args = [
            `ytsearch1:${query}`,
            '-f', 'bestaudio', // Ưu tiên audio ngon nhất
            '--get-url',
            '--force-ipv4',
            '--no-playlist',
            '--no-warnings'
        ];

        // Kiểm tra file cookies có tồn tại không
        if (fs.existsSync('cookies.txt')) {
            // Đọc thử 100 ký tự đầu xem file có nội dung không
            const checkFile = fs.readFileSync('cookies.txt', 'utf8');
            if (checkFile.length > 10) {
                args.push('--cookies', 'cookies.txt');
                console.log("   -> Đang dùng Cookies (Đã fix lỗi format).");
            } else {
                console.log("   -> File Cookies rỗng, bỏ qua.");
            }
        }

        const yt = spawn('/usr/local/bin/yt-dlp', args);

        let url = '';
        let errorLog = ''; 
        
        yt.stdout.on('data', d => url += d.toString());
        yt.stderr.on('data', d => errorLog += d.toString());

        yt.on('close', code => {
            if (code === 0 && url.trim()) {
                const finalUrl = url.trim().split('\n')[0];
                console.log("✅ LẤY LINK THÀNH CÔNG!");
                resolve(finalUrl);
            } else {
                console.error(`❌ YT-DLP LỖI (Code ${code}):\n${errorLog}`);
                resolve(null);
            }
        });
    });
}

// --- 3. API TÌM KIẾM ---
app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "Youtube", url: myServerUrl });
});

// --- 4. API STREAM ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    
    if (!audioUrl) return res.status(404).send("Lỗi lấy link Youtube (Xem log Render)");

    console.log("🚀 Stream & Convert...");
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
        console.error("❌ Lỗi Stream:", e.message);
        if (!res.headersSent) res.status(502).send('Stream Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
