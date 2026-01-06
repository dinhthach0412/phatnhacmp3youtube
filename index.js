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

// RSS Podcast SoundCloud – Giang Ơi
const GIANGOI_RSS = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

app.get('/', (req, res) => res.send('Podcast Server Ready'));

/* =========================
   HÀM RESOLVE AUDIO PODCAST
   ========================= */
function resolveSoundCloudAudio(query) {
    return new Promise((resolve, reject) => {
        const p = spawn(YTDLP_PATH, [
            `scsearch1:${query}`,
            '-f', 'bestaudio',
            '--no-playlist',
            '-g'
        ]);

        let out = '';
        p.stdout.on('data', d => out += d.toString());
        p.on('close', () => {
            out = out.trim();
            out ? resolve(out) : reject(new Error('yt-dlp failed'));
        });
    });
}

/* =========================
   API SEARCH
   ========================= */
app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    console.log(`🔍 Searching: ${q}`);

    // ===== PODCAST MODE =====
    if (q.includes('cmd:podcast') || q.includes('giang oi')) {
        console.log("🎙 PODCAST MODE (RSS + yt-dlp)");

        try {
            // 1️⃣ Đọc RSS → lấy metadata
            const feed = await parser.parseURL(GIANGOI_RSS);
            const item = feed.items[0];
            if (!item) throw new Error('RSS empty');

            const title = item.title;
            console.log(`📻 RSS Title: ${title}`);

            // 2️⃣ Resolve audio THẬT bằng yt-dlp
            const audioUrl = await resolveSoundCloudAudio(title);
            console.log(`🎧 Audio URL resolved`);

            // 3️⃣ Proxy cho ESP32/XiaoZhi
            const proxyUrl = `https://${req.get('host')}/proxy?url=${encodeURIComponent(audioUrl)}`;

            return res.json({
                success: true,
                title,
                artist: 'Giang Ơi Radio',
                url: proxyUrl
            });

        } catch (e) {
            console.error('❌ Podcast error:', e.message);
            return res.json({ success: false, error: 'Podcast not available' });
        }
    }

    // ===== FALLBACK (nếu bạn muốn gắn nhạc/youtube sau) =====
    return res.json({ success: false, error: 'No match' });
});

/* =========================
   PROXY STREAM (CHUẨN ESP32)
   ========================= */
function proxyStream(url, res) {
    https.get(url, stream => {
        // Xử lý redirect vô hạn (SoundCloud hay dùng)
        if ([301, 302].includes(stream.statusCode)) {
            return proxyStream(stream.headers.location, res);
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        stream.pipe(res);
    }).on('error', err => {
        console.error('Proxy error:', err.message);
        res.end();
    });
}

app.get('/proxy', (req, res) => {
    if (!req.query.url) return res.end();
    console.log(`▶️ Proxying audio`);
    proxyStream(req.query.url, res);
});

/* =========================
   START SERVER
   ========================= */
app.listen(PORT, () => {
    console.log(`🚀 Podcast server running on port ${PORT}`);
});
