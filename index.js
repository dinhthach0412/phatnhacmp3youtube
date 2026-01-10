/**
 * 🔥 ULTRA SERVER V10.2.2 – FINAL STABLE FOR ESP32
 *
 * FIX:
 *  - CDN SoundCloud không im lặng nữa
 *  - Có byte audio ngay
 *  - Không timeout
 *  - Không WDT
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const Parser = require('rss-parser');
const https = require('https');
const http = require('http');

const app = express();
const parser = new Parser();
app.use(cors());

const PORT = process.env.PORT || 10000;
const YTDLP_PATH = './yt-dlp';

const GIANGOI_RSS =
  'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

const audioCache = new Map();
const CACHE_TTL = 60 * 60 * 1000;
let lastPodcastTitle = null;

/* ================= RESOLVE AUDIO ================= */
function resolveSoundCloud(query) {
  return new Promise((resolve, reject) => {
    const cached = audioCache.get(query);
    if (cached && cached.expire > Date.now()) {
      return resolve(cached.url);
    }

    const yt = spawn(YTDLP_PATH, [
      `scsearch1:${query}`,
      '-f', 'ba[ext=mp3]/ba[protocol!=m3u8]/ba',
      '--no-playlist',
      '--no-warnings',
      '-g'
    ]);

    let out = '';
    yt.stdout.on('data', d => out += d.toString());

    yt.on('close', () => {
      const url = out.trim().split('\n')[0];
      if (!url || url.includes('.m3u8')) {
        return reject(new Error('m3u8 rejected'));
      }
      audioCache.set(query, { url, expire: Date.now() + CACHE_TTL });
      resolve(url);
    });
  });
}

/* ================= SEARCH ================= */
app.get('/search', async (req, res) => {
  const q = (req.query.q || '').toLowerCase();

  if (q.includes('cmd:podcast') || q.includes('giang oi')) {
    let title = null;
    try {
      const feed = await parser.parseURL(GIANGOI_RSS);
      const items = feed.items.filter(i => i?.title).slice(0, 30);
      if (items.length) {
        let pick;
        do {
          pick = items[Math.floor(Math.random() * items.length)];
        } while (items.length > 1 && pick.title === lastPodcastTitle);
        lastPodcastTitle = pick.title;
        title = pick.title;
      }
    } catch {}

    if (!title) title = 'Giang Oi Radio Podcast';

    const audioUrl = await resolveSoundCloud(title);
    return res.json({
      success: true,
      mode: 'podcast',
      title,
      artist: 'Giang Ơi Radio',
      url: `https://${req.get('host')}/proxy?url=${encodeURIComponent(audioUrl)}`
    });
  }

  const audioUrl = await resolveSoundCloud(q);
  return res.json({
    success: true,
    mode: 'music',
    title: q,
    artist: 'SoundCloud',
    url: `https://${req.get('host')}/proxy?url=${encodeURIComponent(audioUrl)}`
  });
});

/* ================= PROXY – FIX CDN ================= */
app.get('/proxy', (req, res) => {
  const target = req.query.url;
  if (!target) return res.end();

  const u = new URL(target);
  const lib = u.protocol === 'http:' ? http : https;

  const headers = {
    // 🔥 BẮT BUỘC
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Accept': '*/*',
    'Connection': 'keep-alive'
  };

  if (req.headers.range) headers.Range = req.headers.range;

  const upstream = lib.get({
    hostname: u.hostname,
    path: u.pathname + u.search,
    headers,
    keepAlive: true
  }, r => {

    if ([301,302,303,307].includes(r.statusCode)) {
      return res.redirect(r.headers.location);
    }

    // ❌ Không chunked
    res.removeHeader('Transfer-Encoding');

    if (r.headers['content-length']) {
      res.setHeader('Content-Length', r.headers['content-length']);
    }
    if (r.headers['content-range']) {
      res.setHeader('Content-Range', r.headers['content-range']);
    }

    res.statusCode = r.statusCode;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');

    r.pipe(res, { end: true });
  });

  upstream.on('error', err => {
    console.error('Proxy error:', err.message);
    res.end();
  });
});

app.listen(PORT, () => {
  console.log(`🚀 ULTRA SERVER V10.2.2 running on ${PORT}`);
});
