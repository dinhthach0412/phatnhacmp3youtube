const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

const app = express();
app.use(cors());

// --- TRẠNG THÁI SERVER ---
let serverStatus = "Đang khởi động...";
let provider = "SoundCloud (LITE MODE 64kbps)";
let lastLog = "Chưa có yêu cầu";

// --- 0. UPDATE YT-DLP ---
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => { serverStatus = "Sẵn sàng (Ready)"; });

// --- 1. HÀM LẤY LINK SC ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        lastLog = `🔍 Đang tìm SC: ${query}`;
        const args = [
            `scsearch1:${query}`, 
            // Vẫn cấm OPUS
            '-f', 'http_mp3_128/bestaudio[ext=mp3]/bestaudio[ext=m4a]/bestaudio[acodec!=opus]', 
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
                console.log(`Link Gốc: ${finalUrl}`);
                resolve(finalUrl);
            } else {
                lastLog = `❌ Lỗi: ${err.substring(0, 50)}...`;
                console.error(err);
                resolve(null);
            }
        });
    });
}

// --- 2. GIAO DIỆN WEB ---
app.get('/', (req, res) => { res.send(`Server OK - ${serverStatus}`); });

// --- API SEARCH ---
app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "SoundCloud", url: myServerUrl });
});

// --- API STREAM (GIẢM TẢI CPU CHO ESP32) ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    console.log("🚀 FFmpeg: Lite Stream (64k)...");

    ffmpeg(audioUrl)
        .inputOptions([
            '-reconnect 1',             
            '-reconnect_streamed 1', 
            '-reconnect_delay_max 5',
            '-analyzeduration 15000000',
            '-probesize 15000000',
            '-user_agent "Mozilla/5.0"' 
        ])
        .audioFilters([
            'volume=2.5' // Vẫn giữ to mồm
        ])
        .audioCodec('libmp3lame')
        
        // --- GIẢM BITRATE XUỐNG 64K ---
        // Hy sinh một chút độ nét của nhạc để cứu sống CPU ESP32
        .audioBitrate(64)       
        .audioChannels(2)
        .audioFrequency(44100)
        .format('mp3')
        
        // --- CẤU HÌNH AN TOÀN ---
        .outputOptions([
            '-vn', '-map_metadata', '-1',
            '-id3v2_version', '0',
            '-write_id3v1', '0',
            '-write_xing', '0', // Chống Crash
            
            '-flush_packets', '0', // Gom gói tin
            
            // Giới hạn băng thông chuẩn 64k
            '-minrate', '64k',
            '-maxrate', '64k',
            '-bufsize', '32k', // Giảm buffer xuống cho nhẹ

            '-preset', 'ultrafast',
            '-movflags', 'frag_keyframe+empty_moov'
        ])
        .on('error', (err) => {
            if (!err.message.includes('Output stream closed')) console.error('🔥 FFmpeg:', err.message);
        })
        .pipe(res, { end: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy port ${PORT}`));
