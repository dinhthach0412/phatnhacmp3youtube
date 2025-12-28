const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

const app = express();
app.use(cors());

// --- TẠO FILE COOKIES ---
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
        // --- CẤU HÌNH LỆNH ĂN TẠP (QUAN TRỌNG) ---
        const args = [
            `ytsearch1:${query}`, 
            
            // Ý nghĩa: "ba*" (Best Audio) HOẶC "b*" (Best Video+Audio)
            // Lấy bất cứ thứ gì có tiếng là được!
            '-f', 'ba*/b*',    
            
            '--get-url',          
            '--no-warnings',
            '--cookies', 'cookies.txt', 
            '--force-ipv4'              
        ];

        // Gọi lệnh yt-dlp
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
                // Nếu yt-dlp trả về nhiều dòng (ví dụ video riêng, audio riêng)
                // Ta sẽ lấy dòng cuối cùng (thường là file hoàn chỉnh nhất hoặc file audio)
                const urls = outputUrl.split('\n');
                const finalUrl = urls[urls.length - 1]; // Lấy cái cuối cho chắc
                resolve(finalUrl);
            } else {
                console.error(`yt-dlp error log: ${errorLog}`);
                // Thay vì reject làm sập server, ta trả về null để xử lý sau
                resolve(null); 
            }
        });
    });
}

// API 1: TÌM KIẾM
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        console.log("🔍 ESP32 tìm (Cookies + Ăn tạp):", query);
        
        const audioUrl = await getYtDlpLink(query);
        
        if (!audioUrl) {
            console.error("❌ yt-dlp không lấy được link nào cả.");
            return res.status(500).json({ error: "Cannot extract URL" });
        }

        console.log("✅ Link Youtube lấy được:", audioUrl.substring(0, 30) + "...");

        const myServerUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(audioUrl)}`;
        
        return res.json({ 
            success: true, 
            title: query,       
            artist: "Youtube", 
            url: myServerUrl 
        });

    } catch (e) { 
        console.error("❌ Server Error:", e.message);
        res.status(500).json({ error: "Server Internal Error" }); 
    }
});

// API 2: STREAM & CONVERT (Giữ nguyên)
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
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

app.get('/', (req, res) => { res.send('SERVER OK (OMNIVORE MODE) 🚀'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
