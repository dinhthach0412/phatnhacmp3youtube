const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

// --- TRẠNG THÁI SERVER ---
let serverStatus = "Booting...";
let lastQuery = "Chưa có";
let clientCount = 0;

// Update yt-dlp ngầm lúc khởi động
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => { serverStatus = "Online (Ready)"; });

// --- HÀM LẤY LINK (SPEED MODE) ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        lastQuery = query;
        console.log(`⚡ Tìm nhanh: ${query}`);
        
        const args = [
            `scsearch1:${query}`, // Tìm 1 bài duy nhất cho nhanh
            
            // Lấy link MP3/M4A, né Opus
            '-f', 'http_mp3_128/bestaudio[ext=mp3]/bestaudio[ext=m4a]/bestaudio[acodec!=opus]', 
            '--get-url',
            '--no-playlist',
            '--no-warnings',
            '--force-ipv4',
            '--no-check-certificate'
        ];

        const yt = spawn('/usr/local/bin/yt-dlp', args);
        let url = '';

        yt.stdout.on('data', d => url += d.toString());
        
        yt.on('close', code => {
            if (code === 0 && url.trim()) {
                const finalUrl = url.trim().split('\n')[0];
                console.log(`✅ Link OK: ${finalUrl}`);
                resolve(finalUrl);
            } else {
                console.log("❌ Not Found");
                resolve(null);
            }
        });
    });
}

// --- GIAO DIỆN WEB CHO UPTIME ROBOT ---
app.get('/', (req, res) => {
    // Trả về HTML nhẹ hều để robot ping cho lẹ
    res.status(200).send(`
        <html>
        <head><title>ESP32 Server</title></head>
        <body style="font-family:monospace; background:#111; color:#0f0; padding:20px;">
            <h1>🚀 ESP32 MUSIC SERVER</h1>
            <hr>
            <p>Status: <b>${serverStatus}</b></p>
            <p>Bitrate: <b>64 kbps (Lite)</b></p>
            <p>Last Search: <b>${lastQuery}</b></p>
            <p>Provider: <b>SoundCloud Speed</b></p>
            <hr>
            <small>Ping OK - UptimeRobot Friendly</small>
        </body>
        </html>
    `);
});

// --- API SEARCH ---
app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    
    // Trả về link stream ngay lập tức
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "SoundCloud", url: myServerUrl });
});

// --- API STREAM (64KBPS - TỐI ƯU TỐC ĐỘ) ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    if (!audioUrl) return res.status(404).send("Not found");

    // Header chuẩn MP3
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    console.log("🚀 Stream 64k bắt đầu...");

    ffmpeg(audioUrl)
        .inputOptions([
            '-reconnect 1', 
            '-reconnect_streamed 1', 
            '-reconnect_delay_max 5',
            '-analyzeduration 0', // Bỏ phân tích sâu -> Load nhanh hơn
            '-probesize 32768',   // Giảm gói thăm dò
            '-user_agent "Mozilla/5.0"'
        ])
        .audioFilters([
            'volume=2.5' // Kích âm lượng loa
        ])
        .audioCodec('libmp3lame')
        
        // --- QUAN TRỌNG: 64KBPS ---
        .audioBitrate(64)       
        .audioChannels(2)
        .audioFrequency(44100)
        .format('mp3')
        
        // --- CẤU HÌNH AN TOÀN CHO ESP32 ---
        .outputOptions([
            '-vn', '-map_metadata', '-1', // Xóa sạch thông tin rác
            '-id3v2_version', '0',        // Cấm ID3v2
            '-write_id3v1', '0',          // Cấm ID3v1
            '-write_xing', '0',           // Cấm Xing Header (Chống Crash)
            
            '-flush_packets', '0',        // Gom gói tin (Chống Watchdog)
            
            // Giới hạn băng thông chuẩn 64k
            '-minrate', '64k',
            '-maxrate', '64k',
            '-bufsize', '32k',            // Buffer nhỏ gọn

            '-preset', 'ultrafast',       // Nén siêu tốc
            '-movflags', 'frag_keyframe+empty_moov'
        ])
        .on('error', (err) => {
            // Không log lỗi ngắt kết nối client để đỡ rác log
            if (!err.message.includes('Output stream closed')) console.error('FFmpeg Err:', err.message);
        })
        .pipe(res, { end: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy port ${PORT}`));
