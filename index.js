/**
 * Smart Audio Stream Server - PRO VERSION
 * Fix: Real Title + Fast Loading + RSS Podcast
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
const GIANGOI_RSS_URL = 'https://feeds.soundcloud.com/users/soundcloud:users:253460064/sounds.rss
';

let serverStatus = 'Booting...';

// Update yt-dlp khi khởi động
spawn(YTDLP_PATH, ['-U']).on('close', () => {
    serverStatus = 'Online (Ready)';
    console.log('✅ yt-dlp updated');
});

app.get('/', (req, res) => res.send(`Smart Audio Server – ${serverStatus}`));

// ======================
// 1. SEARCH: LẤY LINK THẬT + TÊN THẬT (QUAN TRỌNG)
// ======================
app.get('/search', async (req, res) => {
    const q = req.query.q || '';
    if (!q) return res.status(400).json({ error: 'No query' });

    console.log(`🔍 Searching: ${q}`);
    const keyword = q.toLowerCase();

    // --- CASE 1: PODCAST / GIANG OI ---
    if (keyword.includes('giang oi') || keyword.includes('giangoi') || keyword.includes('podcast')) {
        try {
            const feed = await parser.parseURL(GIANGOI_RSS_URL);
            const item = feed.items[0];
            return res.json({
                success: true,
                title: item.title,          // Tên tập podcast thật
                artist: 'Giang Ơi Radio',
                // Link stream trỏ về server mình để transcode
                url: `https://${req.get('host')}/stream?url=${encodeURIComponent(item.enclosure.url)}` 
            });
        } catch (e) {
            console.error('RSS Fail, fallback to YT');
        }
    }

    // --- CASE 2: NHẠC THƯỜNG (YOUTUBE/SOUNDCLOUD) ---
    // Dùng yt-dlp để lấy tên thật và link thật TRƯỚC khi stream
    // Lệnh: yt-dlp "ytsearch1:keyword" --print "%(title)s|%(webpage_url)s"
    const searchProcess = spawn(YTDLP_PATH, [
        `ytsearch1:${q}`, 
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
            // Tìm không thấy
            return res.json({
                success: true,
                title: q, 
                artist: 'Unknown',
                url: `https://${req.get('host')}/stream?url=${encodeURIComponent(q)}` // Fallback kiểu cũ
            });
        }

        // Parse kết quả: "Tên Bài Hát | Link Youtube"
        const [realTitle, realUrl] = outputData.trim().split('|');

        console.log(`✅ Found: ${realTitle}`);

        res.json({
            success: true,
            title: realTitle,       // Tên bài hát chuẩn Youtube
            artist: 'Youtube Music',
            // Gửi link Youtube thật vào param 'url'
            url: `https://${req.get('host')}/stream?url=${encodeURIComponent(realUrl)}`
        });
    });
});

// ======================
// 2. STREAM: CHỈ TẢI LINK (KHÔNG TÌM KIẾM NỮA) -> NHANH
// ======================
app.get('/stream', (req, res) => {
    // Lưu ý: ESP32 sẽ gọi vào đây với param ?url=... (link thật)
    // Hoặc ?q=... (code cũ), ta xử lý cả 2
    const inputUrl = req.query.url || req.query.q; 
    
    if (!inputUrl) return res.status(400).send('No URL');

    console.log(`🎧 STREAMING: ${inputUrl}`);

    res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'icy-name': 'Smart Audio',
        'icy-br': '64'
    });

    // yt-dlp tải trực tiếp link (cực nhanh vì không phải search nữa)
    const ytdlp = spawn(YTDLP_PATH, [
        inputUrl,
        '-f', 'bestaudio',
        '-o', '-',
        '--no-playlist',
        '--no-warnings',
        '--force-ipv4'
    ]);

    // FFmpeg transcode sang MP3 64k Mono (Chuẩn ESP32)
    const ff = ffmpeg(ytdlp.stdout)
        .inputOptions(['-re']) // Đọc tốc độ thực (quan trọng cho stream)
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

    // Dọn dẹp khi ESP32 ngắt kết nối
    req.on('close', () => {
        console.log('🔌 Disconnected');
        setTimeout(() => {
            ytdlp.kill('SIGKILL');
            ff.kill('SIGKILL');
        }, 1000);
    });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
