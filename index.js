/**
 * Smart Audio Stream Server
 * Stable for Render + ESP32
 * FIXED ALL STREAM / SEARCH ISSUES + ADDED GIANG OI RADIO RSS
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const Parser = require('rss-parser'); // Thư viện đọc RSS

const app = express();
const parser = new Parser();
app.use(cors());

// ======================
// CONFIG
// ======================
const YTDLP_PATH = '/usr/local/bin/yt-dlp';
const PORT = process.env.PORT || 3000;
const GIANGOI_RSS_URL = 'https://anchor.fm/s/12c31424/podcast/rss'; // RSS Giang Ơi Radio

let serverStatus = 'Booting...';

// ======================
// UPDATE yt-dlp ON START
// ======================
spawn(YTDLP_PATH, ['-U']).on('close', () => {
    serverStatus = 'Online (ESP32 Stable Mode)';
    console.log('✅ yt-dlp updated');
});

// ======================
// ROOT
// ======================
app.get('/', (req, res) => {
    res.send(`Smart Audio Server – ${serverStatus}`);
});

// ======================
// SEARCH (ESP32 CONTRACT) - UPDATED FOR RSS
// ======================
app.get('/search', async (req, res) => {
    try {
        const q = req.query.q;
        if (!q) {
            return res.status(400).json({ error: 'No query' });
        }

        let streamTarget = q;
        let title = q;
        let artist = 'Smart Audio';

        // --- LOGIC XỬ LÝ RIÊNG CHO GIANG ƠI RADIO ---
        if (q.toLowerCase().includes('giang oi') || q.toLowerCase().includes('giangoi')) {
            console.log('📰 Fetching Giang Oi RSS...');
            try {
                const feed = await parser.parseURL(GIANGOI_RSS_URL);
                const latestItem = feed.items[0]; // Lấy tập mới nhất
                
                if (latestItem && latestItem.enclosure && latestItem.enclosure.url) {
                    streamTarget = latestItem.enclosure.url; // Link file mp3 gốc
                    title = latestItem.title;
                    artist = 'Giang Ơi Radio';
                    console.log(`✅ Found RSS Item: ${title}`);
                }
            } catch (rssErr) {
                console.error('❌ RSS Error:', rssErr.message);
                // Nếu lỗi RSS thì fallback về tìm kiếm youtube bình thường
            }
        }
        // ---------------------------------------------

        // Tạo link stream trỏ ngược về server này để transcode
        const streamUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(streamTarget)}`;

        res.json({
            success: true,
            title: title,
            artist: artist,
            url: streamUrl
        });

    } catch (err) {
        console.error('Search Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// ======================
// STREAM (CORE – ESP32 SAFE)
// ======================
app.get('/stream', (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send('No query');

    console.log(`🎧 STREAM REQUEST: ${q}`);

    // ESP32 / IoT friendly headers
    res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'icy-name': 'Smart Audio',
        'icy-description': 'ESP32 Audio Stream',
        'icy-br': '64'
    });

    // Nếu link là http/https (như link RSS) thì dùng trực tiếp, còn không thì search SoundCloud
    const source = q.startsWith('http') ? q : `scsearch1:${q}`;

    // ======================
    // yt-dlp (STREAM MODE)
    // ======================
    const ytdlp = spawn(YTDLP_PATH, [
        source,
        '-f', 'bestaudio',
        '-o', '-',
        '--no-playlist',
        '--no-warnings',
        '--force-ipv4',
        '--hls-use-mpegts',
        '--no-part',
        '--no-cache-dir'
    ]);

    ytdlp.stderr.on('data', d => {
        const msg = d.toString();
        // log nhưng không spam % download
        if (!msg.includes('%')) {
            console.log('[yt-dlp]', msg.trim());
        }
    });

    // ======================
    // FFmpeg (FORMAT CHUẨN ESP32)
    // ======================
    const ff = ffmpeg(ytdlp.stdout)
        .inputOptions(['-re'])
        .audioCodec('libmp3lame')
        .audioBitrate('64k')       // CBR - Quan trọng cho ESP32 buffer
        .audioChannels(1)          // Mono - Tiết kiệm băng thông
        .audioFrequency(44100)     // Chuẩn ESP32 I2S
        .format('mp3')
        .outputOptions([
            '-vn',
            '-write_xing 0',        // Bỏ Xing header (fix lỗi play mp3 trên một số lib)
            '-flush_packets 1'
        ])
        .on('start', () => {
            console.log('🚀 FFmpeg processing started');
        })
        .on('error', err => {
            // KHÔNG res.end() – để ESP32 đóng socket tự nhiên
            if (!err.message.includes('EPIPE') && !err.message.includes('ECONNRESET')) {
                console.error('❌ FFmpeg error:', err.message);
            }
        })
        .on('end', () => {
            console.log('✅ Stream finished');
        });

    ff.pipe(res);

    // ======================
    // CLIENT DISCONNECT HANDLER
    // ======================
    req.on('close', () => {
        console.log('🔌 Client disconnected');
        // delay kill để tránh mất packet cuối
        setTimeout(() => {
            ytdlp.kill('SIGKILL');
            ff.kill('SIGKILL');
        }, 300);
    });
});

// ======================
// START SERVER
// ======================
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
