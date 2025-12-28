const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');

const app = express();
app.use(cors());

// --- TRẠNG THÁI SERVER (Để hiện lên Web) ---
let serverStatus = "Đang khởi động...";
let provider = "SoundCloud (No Cookies)";
let lastLog = "Chưa có yêu cầu";

// --- 0. UPDATE YT-DLP (Vẫn cần update để hỗ trợ SC tốt nhất) ---
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => { serverStatus = "Sẵn sàng (Ready)"; });

// --- 1. HÀM LẤY LINK TỪ SOUNDCLOUD ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        lastLog = `🔍 Đang tìm SC: ${query}`;
        
        const args = [
            `scsearch1:${query}`,           // Tìm 1 bài trên SoundCloud
            '-f', 'http_mp3_128/bestaudio', // Ưu tiên link MP3 trực tiếp
            '--get-url',
            '--no-playlist',
            '--no-warnings',
            '--force-ipv4'
            // KHÔNG COOKIES - KHÔNG LOGIN
        ];

        const yt = spawn('/usr/local/bin/yt-dlp', args);

        let url = '';
        let err = '';

        yt.stdout.on('data', d => url += d.toString());
        yt.stderr.on('data', d => err += d.toString());

        yt.on('close', code => {
            if (code === 0 && url.trim()) {
                const finalUrl = url.trim().split('\n')[0];
                lastLog = `✅ Tìm thấy: ${query}`;
                console.log(`Link SC: ${finalUrl}`);
                resolve(finalUrl);
            } else {
                lastLog = `❌ Không thấy: ${err.substring(0, 50)}...`;
                console.error(err);
                resolve(null);
            }
        });
    });
}

// --- 2. GIAO DIỆN WEB (CHO UPTIME ROBOT) ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Music Server</title>
        <style>
            body { background-color: #f2f2f2; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .card { background: white; padding: 2rem; border-radius: 12px; width: 320px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #ff5500; } 
            .stat { background: #eee; padding: 8px; border-radius: 4px; margin: 5px 0; text-align: left; font-size: 0.9em; }
            .stat b { float: right; color: #333; }
            .green { color: #28a745 !important; }
            .log { margin-top: 15px; font-size: 0.8em; color: #666; font-style: italic; border-top: 1px solid #ddd; padding-top: 10px; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>☁️ SoundCloud</h1>
            <div class="stat">Trạng thái <b class="green">${serverStatus}</b></div>
            <div class="stat">Chế độ <b>${provider}</b></div>
            <div class="log">${lastLog}</div>
        </div>
    </body>
    </html>
    `);
});

// --- API SEARCH ---
app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    
    // Trả về link stream ngay
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "SoundCloud", url: myServerUrl });
});

// --- API STREAM ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    
    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        const response = await axios({
            url: audioUrl,
            method: 'GET',
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        ffmpeg(response.data)
            .audioCodec('libmp3lame')
            .audioBitrate(128)
            .audioChannels(2)
            .audioFrequency(44100)
            .format('mp3')
            .outputOptions(['-vn', '-map_metadata', '-1', '-preset', 'ultrafast'])
            .on('error', () => {})
            .pipe(res, { end: true });

    } catch (e) {
        console.error("Stream Error:", e.message);
        if (!res.headersSent) res.status(502).send('Stream Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy port ${PORT}`));
