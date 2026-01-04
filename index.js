/**
 * Smart Audio Server - FINAL FIXED RSS
 * Source: Official SoundCloud RSS (User provided)
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const Parser = require('rss-parser'); // Cần: npm install rss-parser

const app = express();
const parser = new Parser();
app.use(cors());

// ======================
// CONFIG
// ======================
const YTDLP_PATH = '/usr/local/bin/yt-dlp';
const PORT = process.env.PORT || 3000;

// Link RSS chuẩn bạn mới tìm được
const GIANGOI_RSS_URL = 'https://feeds.soundcloud.com/users/soundcloud:users:253460064/sounds.rss';

let serverStatus = 'Booting...';

// Update yt-dlp khi khởi động
spawn(YTDLP_PATH, ['-U']).on('close', () => {
    serverStatus = 'Online (Ready)';
    console.log('✅ yt-dlp updated');
});

app.get('/', (req, res) => res.send(`Smart Audio Server – ${serverStatus}`));

// ======================
// 1. SEARCH: PHÂN LUỒNG RSS vs YOUTUBE
// ======================
app.get('/search', async (req, res) => {
    const q = req.query.q || '';
    if (!q) return res.status(400).json({ error: 'No query' });

    console.log(`🔍 Searching: ${q}`);
    const keyword = q.toLowerCase();

    // --- MODE 1: GIANG OI PODCAST (DÙNG RSS) ---
    if (keyword.includes('giang oi') || keyword.includes('giangoi') || keyword.includes('podcast')) {
        console.log('🎙️ Mode: Giang Oi Radio (via RSS)');
        try {
            const feed = await parser.parseURL(GIANGOI_RSS_URL);
            const latestItem = feed.items[0]; // Lấy tập mới nhất
            
            if (latestItem && latestItem.enclosure && latestItem.enclosure.url) {
                console.log(`✅ Found RSS Item: ${latestItem.title}`);
                
                return res.json({
                    success: true,
                    title: latestItem.title,
                    artist: 'Giang Ơi Radio',
                    // Link này sẽ được gửi lại vào /stream để server transcode
                    url: `https://${req.get('host')}/stream?url=${encodeURIComponent(latestItem.enclosure.url)}`
                });
            }
        } catch (rssErr) {
            console.error('❌ RSS Error:', rssErr.message);
            // Nếu lỗi thì code sẽ chạy tiếp xuống phần tìm kiếm Youtube bên dưới (fallback)
        }
    }

    // --- MODE 2: NHẠC THƯỜNG (DÙNG YOUTUBE SEARCH) ---
    console.log('🎵 Mode: Music Search (Youtube)');
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
            return res.json({
                success: true, // Trả về true nhưng title báo lỗi để ESP32 không bị crash
                title: 'Not Found', 
                artist: 'System',
                url: ''
            });
        }

        const [realTitle, realUrl] = outputData.trim().split('|');
        console.log(`✅ Found YT: ${realTitle}`);

        res.json({
            success: true,
            title: realTitle,
            artist: 'Youtube Music',
            url: `https://${req.get('host')}/stream?url=${encodeURIComponent(realUrl)}`
        });
    });
});

// ======================
// 2. STREAM: XỬ LÝ MỌI LOẠI LINK (RSS / YOUTUBE)
// ======================
app.get('/stream', (req, res) => {
    const inputUrl = req.query.url; // Nhận link thật từ /search gửi qua
    
    if (!inputUrl) return res.status(400).send('No URL');

    console.log(`🎧 STREAMING...`);

    res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'icy-name': 'Smart Audio',
        'icy-br': '64'
    });

    // 1. Download nguồn (yt-dlp xử lý tốt cả link Youtube lẫn link file mp3 từ RSS)
    const ytdlp = spawn(YTDLP_PATH, [
        inputUrl,
        '-f', 'bestaudio',
        '-o', '-',
        '--no-playlist',
        '--no-warnings',
        '--force-ipv4'
    ]);

    // 2. Transcode (Bắt buộc để ESP32 chạy mượt)
    const ff = ffmpeg(ytdlp.stdout)
        .inputOptions(['-re']) 
        .audioCodec('libmp3lame')
        .audioBitrate('64k')    // Fix bitrate
        .audioChannels(1)       // Fix mono
        .audioFrequency(44100)  // Fix Hz
        .format('mp3')
        .outputOptions(['-vn', '-write_xing 0', '-flush_packets 1'])
        .on('error', (err) => {
            // Bỏ qua lỗi ngắt kết nối
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
