/**
 * Smart Audio Server - DEBUG EDITION
 * Added: Clickable Stream Link in Logs
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const Parser = require('rss-parser');

const app = express();
const parser = new Parser();
app.use(cors());

// ======================
// CONFIG
// ======================
const YTDLP_PATH = '/usr/local/bin/yt-dlp';
const PORT = process.env.PORT || 3000;
const GIANGOI_RSS_URL = 'https://feeds.soundcloud.com/users/soundcloud:users:253460064/sounds.rss';

let serverStatus = 'Booting...';

spawn(YTDLP_PATH, ['-U']).on('close', () => {
    serverStatus = 'Online (Debug Mode)';
    console.log('✅ yt-dlp updated');
});

app.get('/', (req, res) => res.send(`Smart Audio Server – ${serverStatus}`));

function cleanTitle(str) {
    if (!str) return 'Unknown Track';
    let clean = str.replace(/(\r\n|\n|\r)/gm, " ").trim();
    if (clean.length > 50) clean = clean.substring(0, 50) + '...';
    return clean;
}

// ======================
// 1. SEARCH (CÓ LOG LINK)
// ======================
app.get('/search', async (req, res) => {
    const q = req.query.q || '';
    if (!q) return res.status(400).json({ error: 'No query' });

    console.log(`🔍 Searching: ${q}`);
    const keyword = q.toLowerCase();

    // --- CASE 1: RSS (GIANG OI) ---
    if (keyword.includes('giang oi') || keyword.includes('giangoi') || keyword.includes('podcast')) {
        try {
            const feed = await parser.parseURL(GIANGOI_RSS_URL);
            const latestItem = feed.items[0]; 
            
            if (latestItem) {
                const safeTitle = cleanTitle(latestItem.title);
                // Tạo link stream
                const streamUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(latestItem.enclosure.url)}`;
                
                console.log(`✅ Found RSS: ${safeTitle}`);
                console.log(`👉 CLICK TEST: ${streamUrl}`); // <--- Dòng bạn cần đây

                return res.json({
                    success: true,
                    title: safeTitle,
                    artist: 'Giang Oi Radio',
                    url: streamUrl
                });
            }
        } catch (e) {
            console.error('RSS Fail, fallback to Search');
        }
    }

    // --- CASE 2: SOUNDCLOUD SEARCH ---
    const searchProcess = spawn(YTDLP_PATH, [
        `scsearch1:${q}`, 
        '--print', '%(title)s|%(webpage_url)s',
        '--no-playlist',
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    ]);

    let outputData = '';

    searchProcess.stdout.on('data', (data) => {
        outputData += data.toString();
    });

    searchProcess.on('close', (code) => {
        if (code !== 0 || !outputData.trim()) {
            return res.json({
                success: true,
                title: 'Not Found', 
                artist: 'System',
                url: ''
            });
        }

        const parts = outputData.trim().split('|');
        const safeTitle = cleanTitle(parts[0]);
        const realUrl = parts[1];
        
        // Tạo link stream
        const streamUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(realUrl)}`;

        console.log(`✅ Found SC: ${safeTitle}`);
        console.log(`👉 CLICK TEST: ${streamUrl}`); // <--- Dòng bạn cần đây

        res.json({
            success: true,
            title: safeTitle,
            artist: 'SoundCloud',
            url: streamUrl
        });
    });
});

// ======================
// 2. STREAM
// ======================
app.get('/stream', (req, res) => {
    const inputUrl = req.query.url;
    if (!inputUrl) return res.status(400).send('No URL');

    console.log(`🎧 STREAMING...`); // Khi bạn click link test, dòng này sẽ hiện

    res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'icy-name': 'Smart Audio',
        'icy-br': '64'
    });

    const ytdlp = spawn(YTDLP_PATH, [
        inputUrl,
        '-f', 'bestaudio', 
        '-o', '-',
        '--no-playlist',
        '--no-warnings',
        '--force-ipv4',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    ]);

    const ff = ffmpeg(ytdlp.stdout)
        .inputOptions(['-re', '-thread_queue_size', '4096']) 
        .audioCodec('libmp3lame')
        .audioBitrate('64k')
        .audioChannels(1)
        .audioFrequency(44100)
        .format('mp3')
        .outputOptions(['-vn', '-write_xing 0', '-flush_packets 1', '-bufsize', '64k'])
        .on('error', (err) => {
            if (!err.message.includes('EPIPE') && !err.message.includes('ECONNRESET')) {
                console.error('FFmpeg Error:', err.message);
            }
        });

    ff.pipe(res);

    req.on('close', () => {
        // Khi bạn tắt tab trình duyệt test hoặc ESP32 ngắt, nó sẽ báo disconnected
        console.log('🔌 Disconnected');
        setTimeout(() => {
            ytdlp.kill('SIGKILL');
            ff.kill('SIGKILL');
        }, 1000);
    });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
