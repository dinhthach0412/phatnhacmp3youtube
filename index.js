const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

// --- TRẠNG THÁI SERVER ---
let serverStatus = "Booting...";
let lastQuery = "Chưa có";

// Update yt-dlp
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => { serverStatus = "Online (Smart Speed Mode)"; });

// --- HÀM LẤY LINK (CÓ XỬ LÝ TỪ KHÓA) ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        // 1. LỌC TỪ KHÓA RÁC (Quan trọng)
        // Loại bỏ: youtube, zing, bài hát, phát nhạc... để SoundCloud tìm chuẩn hơn
        let cleanQuery = query.toLowerCase()
            .replace(/youtube|zing|mp3|phát nhạc|mở nhạc|bài hát|của/g, "")
            .trim();
            
        // Nếu xóa hết trơn thì lấy lại từ gốc, còn không thì dùng từ đã lọc
        let finalQuery = cleanQuery.length > 1 ? cleanQuery : query;

        lastQuery = finalQuery;
        console.log(`🔍 Gốc: "${query}" -> Tìm: "${finalQuery}"`);
        
        const args = [
            // QUAY LẠI TÌM 1 BÀI CHO NHANH (Tránh timeout lỗi -0x004C)
            `scsearch1:${finalQuery}`, 
            
            // Cấu hình chuẩn
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
                console.log("❌ Không tìm thấy.");
                resolve(null);
            }
        });
    });
}

app.get('/', (req, res) => res.send(`Server Smart - ${serverStatus}`));

app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "SoundCloud", url: myServerUrl });
});

// --- API STREAM (24kHz + 64kbps + Buffer to) ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    console.log("🚀 Streaming (Smart Mode)...");

    ffmpeg(audioUrl)
        .inputOptions([
            '-reconnect 1', '-reconnect_streamed 1', '-reconnect_delay_max 5',
            '-probesize 128000',
            '-user_agent "Mozilla/5.0"'
        ])
        .audioFilters(['volume=2.5'])
        .audioCodec('libmp3lame')
        
        // --- CHUẨN ỔN ĐỊNH ---
        .audioBitrate(64)       
        .audioChannels(2)
        .audioFrequency(24000) // Khớp giọng Robot
        .format('mp3')
        
        .outputOptions([
            '-vn', '-map_metadata', '-1',
            '-id3v2_version', '0', '-write_id3v1', '0', '-write_xing', '0',
            '-flush_packets', '0',
            '-minrate', '64k', '-maxrate', '64k', '-bufsize', '128k', // Buffer to cho an toàn
            '-preset', 'ultrafast',
            '-movflags', 'frag_keyframe+empty_moov'
        ])
        .on('error', (err) => {
            if (!err.message.includes('Output stream closed')) console.error('Err:', err.message);
        })
        .pipe(res, { end: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy port ${PORT}`));
