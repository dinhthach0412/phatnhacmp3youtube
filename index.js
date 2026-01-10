/**
 * 🔥 ULTRA SERVER V10.1 – ESP32 SAFE AUDIO STREAM
 *
 * FIXED:
 *  - ❌ Không trả m3u8 / HLS
 *  - ❌ Không FFmpeg
 *  - ✅ Podcast phát như nhạc
 *  - ✅ yt-dlp ép audio thô (mp3/opus)
 *  - ✅ Proxy HTTP Range
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

// RSS Podcast (chỉ dùng làm metadata)
const GIANGOI_RSS =
  'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

// Cache nhẹ: tránh gọi yt-dlp liên tục
const audioCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 giờ

app.get('/', (req, res) => {
  res.send('🔥 ULTRA SERVER V10.1 READY (NO M3U8)');
});

/* ======================================================
   1. RESOLVE SOUNDCLOUD AUDIO (ÉP KHÔNG HLS)
   ====================================================== */
function resolveSoundCloud(query) {
  return new Promise((resolve, reject) => {

    // Cache
    const cached = audioCache.get(query);
    if (cached && cached.expire > Date.now()) {
      return resolve(cached.url);
    }

    const yt = spawn(YTDLP_PATH, [
      `scsearch1:${query}`,

      // 🔥 CẤM m3u8 / HLS – Ưu tiên mp3
      '-f', 'ba[ext=mp3]/ba[protocol!=m3u8]/ba',

      '--no-playlist',
      '--no-warnings',
      '-g'
    ]);

    let out = '';
    yt.stdout.on('data', d => out += d.toString());

    yt.on('close', code => {
      const url = out.trim().split('\n')[0];

      // 🚨 BẮT BUỘC: không cho m3u8 lọt qua
      if (!url || url.includes('.m3u8')) {
        return reject(new Error('Resolved HLS/m3u8 – rejected'));
      }

      if (code === 0 && url) {
        audioCache.set(query, {
          url,
          expire: Date.now() + CACHE_TTL
        });
        resolve(url);
      } else {
        reject(new Error('yt-dlp resolve failed'));
      }
    });
  });
}

/* ======================================================
   2. SEARCH API – MUSIC + PODCAST
   ====================================================== */
app.get('/search', async (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  console.log(`🔍 Search: ${q}`);

  /* ---------- PODCAST MODE ---------- */
  if (q.includes('cmd:podcast') || q.includes('giang oi')) {
    console.log('🎙 PODCAST MODE');

    let title = null;

    // 1️⃣ RSS → lấy title mới nhất
    try {
      const feed = await parser.parseURL(GIANGOI_RSS);
      if (feed.items && feed.items.length > 0) {
        title = feed.items[0].title;
        console.log(`📻 RSS title: ${title}`);
      }
    } catch (e) {
      console.warn('⚠️ RSS failed, fallback to keyword');
    }

    // 2️⃣ RSS fail → fallback keyword
    if (!title) {
      title = 'Giang Oi Radio Podcast';
    }

    try {
      const audioUrl = await resolveSoundCloud(title);
      const proxyUrl =
        `https://${req.get('host')}/proxy?url=${encodeURIComponent(audioUrl)}`;

      return res.json({
        success: true,
        mode: 'podcast',
        title,
        artist: 'Giang Ơi Radio',
        url: proxyUrl
      });

    } catch (e) {
      console.error('❌ Podcast resolve failed:', e.message);
      return res.json({ success: false, error: 'Podcast not playable' });
    }
  }

  /* ---------- MUSIC MODE ---------- */
  try {
    const audioUrl = await resolveSoundCloud(q);
    const proxyUrl =
      `https://${req.get('host')}/proxy?url=${encodeURIComponent(audioUrl)}`;

    return res.json({
      success: true,
      mode: 'music',
      title: q,
      artist: 'SoundCloud',
      url: proxyUrl
    });

  } catch (e) {
    console.error('❌ Music resolve failed:', e.message);
    return res.json({ success: false, error: 'Music not found' });
  }
});

/* ======================================================
   3. PROXY STREAM – RANGE SUPPORT (ESP32 CORE)
   ====================================================== */
function proxyStream(targetUrl, clientReq, clientRes) {
  let u;
  try {
    u = new URL(targetUrl);
  } catch {
    return clientRes.status(400).end();
  }

  const headers = {};
  if (clientReq.headers.range) {
    headers.Range = clientReq.headers.range;
  }

  https.get({
    hostname: u.hostname,
    path: u.pathname + u.search,
    headers
  }, stream => {

    // Redirect follow (SoundCloud hay dùng)
    if ([301, 302, 303, 307].includes(stream.statusCode)) {
      return proxyStream(stream.headers.location, clientReq, clientRes);
    }

    clientRes.statusCode = stream.statusCode;
    clientRes.setHeader('Content-Type', 'audio/mpeg');
    clientRes.setHeader('Accept-Ranges', 'bytes');
    clientRes.setHeader('Cache-Control', 'no-cache');

    if (stream.headers['content-range']) {
      clientRes.setHeader('Content-Range', stream.headers['content-range']);
    }

    stream.pipe(clientRes);

  }).on('error', err => {
    console.error('❌ Proxy error:', err.message);
    if (!clientRes.headersSent) clientRes.end();
  });
}

app.get('/proxy', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).end();
  console.log('▶️ Proxy streaming');
  proxyStream(url, req, res);
});

/* ======================================================
   4. START SERVER
   ====================================================== */
app.listen(PORT, () => {
  console.log(`🚀 ULTRA SERVER V10.1 running on port ${PORT}`);
});
