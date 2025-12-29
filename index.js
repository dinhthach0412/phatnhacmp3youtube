const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

const app = express();
app.use(cors());

// --- TRẠNG THÁI SERVER ---
let serverStatus = "Đang khởi động...";
let provider = "SoundCloud (STABLE STREAM)";
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

// --- API STREAM (FIX VỤN VẶT & WATCHDOG) ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked'); // Nodejs tự xử lý chunk
    
    console.log("🚀 FFmpeg: Streaming (Buffered)...");

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
            'volume=2.5' // Giữ nguyên kích âm
        ])
        .audioCodec('libmp3lame')
        .audioBitrate(128)
        .audioChannels(2)
        .audioFrequency(44100)
        .format('mp3')
        
        // --- CẤU HÌNH ĐẦU RA ĐỂ TRÁNH VỤN VẶT ---
        .outputOptions([
            '-vn', '-map_metadata', '-1',
            '-id3v2_version', '0',
            '-write_id3v1', '0',
            '-write_xing', '0', // Vẫn giữ xóa Xing để chống crash
            
            // QUAN TRỌNG: Cấm xả gói tin liên tục
            '-flush_packets', '0', 
            
            // Ép kích thước gói tin MP3 tối thiểu (để không bị vụn 2-3 bytes)
            '-minrate', '128k',
            '-maxrate', '128k',
            '-bufsize', '64k', // Buffer 64KB

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
