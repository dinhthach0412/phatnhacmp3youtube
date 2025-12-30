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
updateProcess.on('close', () => { serverStatus = "Online (Balanced Mode)"; });

// --- HÀM LẤY LINK ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        // Lọc từ khóa rác
        let cleanQuery = query.toLowerCase().replace(/youtube|zing|mp3|phát nhạc|mở nhạc|bài hát|của/g, "").trim();
        let finalQuery = cleanQuery.length > 1 ? cleanQuery : query;
        
        lastQuery = finalQuery;
        console.log(`🔍 Tìm: "${finalQuery}"`);
        
        const args = [
            `scsearch5:${finalQuery}`, // Tìm kỹ 5 bài
            '-f', 'http_mp3_128/bestaudio[ext=mp3]/bestaudio[ext=m4a]/bestaudio[acodec!=opus]', 
            '--get-url', '--no-playlist', '--no-warnings', '--force-ipv4', '--no-check-certificate'
        ];

        const yt = spawn('/usr/local/bin/yt-dlp', args);
        let url = '';

        yt.stdout.on('data', d => url += d.toString());
        
        yt.on('close', code => {
            if (code === 0 && url.trim()) {
                const finalUrl = url.trim().split('\n')[0];
                console.log(`✅ Link: ${finalUrl}`);
                resolve(finalUrl);
            } else {
                console.log("❌ Not Found");
                resolve(null);
            }
        });
    });
}

app.get('/', (req, res) => res.send(`Server Balanced - ${serverStatus}`));

app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "SoundCloud", url: myServerUrl });
});

// --- API STREAM (CÂN BẰNG GIỮA TỐC ĐỘ VÀ ỔN ĐỊNH) ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    console.log("🚀 Streaming (Balanced 64k)...");

    ffmpeg(audioUrl)
        .inputOptions([
            '-reconnect 1', '-reconnect_streamed 1', '-reconnect_delay_max 5',
            '-probesize 128000',
            '-user_agent "Mozilla/5.0"'
        ])
        .audioFilters(['volume=2.5'])
        .audioCodec('libmp3lame')
        
        // --- CHUẨN 64KBPS + 24KHZ (KHỚP GIỌNG ROBOT) ---
        .audioBitrate(64)       
        .audioChannels(2)
        .audioFrequency(24000) 
        .format('mp3')
        
        .outputOptions([
            '-vn', '-map_metadata', '-1',
            '-id3v2_version', '0', '-write_id3v1', '0', '-write_xing', '0',
            
            // --- CẤU HÌNH QUAN TRỌNG: CHỮA LỖI CHUNK FAILED ---
            '-flush_packets', '1',  // Cho phép xả gói tin ngay lập tức (Chống timeout)
            '-bufsize', '64k',      // Giảm buffer xuống 64k (Vừa miếng)
            // --------------------------------------------------

            '-minrate', '64k', '-maxrate', '64k', 
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
