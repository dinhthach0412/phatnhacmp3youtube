/**
 * Smart Audio Stream Server
 * Stable for Render + ESP32
 * FIXED ALL STREAM / SEARCH ISSUES
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

// ======================
// CONFIG
// ======================
const YTDLP_PATH = '/usr/local/bin/yt-dlp';
const PORT = process.env.PORT || 3000;

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
// SEARCH (ESP32 CONTRACT)
// ======================
app.get('/search', (req, res) => {
    const q = req.query.q;
    if (!q) {
        return res.status(400).json({ error: 'No query' });
    }

    const streamUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;

    res.json({
        success: true,
        title: q,
        artist: 'Smart Audio',
        url: streamUrl
    });
});

// ======================
// STREAM (CORE – ESP32 SAFE)
// ======================
app.get('/stream', (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send('No query');

    console.log(`🎧 STREAM: ${q}`);

    // ESP32 / IoT friendly headers
    res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'icy-name': 'Smart Audio',
        'icy-description': 'ESP32 Audio Stream',
        'icy-br': '64'
    });

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
        .audioBitrate('64k')       // CBR
        .audioChannels(1)          // mono
        .audioFrequency(44100)     // ESP32 STABLE
        .format('mp3')
        .outputOptions([
            '-vn',
            '-write_xing 0',        // bỏ Xing header
            '-flush_packets 1'
        ])
        .on('start', () => {
            console.log('🚀 FFmpeg started');
        })
        .on('error', err => {
            // KHÔNG res.end() – để ESP32 đóng socket tự nhiên
            if (!err.message.includes('EPIPE')) {
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
