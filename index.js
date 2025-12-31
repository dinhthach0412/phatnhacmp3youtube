const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

// --- TRẠNG THÁI SERVER ---
let serverStatus = "Booting...";

// Update yt-dlp (Tự động cập nhật công cụ tải khi khởi động)
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => { serverStatus = "Online (Stable Core)"; });

// --- HÀM LẤY LINK (SCSEARCH1 - TÌM NHANH) ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        // Lọc từ khóa rác
        let cleanQuery = query.toLowerCase().replace(/youtube|zing|mp3|phát nhạc|mở nhạc|bài hát|của/g, "").trim();
        let finalQuery = cleanQuery.length > 1 ? cleanQuery : query;
        
        console.log(`🔍 Tìm: "${finalQuery}"`);
        
        const args = [
            `scsearch1:${finalQuery}`, // Tìm 1 bài (Ưu tiên tốc độ)
            '-f', 'bestaudio/best',    // Lấy link xịn nhất (Kể cả m3u8)
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
                console.log("❌ Không tìm thấy bài nào.");
                resolve(null);
            }
        });
    });
}

app.get('/', (req, res) => res.send(`Server Music ESP32 - ${serverStatus}`));

app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "SoundCloud", url: myServerUrl });
});

// --- API STREAM (FFMPEG ĐẢM NHIỆM TẤT CẢ) ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    console.log("🚀 Streaming...");

    // 
    // FFmpeg tự xử lý Input -> Filter -> Encode -> Pipe ra Response
    ffmpeg(audioUrl)
        .inputOptions([
            '-reconnect 1', 
            '-reconnect_streamed 1', 
            '-reconnect_delay_max 5',
            '-probesize 128000',     // Thăm dò nhanh
            '-user_agent "Mozilla/5.0"'
        ])
        
        // --- CHỈNH VOLUME 2.0 (Vừa đủ nghe, không rè) ---
        .audioFilters(['volume=2.0']) 
        
        .audioCodec('libmp3lame')
        .audioBitrate(64)       
        .audioChannels(2)
        .audioFrequency(44100) // Chuẩn 44.1kHz (ESP32 code mới đã cân tốt)
        .format('mp3')
        
        .outputOptions([
            '-vn', '-map_metadata', '-1',
            '-id3v2_version', '0', '-write_id3v1', '0', '-write_xing', '0',
            '-flush_packets', '1',  // Đẩy gói tin đi ngay (Giảm độ trễ)
            '-bufsize', '64k',      // Buffer vừa miếng
            '-minrate', '64k', '-maxrate', '64k', 
            '-preset', 'ultrafast',
            '-movflags', 'frag_keyframe+empty_moov'
        ])
        .on('error', (err) => {
            // Bỏ qua lỗi client ngắt kết nối
            if (!err.message.includes('Output stream closed')) console.error('Err:', err.message);
        })
        .pipe(res, { end: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy port ${PORT}`));
