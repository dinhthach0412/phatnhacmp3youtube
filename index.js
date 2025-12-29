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
updateProcess.on('close', () => { serverStatus = "Online (High Accuracy Mode)"; });

// --- HÀM LẤY LINK (CHÍNH XÁC CAO) ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        lastQuery = query;
        console.log(`🔍 Đang tìm kỹ: ${query}`);
        
        const args = [
            // QUAY LẠI TÌM 5 BÀI ĐỂ LẤY BÀI CHUẨN NHẤT
            `scsearch5:${query}`, 
            
            // Bộ lọc định dạng (Lấy MP3/M4A, Cấm Opus)
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
                // Lấy kết quả đầu tiên sau khi đã lọc kỹ
                const finalUrl = url.trim().split('\n')[0];
                console.log(`✅ Link Chuẩn: ${finalUrl}`);
                resolve(finalUrl);
            } else {
                console.log("❌ Không tìm thấy.");
                resolve(null);
            }
        });
    });
}

app.get('/', (req, res) => res.send(`Server Accurate - ${serverStatus}`));

app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "SoundCloud", url: myServerUrl });
});

// --- API STREAM (24kHz Sync + Tìm chuẩn) ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    console.log("🚀 Streaming (24kHz Mode)...");

    ffmpeg(audioUrl)
        .inputOptions([
            '-reconnect 1', '-reconnect_streamed 1', '-reconnect_delay_max 5',
            '-probesize 128000',
            '-user_agent "Mozilla/5.0"'
        ])
        .audioFilters(['volume=2.5'])
        .audioCodec('libmp3lame')
        .audioBitrate(64)       
        .audioChannels(2)
        
        // --- GIỮ NGUYÊN 24000HZ ĐỂ KHỚP GIỌNG ROBOT ---
        .audioFrequency(24000)
        // ---------------------------------------------
        
        .format('mp3')
        .outputOptions([
            '-vn', '-map_metadata', '-1',
            '-id3v2_version', '0', '-write_id3v1', '0', '-write_xing', '0',
            '-flush_packets', '0',
            '-minrate', '64k', '-maxrate', '64k', '-bufsize', '128k',
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
