const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

const app = express();
app.use(cors());

// --- TẠO FILE COOKIES TỪ BIẾN MÔI TRƯỜNG ---
if (process.env.YT_COOKIES) {
    try {
        console.log("🍪 Đang tạo file cookies.txt...");
        fs.writeFileSync('cookies.txt', process.env.YT_COOKIES);
        console.log("✅ Đã tạo file cookies.txt thành công!");
    } catch (err) {
        console.error("❌ Lỗi tạo cookies:", err);
    }
}

function getYtDlpLink(query) {
    return new Promise((resolve, reject) => {
        // Cấu hình lệnh yt-dlp (Đã sửa lỗi Format Not Available)
        const args = [
            `ytsearch1:${query}`, 
            // SỬA Ở ĐÂY: Thử lấy m4a trước, không được thì lấy bestaudio, cùng lắm thì lấy best (video+audio)
            '-f', 'bestaudio[ext=m4a]/bestaudio/best',    
            '--get-url',          
            '--no-warnings',
            '--cookies', 'cookies.txt', // Dùng Cookies xịn của bạn
            '--force-ipv4'              // Ép dùng IPv4 để tránh lỗi mạng trên Render
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
                // yt-dlp có thể trả về 2 link (video+audio), ta chỉ lấy dòng đầu tiên
                const finalUrl = outputUrl.split('\n')[0];
                resolve(finalUrl);
            } else {
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
        
        // Link trả về từ yt-dlp rất dài, in ra 50 ký tự đầu để check thôi
        console.log("✅ Link Youtube Gốc:", audioUrl.substring(0, 50) + "...");

        const myServerUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(audioUrl)}`;
        
        return res.json({ 
            success: true, 
            title: query,       
            artist: "Youtube", 
            url: myServerUrl 
        });

    } catch (e) { 
        console.error("❌ Lỗi yt-dlp:", e.message);
        res.status(500).json({ error: "Server Error" }); 
    }
});

// API 2: STREAM & CONVERT
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
                // Fake User Agent giống như lúc lấy Cookies
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        ffmpeg(response.data)
            .audioCodec('libmp3lame')
            .format('mp3')
            .audioBitrate(128)
            .audioChannels(2)
            .outputOptions(['-preset ultrafast', '-movflags frag_keyframe+empty_moov'])
            .on('error', (err) => { 
                // Không in lỗi nếu client ngắt kết nối
            })
            .pipe(res, { end: true });

    } catch (error) {
        console.error("Stream Error:", error.message);
        if (!res.headersSent) res.status(502).send('Bad Gateway');
    }
});

app.get('/', (req, res) => { res.send('SERVER OK (COOKIES + FIX FORMAT) 🚀'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
