/**
 * Smart Audio Server - TURBO MODE
 * Removed '-re' to fill ESP32 buffer instantly
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
    serverStatus = 'Online (Turbo Mode)';
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
// 1. SEARCH
// ======================
// ... (Các phần khai báo giữ nguyên)

app.get('/search', async (req, res) => {
    const q = req.query.q || '';
    if (!q) return res.status(400).json({ error: 'No query' });

    console.log(`🔍 Searching: ${q}`);
    
    // 1. XỬ LÝ LỆNH PODCAST ĐẶC BIỆT (CMD:PODCAST_GIANGOI)
    // Giúp server nhận diện nhanh, không cần spawn yt-dlp tốn thời gian
    let keyword = q.toLowerCase();
    
    // Nếu là lệnh CMD từ Robot gửi lên
    if (keyword.includes('cmd:podcast') || keyword.includes('giang oi') || keyword.includes('giangoi')) {
        console.log("⚡ Mode: PODCAST DETECTED");
        try {
            // Tải RSS Giang Ơi
            const feed = await parser.parseURL(GIANGOI_RSS_URL);
            
            // Lấy bài mới nhất
            const latestItem = feed.items[0]; 
            if (latestItem) {
                const safeTitle = cleanTitle(latestItem.title);
                
                // Tạo link stream (Redirect về Server mình để giữ kết nối Keep-Alive)
                const streamUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(latestItem.enclosure.url)}`;
                
                console.log(`✅ Podcast Found: ${safeTitle}`);
                
                return res.json({
                    success: true,
                    title: safeTitle,
                    artist: 'Giang Oi Radio',
                    url: streamUrl
                });
            }
        } catch (e) {
            console.error('RSS Error:', e.message);
            // Nếu lỗi RSS thì fallback xuống tìm YouTube bên dưới
        }
    }

    // ... (Phần tìm kiếm YouTube / SoundCloud bên dưới giữ nguyên) ...
    // --- CASE 2: SOUNDCLOUD ---
    const searchProcess = spawn(YTDLP_PATH, [
        `scsearch1:${q}`, 
        '--print', '%(title)s|%(webpage_url)s',
        '--no-playlist',
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    ]);

    let outputData = '';
    searchProcess.stdout.on('data', d => outputData += d.toString());

    searchProcess.on('close', (code) => {
        if (code !== 0 || !outputData.trim()) {
            return res.json({ success: true, title: 'Not Found', artist: 'System', url: '' });
        }
        const parts = outputData.trim().split('|');
        const safeTitle = cleanTitle(parts[0]);
        const streamUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(parts[1])}`;
        
        console.log(`✅ Found SC: ${safeTitle}`);
        console.log(`👉 CLICK TEST: ${streamUrl}`);

        res.json({
            success: true,
            title: safeTitle,
            artist: 'SoundCloud',
            url: streamUrl
        });
    });
});

// ======================
// 2. STREAM (TURBO - NO LAG)
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
        .inputOptions([
            // ĐÃ BỎ '-re' Ở ĐÂY ĐỂ TỐC ĐỘ TỐI ĐA
            '-thread_queue_size', '4096' 
        ]) 
        .audioCodec('libmp3lame')
        .audioBitrate('64k')
        .audioChannels(1)
        .audioFrequency(44100)
        .format('mp3')
        .outputOptions([
            '-vn',
            '-write_xing 0', 
            '-flush_packets 1',
            '-bufsize', '64k'
        ])
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
