const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const Parser = require('rss-parser');
const https = require('https'); // Dùng thư viện gốc cho nhẹ

const app = express();
const parser = new Parser();
app.use(cors());

const PORT = process.env.PORT || 10000;
const YTDLP_PATH = './yt-dlp';

// Link RSS Giang Ơi (SoundCloud)
const GIANGOI_RSS = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

app.get('/', (req, res) => res.send('Podcast Server Ready'));

app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    console.log(`🔍 Searching: ${q}`);

    // --- CHIẾN THUẬT MỚI: BẮT RSS TRỰC TIẾP ---
    if (q.includes('cmd:podcast') || q.includes('giang oi')) {
        console.log("⚡ Mode: PODCAST - Đọc thẳng RSS (Không dùng yt-dlp)");
        
        try {
            const feed = await parser.parseURL(GIANGOI_RSS);
            const item = feed.items[0]; // Lấy bài mới nhất

            if (item && item.enclosure && item.enclosure.url) {
                // Lấy link gốc từ SoundCloud
                const originalUrl = item.enclosure.url;
                const title = item.title;

                console.log(`✅ Tìm thấy: ${title}`);
                
                // MẸO QUAN TRỌNG:
                // Link SoundCloud là HTTPS redirect, ESP32 xử lý rất cực.
                // Chúng ta sẽ biến Server Render thành cái "Trung gian" (Proxy).
                // Robot chỉ cần gọi link của Server mình, Server mình sẽ bơm dữ liệu về.
                const proxyUrl = `https://${req.get('host')}/proxy?url=${encodeURIComponent(originalUrl)}`;

                return res.json({
                    success: true,
                    title: title, // Tên bài
                    artist: "Giang Oi Radio",
                    url: proxyUrl // Link Proxy (An toàn cho ESP32)
                });
            }
        } catch (e) {
            console.error("Lỗi RSS:", e.message);
            // Nếu lỗi thì chạy xuống fallback Youtube bên dưới
        }
    }

    // --- FALLBACK: TÌM YOUTUBE (Giữ nguyên code cũ) ---
    // (Đoạn code yt-dlp cũ của bạn để ở đây...)
    // ...
});

// --- HÀM MỚI: PROXY STREAMING (Quan trọng để trị file dài) ---
// Hàm này giúp ESP32 "ăn từng miếng" mà không cần lo HTTPS hay Redirect
app.get('/proxy', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).end();

    console.log(`▶️ Proxying: ${targetUrl}`);

    https.get(targetUrl, (stream) => {
        // Xử lý Redirect (SoundCloud hay có trò này)
        if (stream.statusCode === 301 || stream.statusCode === 302) {
            return res.redirect(stream.headers.location);
        }

        // Set Header trả về là MP3
        res.setHeader('Content-Type', 'audio/mpeg');
        
        // Nối ống bơm dữ liệu thẳng từ SoundCloud về ESP32
        stream.pipe(res); 

    }).on('error', (e) => {
        console.error("Proxy Error:", e.message);
        res.end();
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on ${PORT}`);
});
