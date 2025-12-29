const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
// BỎ AXIOS ĐI, KHÔNG CẦN DÙNG NỮA
const fs = require('fs');

const app = express();
app.use(cors());

// --- TRẠNG THÁI SERVER ---
let serverStatus = "Đang khởi động...";
let provider = "SoundCloud (FFmpeg Direct)";
let lastLog = "Chưa có yêu cầu";

// --- 0. UPDATE YT-DLP ---
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => { serverStatus = "Sẵn sàng (Ready)"; });

// --- 1. HÀM LẤY LINK TỪ SOUNDCLOUD ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        lastLog = `🔍 Đang tìm SC: ${query}`;
        
        const args = [
            `scsearch1:${query}`, 
            // Thử ép lấy link HTTP MP3 (progressive) trước, nếu không có thì lấy HLS (m3u8)
            '-f', 'http_mp3_128/bestaudio', 
            '--get-url',
            '--no-playlist',
            '--no-warnings',
            '--force-ipv4'
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
                console.log(`Link SC Gốc: ${finalUrl}`);
                resolve(finalUrl);
            } else {
                lastLog = `❌ Không thấy: ${err.substring(0, 50)}...`;
                console.error(err);
                resolve(null);
            }
        });
    });
}

// --- 2. GIAO DIỆN WEB ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <title>Music Server</title>
        <style>
            body { background-color: #f2f2f2; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .card { background: white; padding: 2rem; border-radius: 12px; width: 320px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #ff5500; } 
            .stat { background: #eee; padding: 8px; border-radius: 4px; margin: 5px 0; text-align: left; font-size: 0.9em; }
            .green { color: #28a745 !important; }
            .log { margin-top: 15px; font-size: 0.8em; color: #666; border-top: 1px solid #ddd; padding-top: 10px; word-break: break-all; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>☁️ SoundCloud</h1>
            <div class="stat">Trạng thái <b class="green">${serverStatus}</b></div>
            <div class="stat">Mode <b>${provider}</b></div>
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
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "SoundCloud", url: myServerUrl });
});

// --- API STREAM (BỎ AXIOS - DÙNG FFMPEG TRỰC TIẾP) ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    
    if (!audioUrl) return res.status(404).send("Not found");

    // Thiết lập Header để ESP32 không bị ngắt quãng
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    console.log("🚀 FFmpeg đang xử lý link: " + audioUrl.substring(0, 30) + "...");

    // QUAN TRỌNG: Đưa thẳng Link URL vào FFmpeg (để nó tự xử lý m3u8)
    ffmpeg(audioUrl)
        .inputOptions([
            '-reconnect 1',             // Tự kết nối lại nếu rớt mạng
            '-reconnect_streamed 1', 
            '-reconnect_delay_max 5',
            '-user_agent "Mozilla/5.0"' // Fake User Agent để SC không chặn
        ])
        .audioCodec('libmp3lame')
        .audioBitrate(128)
        .audioChannels(2)
        .audioFrequency(44100)
        .format('mp3')
        .outputOptions([
            '-vn', 
            '-map_metadata', '-1', 
            '-preset', 'ultrafast',
            '-movflags', 'frag_keyframe+empty_moov' // Cực quan trọng cho Stream
        ])
        .on('error', (err) => {
            if (!err.message.includes('Output stream closed')) {
                console.error('🔥 FFmpeg Error:', err.message);
            }
        })
        .pipe(res, { end: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy port ${PORT}`));
