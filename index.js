/**
 * 🎵 SOUNDCLOUD SERVER V4 (FIXED LOGIC & USER-AGENT)
 * - Fix lỗi "Download 60KB EOF": Thêm User-Agent giả lập Chrome
 * - Fix lỗi Logic: Tách biệt Podcast và Music, không đè nhau
 * - Hỗ trợ Range Proxy (An toàn cho ESP32)
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

app.get('/', (req, res) => res.send('🔥 SoundCloud Server V4 Ready'));

/* =========================================
   1. HÀM PROXY THÔNG MINH (CÓ USER-AGENT)
   ========================================= */
function smartProxy(targetUrl, clientReq, clientRes) {
    let u;
    try {
        u = new URL(targetUrl);
    } catch (e) {
        console.error("❌ Invalid URL:", targetUrl);
        return clientRes.status(400).end();
    }

    const options = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
            // [QUAN TRỌNG] Giả danh Chrome để SoundCloud không chặn (Fix lỗi 60KB)
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://soundcloud.com/'
        }
    };

    // Chuyển tiếp Range Header từ ESP32
    if (clientReq.headers.range) {
        options.headers['Range'] = clientReq.headers.range;
    }

    https.get(options, (stream) => {
        // Xử lý Redirect (301, 302)
        if ([301, 302, 303, 307].includes(stream.statusCode)) {
            return smartProxy(stream.headers.location, clientReq, clientRes);
        }

        // Nếu SoundCloud chặn (403/404) -> Báo lỗi ngay
        if (stream.statusCode >= 400) {
            console.error(`❌ Proxy Error: SoundCloud trả về ${stream.statusCode}`);
            return clientRes.status(stream.statusCode).end();
        }

        // Trả về Header cho ESP32
        if (stream.statusCode === 206 || stream.headers['content-range']) {
            clientRes.statusCode = 206;
            if (stream.headers['content-range']) {
                clientRes.setHeader('Content-Range', stream.headers['content-range']);
            }
        } else {
            clientRes.statusCode = stream.statusCode;
        }

        clientRes.setHeader('Content-Type', 'audio/mpeg');
        clientRes.setHeader('Accept-Ranges', 'bytes');
        clientRes.setHeader('Cache-Control', 'no-cache');

        stream.pipe(clientRes);

    }).on('error', (err) => {
        console.error('❌ Proxy Socket Error:', err.message);
        if (!clientRes.headersSent) clientRes.status(500).end();
    });
}

app.get('/proxy', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).end();
    smartProxy(url, req, res);
});

/* =========================================
   2. HÀM TÌM KIẾM SOUNDCLOUD (YTDLP)
   ========================================= */
function searchSoundCloud(query) {
    return new Promise((resolve, reject) => {
        const proc = spawn(YTDLP_PATH, [
            `scsearch1:${query}`, 
            '--dump-json',        
            '--no-playlist',
            '--format', 'bestaudio/best' 
        ]);

        let output = '';
        proc.stdout.on('data', d => output += d.toString());
        
        proc.on('close', code => {
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
   3. API TÌM KIẾM (ĐÃ TÁCH LUỒNG)
   ========================================= */
app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    console.log(`🔍 Search: ${q}`);

    // --- LUỒNG 1: PODCAST (Ưu tiên RSS) ---
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
            return res.json({ success: false, error: 'Lỗi lấy RSS Podcast' });
        }
        // [QUAN TRỌNG] Nếu chạy đến đây mà không return thì return lỗi luôn, KHÔNG nhảy xuống Music
        return res.json({ success: false, error: 'Không tìm thấy Podcast' });
    }

    // --- LUỒNG 2: NHẠC SOUNDCLOUD (Chỉ chạy khi KHÔNG PHẢI podcast) ---
    console.log("☁️ Mode: SOUNDCLOUD MUSIC");
    try {
        const data = await searchSoundCloud(q);
        const proxyUrl = `https://${req.get('host')}/proxy?url=${encodeURIComponent(data.url)}`;

        console.log(`✅ Found SC: ${data.title}`);
        return res.json({
            success: true,
            title: data.title,
            artist: data.uploader || 'SoundCloud Artist',
            url: proxyUrl
        });

    } catch (e) {
        console.error("SC Error:", e.message);
        return res.json({ success: false, error: 'Không tìm thấy nhạc' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 SoundCloud Server V4 running on port ${PORT}`);
});
