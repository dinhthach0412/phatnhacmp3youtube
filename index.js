const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

// Hàm dùng yt-dlp để tìm link nhạc trực tiếp từ Youtube
function getYtDlpLink(query) {
    return new Promise((resolve, reject) => {
        // Lệnh: yt-dlp "ytsearch1:tên bài hát" --get-url -f bestaudio
        const ytDlp = spawn('yt-dlp', [
            `ytsearch1:${query}`, // Tìm video đầu tiên
            '-f', 'bestaudio',    // Lấy file âm thanh tốt nhất (m4a/webm)
            '--get-url',          // Chỉ lấy link, không tải file
            '--no-warnings'       // Tắt cảnh báo cho sạch log
        ]);

        let outputUrl = '';

        ytDlp.stdout.on('data', (data) => {
            outputUrl += data.toString().trim();
        });

        ytDlp.stderr.on('data', (data) => {
            console.error(`yt-dlp log: ${data}`);
        });

        ytDlp.on('close', (code) => {
            if (code === 0 && outputUrl) {
                // yt-dlp đôi khi trả về nhiều link, chỉ lấy dòng đầu tiên
                const finalUrl = outputUrl.split('\n')[0];
                resolve(finalUrl);
            } else {
                reject(new Error(`yt-dlp exited with code ${code}`));
            }
        });
    });
}

// API 1: TÌM KIẾM (Dùng yt-dlp)
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        console.log("🔍 ESP32 đang tìm (yt-dlp):", query);
        
        // 1. Lấy link stream từ yt-dlp
        const audioUrl = await getYtDlpLink(query);
        console.log("✅ yt-dlp tìm thấy link:", audioUrl.substring(0, 50) + "...");

        // 2. Tạo link HTTPS của server mình để trả về cho ESP32
        // Lưu ý: Mình fake tiêu đề là chính query vì yt-dlp lấy title hơi chậm, 
        // mục tiêu là tốc độ.
        const myServerUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(audioUrl)}`;
        
        return res.json({ 
            success: true, 
            title: query,       // Tạm thời lấy tên bài là từ khóa tìm kiếm
            artist: "Youtube", 
            url: myServerUrl 
        });

    } catch (e) { 
        console.error("❌ yt-dlp thất bại:", e.message);
        res.status(500).json({ error: "Server Error" }); 
    }
});

// API 2: STREAM (Dùng Axios tải -> Pipe vào FFmpeg)
const axios = require('axios'); // Nhớ cài axios: npm install axios
app.get('/stream', async (req, res) => {
    const audioUrl = req.query.url;
    if (!audioUrl) return res.status(400).send("No URL provided");

    console.log("🚀 Transcode (Direct -> FFmpeg)...");
    
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        // yt-dlp trả về link google, ta dùng axios hút nó về rồi bơm vào ffmpeg
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
            .audioFrequency(44100)
            .outputOptions(['-preset ultrafast', '-movflags frag_keyframe+empty_moov'])
            .on('error', (err) => {
                if (err.message && !err.message.includes('Output stream closed')) {
                    console.error('🔥 Lỗi Transcode:', err.message);
                }
            })
            .pipe(res, { end: true });

    } catch (error) {
        console.error("❌ Lỗi tải nhạc nguồn:", error.message);
        if (!res.headersSent) res.status(502).send('Bad Gateway');
    }
});

// Các API phụ giữ nguyên
app.get('/coin', async (req, res) => { res.json({ text: "Giá Coin Demo" }); });
app.get('/gold', async (req, res) => { res.json({ text: "Giá Vàng Demo" }); });
app.get('/weather', async (req, res) => { res.json({ text: "Thời tiết Demo" }); });
app.get('/', (req, res) => { res.send('SERVER ALIVE (YT-DLP CORE) 🚀'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
