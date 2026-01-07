/**
 * 🎵 SOUNDCLOUD SERVER V6 (HYBRID STABLE)
 * - Tốc độ: Dùng yt-dlp lấy link (nhanh) + Node.js Proxy (ổn định)
 * - Fix lỗi 60KB: Fake User-Agent xịn như Chrome
 * - Fix lỗi Client ngắt kết nối: Phản hồi ngay lập tức, không delay
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
const YTDLP_PATH = './yt-dlp'; 

// RSS Podcast Giang Ơi
const GIANGOI_RSS = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

app.get('/', (req, res) => res.send('🔥 SoundCloud Server V6 (Stable) Ready'));

/* =========================================
   1. HÀM PROXY ỔN ĐỊNH (FIX USER-AGENT)
   - Dùng thư viện https của Node (nhẹ, nhanh) thay vì bắt yt-dlp tải
   - Thêm Header giả danh Chrome để không bị chặn 60KB
   ========================================= */
function stableProxy(targetUrl, clientReq, clientRes) {
    let u;
    try {
        u = new URL(targetUrl);
    } catch (e) {
        return clientRes.status(400).end();
    }

    const options = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
            // [CỰC QUAN TRỌNG] Fake User-Agent để SoundCloud tưởng là trình duyệt
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://soundcloud.com/',
            'Accept': '*/*',
            'Connection': 'keep-alive'
        }
    };

    // Forward Range Header (Để ESP32 có thể tải từng đoạn)
    if (clientReq.headers.range) {
        options.headers['Range'] = clientReq.headers.range;
    }

    const proxyReq = https.get(options, (stream) => {
        // Xử lý Redirect (302)
        if ([301, 302, 303, 307].includes(stream.statusCode)) {
            return stableProxy(stream.headers.location, clientReq, clientRes);
        }

        // Trả về Header cho ESP32
        if (stream.statusCode === 206 || stream.headers['content-range']) {
            clientRes.statusCode = 206;
            if (stream.headers['content-range']) clientRes.setHeader('Content-Range', stream.headers['content-range']);
        } else {
            clientRes.statusCode = stream.statusCode;
        }

        clientRes.setHeader('Content-Type', 'audio/mpeg');
        clientRes.setHeader('Accept-Ranges', 'bytes'); // Báo ESP32: OK tao hỗ trợ tua
        
        // Bơm dữ liệu
        stream.pipe(clientRes);
    });

    proxyReq.on('error', (err) => {
        console.error('Proxy Error:', err.message);
        if (!clientRes.headersSent) clientRes.end();
    });
}

app.get('/proxy', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).end();
    // console.log(`▶️ Proxying: ${url}`); // Tắt log này cho đỡ rác
    stableProxy(url, req, res);
});

/* =========================================
   2. HÀM LẤY LINK TRỰC TIẾP (Dùng yt-dlp -g)
   - Chỉ lấy link (mất 0.5s) chứ không tải file -> Rất nhanh
   ========================================= */
function getDirectLink(query) {
    return new Promise((resolve, reject) => {
        const proc = spawn(YTDLP_PATH, [
            `scsearch1:${query}`, 
            '-g',                  // CHỈ LẤY LINK (Get URL)
            '--no-playlist'
        ]);

        let output = '';
        proc.stdout.on('data', d => output += d.toString());
        
        proc.on('close', code => {
            const link = output.trim();
            if (code !== 0 || !link) return reject(new Error('No result'));
            resolve({ url: link, title: query }); // Lưu ý: -g không trả về title chuẩn, tạm dùng query
        });
    });
}

// Hàm lấy thông tin chi tiết (nếu cần title chuẩn) - Chậm hơn chút
function getInfoJson(query) {
    return new Promise((resolve, reject) => {
        const proc = spawn(YTDLP_PATH, [
            `scsearch1:${query}`, 
            '--dump-json',        
            '--no-playlist'
        ]);

        let output = '';
        proc.stdout.on('data', d => output += d.toString());
        
        proc.on('close', code => {
            if (code !== 0 || !output) return reject(new Error('No result'));
            try {
                resolve(JSON.parse(output));
            } catch(e) { reject(e); }
        });
    });
}

/* =========================================
   3. API TÌM KIẾM
   ========================================= */
app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    console.log(`🔍 Search: ${q}`);

    // --- PODCAST (RSS) ---
    if (q.includes('cmd:podcast') || q.includes('giang oi')) {
        console.log('🎙 Mode: PODCAST (RSS)');
        try {
            const feed = await parser.parseURL(GIANGOI_RSS);
            const item = feed.items[0];
            if (item) {
                const audioUrl = item.enclosure ? item.enclosure.url : item.link;
                const proxyUrl = `https://${req.get('host')}/proxy?url=${encodeURIComponent(audioUrl)}`;
                
                return res.json({
                    success: true,
                    title: item.title,
                    artist: 'Giang Oi Radio',
                    url: proxyUrl,
                    is_podcast: true
                });
            }
        } catch (e) {
            console.error('RSS Error:', e.message);
        }
        return res.json({ success: false, error: 'Lỗi Podcast' });
    }

    // --- MUSIC (SOUNDCLOUD) ---
    console.log("☁️ Mode: SOUNDCLOUD MUSIC");
    try {
        // Cách 1: Lấy JSON đầy đủ (Title chuẩn + Link gốc)
        const data = await getInfoJson(q);
        
        // Link stream trực tiếp từ SoundCloud (thường rất dài)
        const directStreamUrl = data.url; 
        
        // Đóng gói vào Proxy V6
        const proxyUrl = `https://${req.get('host')}/proxy?url=${encodeURIComponent(directStreamUrl)}`;

        console.log(`✅ Found: ${data.title}`);
        return res.json({
            success: true,
            title: data.title,
            artist: data.uploader,
            url: proxyUrl
        });

    } catch (e) {
        console.error("SC Error:", e.message);
        return res.json({ success: false, error: 'Không tìm thấy nhạc' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 SoundCloud V6 (Stable) running on port ${PORT}`);
});
