const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

// --- BIẾN TOÀN CỤC ĐỂ HIỂN THỊ LÊN WEB ---
let serverStatus = "Đang khởi động...";
let ytdlpVersion = "Đang kiểm tra...";
let cookieStatus = "Chưa kiểm tra";
let lastLog = "Chưa có yêu cầu nào";

// --- 0. UPDATE YT-DLP NGẦM (Không chặn server khởi động) ---
function updateYtDlp() {
    const update = spawn('/usr/local/bin/yt-dlp', ['-U']);
    update.stdout.on('data', d => { ytdlpVersion = `Đang update... ${d}`; });
    update.on('close', () => {
        // Lấy version sau khi update
        const vCheck = spawn('/usr/local/bin/yt-dlp', ['--version']);
        vCheck.stdout.on('data', d => { ytdlpVersion = d.toString().trim(); });
        serverStatus = "Sẵn sàng (Ready)";
    });
}
// Chạy update ngay lập tức
updateYtDlp();

// --- 1. GIẢI MÃ COOKIES ---
if (process.env.YT_COOKIES) {
    try {
        const decoded = Buffer.from(process.env.YT_COOKIES, 'base64').toString('utf-8');
        fs.writeFileSync('cookies.txt', decoded);
        const stats = fs.statSync('cookies.txt');
        cookieStatus = `✅ Đã nạp (${stats.size} bytes)`;
    } catch (err) {
        cookieStatus = `❌ Lỗi nạp: ${err.message}`;
    }
} else {
    cookieStatus = "⚠️ Không tìm thấy biến YT_COOKIES";
}

// --- 2. HÀM LẤY LINK (CHIẾN THUẬT GIẢ LẬP ANDROID) ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        lastLog = `Đang tìm: ${query}`;
        
        const args = [
            `ytsearch1:${query}`,
            '-f', 'bestaudio', 
            '--get-url',
            '--no-playlist',
            '--no-warnings',
            '--force-ipv4',
            
            // --- CHIẾN THUẬT MỚI: GIẢ LẬP CLIENT KHÁC ---
            // Nếu dùng Cookies máy tính bị chặn, ta thử giả vờ là TV hoặc Android
            // Cách này thường né được lỗi "Sign in"
            '--extractor-args', 'youtube:player_client=android', 
        ];

        if (fs.existsSync('cookies.txt')) {
            args.push('--cookies', 'cookies.txt');
        }

        const yt = spawn('/usr/local/bin/yt-dlp', args);

        let url = '';
        let err = '';

        yt.stdout.on('data', d => url += d.toString());
        yt.stderr.on('data', d => err += d.toString());

        yt.on('close', code => {
            if (code === 0 && url.trim()) {
                lastLog = `✅ Thành công: ${query}`;
                resolve(url.trim().split('\n')[0]);
            } else {
                lastLog = `❌ Lỗi tìm kiếm: ${err.substring(0, 100)}...`;
                console.error(err); // In lỗi ra console render
                resolve(null);
            }
        });
    });
}

// --- 3. GIAO DIỆN WEB (UPTIMEROBOT SẼ PING VÀO ĐÂY) ---
app.get('/', (req, res) => {
    // Trả về trang HTML đẹp mắt
    res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ESP32 Music Server</title>
        <style>
            body { background-color: #121212; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .card { background-color: #1e1e1e; padding: 2rem; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); width: 350px; text-align: center; }
            h1 { color: #bb86fc; margin-bottom: 0.5rem; }
            .status { font-size: 0.9rem; margin: 10px 0; padding: 10px; background: #2c2c2c; border-radius: 8px; text-align: left; }
            .status span { float: right; font-weight: bold; }
            .green { color: #03dac6; }
            .red { color: #cf6679; }
            .log { font-size: 0.8rem; color: #888; margin-top: 15px; font-style: italic; border-top: 1px solid #333; padding-top: 10px; }
            .btn { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #3700b3; color: white; text-decoration: none; border-radius: 5px; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🎵 Music Server</h1>
            <p>Dành cho ESP32 - By Gemini</p>
            
            <div class="status">
                Trạng thái: <span class="${serverStatus.includes('Ready') ? 'green' : 'red'}">${serverStatus}</span>
            </div>
            <div class="status">
                yt-dlp Version: <span>${ytdlpVersion}</span>
            </div>
            <div class="status">
                Cookies: <span class="${cookieStatus.includes('✅') ? 'green' : 'red'}">${cookieStatus.split(' ')[0]}</span>
            </div>
            
            <div class="log">
                Log gần nhất:<br> ${lastLog}
            </div>

            <a href="/" class="btn">Refresh trạng thái</a>
        </div>
    </body>
    </html>
    `);
});

// --- API SEARCH ---
app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "Youtube", url: myServerUrl });
});

// --- API STREAM ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    
    if (!audioUrl) {
        // Trả về file âm thanh lỗi (hoặc tiếng bíp) nếu muốn, ở đây trả về lỗi 404
        return res.status(404).send("Lỗi: Không lấy được link (Kiểm tra Cookies/IP)");
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        const response = await axios({
            url: audioUrl,
            method: 'GET',
            responseType: 'stream',
            headers: {
                // Fake User Agent cực mạnh
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
            }
        });

        ffmpeg(response.data)
            .audioCodec('libmp3lame')
            .audioBitrate(128)
            .audioChannels(2)
            .audioFrequency(44100)
            .format('mp3')
            .outputOptions(['-vn', '-map_metadata', '-1', '-preset', 'ultrafast'])
            .on('error', err => { if(!err.message.includes('Output')) console.error('FFmpeg:', err.message); })
            .pipe(res, { end: true });

    } catch (e) {
        console.error("Axios Error:", e.message);
        if (!res.headersSent) res.status(502).send('Stream Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
