const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios'); // Nhớ đảm bảo package.json có axios
const fs = require('fs');

const app = express();
app.use(cors());

// --- 1. TẠO FILE COOKIES (Để yt-dlp dùng) ---
if (process.env.YT_COOKIES) {
    try {
        fs.writeFileSync('cookies.txt', process.env.YT_COOKIES);
        console.log("✅ Đã nạp Cookies thành công.");
    } catch (err) { console.error("❌ Lỗi tạo cookies:", err); }
}

// --- 2. HÀM LẤY LINK AUDIO GỐC (Dùng yt-dlp + Cookies) ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        console.log(`1️⃣ Đang xin Link Youtube cho: "${query}"...`);
        
        const yt = spawn('/usr/local/bin/yt-dlp', [ // Đường dẫn tuyệt đối
            `ytsearch1:${query}`,
            '-f', 'bestaudio',     // Lấy file audio tốt nhất
            '--get-url',           // Chỉ lấy Link
            '--cookies', 'cookies.txt', // Quan trọng: Dùng Cookies
            '--force-ipv4',
            '--no-playlist',
            '--no-warnings'
        ]);

        let url = '';
        
        yt.stdout.on('data', d => url += d.toString());
        
        yt.on('close', code => {
            if (code === 0 && url.trim()) {
                // Lấy link đầu tiên nếu có nhiều dòng
                const finalUrl = url.trim().split('\n')[0];
                console.log("✅ Đã có Link Gốc.");
                resolve(finalUrl);
            } else {
                console.error("❌ yt-dlp không trả về link (Kiểm tra Cookies).");
                resolve(null);
            }
        });
    });
}

// --- 3. API TÌM KIẾM (Trả về link stream của server mình) ---
app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });

    console.log(`🔍 ESP32 tìm: ${q}`);

    // Mẹo: Trả về link stream luôn, trong link chứa Query tìm kiếm
    // Khi ESP32 gọi link này, Server mới bắt đầu tìm và convert (Real-time)
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;

    res.json({
        success: true,
        title: q,
        artist: "Youtube",
        url: myServerUrl
    });
});

// --- 4. API STREAM (TRÁI TIM CỦA HỆ THỐNG) ---
// Kết hợp: yt-dlp (lấy link) -> Axios (tải luồng) -> FFmpeg (lọc MP3) -> ESP32
app.get('/stream', async (req, res) => {
    const q = req.query.q; // Nhận từ khóa tìm kiếm
    if (!q) return res.status(400).send("No query");

    // BƯỚC 1: Lấy Link Gốc
    const audioUrl = await getAudioUrl(q);
    if (!audioUrl) return res.status(404).send("No audio found");

    console.log("🚀 Bắt đầu Stream & Convert...");

    // Thiết lập Header chuẩn cho ESP32
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Connection', 'close'); // Ngắt kết nối sạch sẽ

    try {
        // BƯỚC 2: Dùng Axios hút dữ liệu về (Giả danh trình duyệt)
        const response = await axios({
            url: audioUrl,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        // BƯỚC 3: Dùng FFmpeg lọc và nén sang MP3 chuẩn cơm mẹ nấu
        ffmpeg(response.data)
            .audioCodec('libmp3lame')
            .audioBitrate(128)      // 128kbps (Chuẩn)
            .audioChannels(2)       // Stereo
            .audioFrequency(44100)  // 44.1kHz (Cực quan trọng để tránh lỗi -6)
            .format('mp3')          // Ép chặt là MP3
            .outputOptions([
                '-vn',              // Bỏ Video
                '-map_metadata', '-1', // Xóa sạch thông tin rác (Cover, Tên bài..) để nhẹ header
                '-preset', 'ultrafast' // Nén siêu nhanh
            ])
            .on('error', err => {
                // Chỉ log lỗi nếu không phải do ESP32 ngắt kết nối
                if (!err.message.includes('Output stream closed')) {
                    console.error('🔥 FFmpeg error:', err.message);
                }
            })
            .pipe(res, { end: true }); // Bơm về ESP32

    } catch (e) {
        console.error("❌ Lỗi Axios Stream:", e.message);
        if (!res.headersSent) res.status(502).send('Stream Error');
    }
});

// Test
app.get('/', (req, res) => { res.send('SERVER FINAL (AXIOS + FFMPEG CLEAN) 🚀'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
