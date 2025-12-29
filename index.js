const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

const app = express();
app.use(cors());

// --- TRẠNG THÁI SERVER ---
let serverStatus = "Đang khởi động...";
let provider = "SoundCloud (NO-OPUS MODE)";
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
            
            // --- KHU VỰC QUAN TRỌNG: CẤM OPUS ---
            // Ý nghĩa: Ưu tiên mp3_128 -> Nếu không có thì lấy M4A -> CẤM định dạng OPUS
            '-f', 'http_mp3_128/bestaudio[ext=mp3]/bestaudio[ext=m4a]/bestaudio[acodec!=opus]', 
            // ------------------------------------
            
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
app.get('/', (req, res) => {
    res.send(`Server OK - ${serverStatus}`);
});

// --- API SEARCH ---
app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "SoundCloud", url: myServerUrl });
});

// --- API STREAM (FIX LỖI INVALID DATA) ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    
    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    console.log("🚀 FFmpeg: Xử lý link (Bỏ qua Opus)...");

    ffmpeg(audioUrl)
        .inputOptions([
            '-reconnect 1',             
            '-reconnect_streamed 1', 
            '-reconnect_delay_max 5',
            
            // --- THÊM 2 DÒNG NÀY ĐỂ FFMPEG ĐỌC KỸ HƠN ---
            '-analyzeduration 10000000', // Đọc kỹ đầu vào 10MB
            '-probesize 10000000',       // Tăng bộ đệm dò tìm định dạng
            // --------------------------------------------
            
            '-user_agent "Mozilla/5.0"' 
        ])
        .audioFilters([
            'volume=2.5'  // Vẫn giữ Kích âm lượng
        ])
        .audioCodec('libmp3lame')
        .audioBitrate(128)
        .audioChannels(2)
        .audioFrequency(44100)
        .format('mp3')
        .outputOptions([
            '-vn',                  
            '-map_metadata', '-1',  
            '-id3v2_version', '0',  // Vẫn giữ Chống Crash
            '-write_id3v1', '0',    
            '-preset', 'ultrafast',
            '-movflags', 'frag_keyframe+empty_moov'
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
