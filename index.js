/**
 * Smart Audio Server - SOUNDCLOUD EDITION
 * Source: SoundCloud (Search) + SoundCloud (RSS)
 * No YouTube Search involved.
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

// Link RSS chuẩn của Giang Ơi Radio
const GIANGOI_RSS_URL = 'https://feeds.soundcloud.com/users/soundcloud:users:253460064/sounds.rss';

let serverStatus = 'Booting...';

// Update yt-dlp khi khởi động (quan trọng để fix lỗi SoundCloud API thay đổi)
spawn(YTDLP_PATH, ['-U']).on('close', () => {
    serverStatus = 'Online (SoundCloud Mode)';
    console.log('✅ yt-dlp updated');
});

app.get('/', (req, res) => res.send(`Smart Audio Server – ${serverStatus}`));

// ======================
// 1. SEARCH: TẤT CẢ ĐỀU LÀ SOUNDCLOUD
// ======================
app.get('/search', async (req, res) => {
    const q = req.query.q || '';
    if (!q) return res.status(400).json({ error: 'No query' });

    console.log(`🔍 Searching: ${q}`);
    const keyword = q.toLowerCase();

    // --- CASE 1: GIANG OI PODCAST (Ưu tiên dùng RSS lấy tập mới nhất) ---
    if (keyword.includes('giang oi') || keyword.includes('giangoi') || keyword.includes('podcast')) {
        console.log('🎙️ Mode: Giang Oi (via RSS)');
        try {
            const feed = await parser.parseURL(GIANGOI_RSS_URL);
            const latestItem = feed.items[0]; 
            
            if (latestItem) {
                console.log(`✅ Found RSS: ${latestItem.title}`);
                return res.json({
                    success: true,
                    title: latestItem.title,
                    artist: 'Giang Ơi Radio',
                    url: `https://${req.get('host')}/stream?url=${encodeURIComponent(latestItem.enclosure.url)}`
                });
            }
        } catch (e) {
            console.error('RSS Fail, fallback to Search');
        }
    }

    // --- CASE 2: TÌM NHẠC BẤT KỲ (SOUNDCLOUD SEARCH) ---
    // Thay đổi quan trọng: scsearch1 (SoundCloud) thay vì ytsearch1 (Youtube)
    console.log('☁️ Mode: SoundCloud Search');
    
    const searchProcess = spawn(YTDLP_PATH, [
        `scsearch1:${q}`,  // <-- scsearch = SoundCloud Search
        '--print', '%(title)s|%(webpage_url)s',
        '--no-playlist',
        '--no-warnings'
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

        const [realTitle, realUrl] = outputData.trim().split('|');
        console.log(`✅ Found SC: ${realTitle}`);

        res.json({
            success: true,
            title: realTitle,
            artist: 'SoundCloud',
            url: `https://${req.get('host')}/stream?url=${encodeURIComponent(realUrl)}`
        });
    });
});

// ======================
// 2. STREAM: TRANSCODE CHO ESP32
// ======================
app.get('/stream', (req, res) => {
    const inputUrl = req.query.url;
    if (!inputUrl) return res.status(400).send('No URL');

    console.log(`🎧 STREAMING...`);

    res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'icy-name': 'Smart Audio',
        'icy-br': '64'
    });

    // yt-dlp tải link (Hỗ trợ cực tốt SoundCloud)
    const ytdlp = spawn(YTDLP_PATH, [
        inputUrl,
        '-f', 'bestaudio', // SoundCloud thường là mp3/aac
        '-o', '-',
        '--no-playlist',
        '--no-warnings',
        '--force-ipv4'
    ]);

    // Transcode về chuẩn ESP32 (MP3 64k Mono)
    const ff = ffmpeg(ytdlp.stdout)
        .inputOptions(['-re']) 
        .audioCodec('libmp3lame')
        .audioBitrate('64k')
        .audioChannels(1)
        .audioFrequency(44100)
        .format('mp3')
        .outputOptions(['-vn', '-write_xing 0', '-flush_packets 1'])
        .on('error', (err) => {
            if (!err.message.includes('EPIPE')) console.error('FFmpeg Error:', err.message);
        });

    ff.pipe(res);

    req.on('close', () => {
        console.log('🔌 Disconnected');
        setTimeout(() => {
            ytdlp.kill('SIGKILL');
            ff.kill('SIGKILL');
        }, 1000);
    });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
