/**
 * 🎵 SOUNDCLOUD ONLY SERVER (NO YOUTUBE)
 * - Tất cả nhạc lấy từ SoundCloud (qua yt-dlp scsearch)
 * - Podcast lấy từ RSS SoundCloud
 * - TẤT CẢ đều đi qua Proxy hỗ trợ Range (Tránh crash ESP32)
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const Parser = require('rss-parser');
const https = require('https');

const app = express();
const parser = new Parser();
app.use(cors());

const PORT = process.env.PORT || 10000;
const YTDLP_PATH = './yt-dlp'; // Vẫn cần tool này để tìm link SoundCloud nhạc

// RSS Podcast Giang Ơi (SoundCloud)
const GIANGOI_RSS = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

app.get('/', (req, res) => res.send('☁️ SoundCloud Stream Server Ready (Range Support)'));

/* =========================================
   1. HÀM PROXY THÔNG MINH (HỖ TRỢ RANGE)
   - Đây là "Trái tim" giúp ESP32 không bị sập
   - Hỗ trợ tua, resume, tải từng đoạn nhỏ
   ========================================= */
function smartProxy(targetUrl, clientReq, clientRes) {
    let u;
    try {
        u = new URL(targetUrl);
    } catch (e) {
        console.error("Invalid URL:", targetUrl);
        return clientRes.status(400).end();
    }

    const options = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {}
    };

    // [QUAN TRỌNG] Chuyển tiếp yêu cầu Range từ ESP32 lên Server gốc
    // Ví dụ: ESP32 xin "cho tao byte từ 0-4096" -> Server chuyển y hệt lên SoundCloud
    if (clientReq.headers.range) {
        options.headers['Range'] = clientReq.headers.range;
    }

    https.get(options, (stream) => {
        // 1. Xử lý Redirect (SoundCloud rất hay redirect 302)
        if ([301, 302, 303, 307].includes(stream.statusCode)) {
            return smartProxy(stream.headers.location, clientReq, clientRes);
        }

        // 2. Trả về Header chuẩn cho ESP32
        if (stream.statusCode === 206 || stream.headers['content-range']) {
            clientRes.statusCode = 206; // 206 = Partial Content (Thành công một phần)
            if (stream.headers['content-range']) {
                clientRes.setHeader('Content-Range', stream.headers['content-range']);
            }
        } else {
            clientRes.statusCode = stream.statusCode;
        }

        clientRes.setHeader('Content-Type', 'audio/mpeg');
        clientRes.setHeader('Accept-Ranges', 'bytes'); // Báo hiệu: "Tao hỗ trợ Range nha"
        clientRes.setHeader('Cache-Control', 'no-cache');

        // 3. Bơm dữ liệu (Pipe) - Nước chảy đến đâu ESP32 uống đến đó
        stream.pipe(clientRes);

    }).on('error', (err) => {
        console.error('❌ Proxy Error:', err.message);
        if (!clientRes.headersSent) clientRes.status(500).end();
    });
}

// Route Stream chung cho cả Nhạc và Podcast
app.get('/proxy', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).end();
    smartProxy(url, req, res);
});

/* =========================================
   2. HÀM TÌM NHẠC TRÊN SOUNDCLOUD (Dùng yt-dlp)
   - Lưu ý: Dùng yt-dlp nhưng tìm trên SoundCloud (scsearch1)
   ========================================= */
function searchSoundCloud(query) {
    return new Promise((resolve, reject) => {
        const searchProcess = spawn(YTDLP_PATH, [
            `scsearch1:${query}`, // CHỈ TÌM SOUNDCLOUD (1 kết quả)
            '--dump-json',        // Lấy thông tin chi tiết
            '--no-playlist',
            '--format', 'bestaudio/best' // Lấy audio tốt nhất
        ]);

        let output = '';
        searchProcess.stdout.on('data', (d) => output += d.toString());
        
        searchProcess.on('close', (code) => {
            if (code !== 0 || !output) return reject(new Error('No result'));
            try {
                const data = JSON.parse(output);
                resolve(data);
            } catch (e) {
                reject(e);
            }
        });
    });
}

/* =========================================
   3. API TÌM KIẾM TỔNG HỢP
   ========================================= */
app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    console.log(`🔍 Search: ${q}`);

    // --- MODE A: PODCAST (Giang Ơi - Ưu tiên RSS cho nhanh) ---
    if (q.includes('cmd:podcast') || q.includes('giang oi')) {
        console.log('🎙 Mode: PODCAST (RSS)');
        try {
            const feed = await parser.parseURL(GIANGOI_RSS);
            const item = feed.items[0];

            if (item) {
                const audioUrl = item.enclosure ? item.enclosure.url : item.link;
                // Đóng gói vào Proxy
                const proxyUrl = `https://${req.get('host')}/proxy?url=${encodeURIComponent(audioUrl)}`;

                return res.json({
                    success: true,
                    title: item.title,
                    artist: 'Giang Oi Radio',
                    url: proxyUrl, // <--- Link này an toàn 100%
                    is_podcast: true
                });
            }
        } catch (e) {
            console.error('RSS Error:', e.message);
            // Nếu lỗi RSS thì nhảy xuống tìm SoundCloud search bên dưới
        }
    }

    // --- MODE B: NHẠC LẺ (Tìm trên SoundCloud) ---
    console.log("☁️ Mode: SOUNDCLOUD MUSIC SEARCH");
    try {
        // Gọi hàm tìm kiếm SoundCloud
        const data = await searchSoundCloud(q);
        
        // Đóng gói vào Proxy
        const proxyUrl = `https://${req.get('host')}/proxy?url=${encodeURIComponent(data.url)}`;

        console.log(`✅ Found SC: ${data.title}`);
        res.json({
            success: true,
            title: data.title,
            artist: data.uploader || 'SoundCloud Artist',
            url: proxyUrl // <--- Link này cũng an toàn 100%
        });

    } catch (e) {
        console.error("SC Search Error:", e.message);
        res.json({ success: false, error: 'Không tìm thấy nhạc trên SoundCloud' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 SoundCloud Proxy Server running on port ${PORT}`);
});
