const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

const YTDLP_PATH = '/usr/local/bin/yt-dlp';
const PORT = process.env.PORT || 3000;

let serverStatus = 'Booting...';

// Update yt-dlp
spawn(YTDLP_PATH, ['-U']).on('close', () => {
    serverStatus = 'Online (ESP32 Audio Stable)';
    console.log('✅ yt-dlp updated');
});

app.get('/', (req, res) => {
    res.send(`Smart Audio Server – ${serverStatus}`);
});

app.get('/stream', (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send('No query');

    console.log(`🎧 STREAM: ${q}`);

    // ESP32-friendly headers
    res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'icy-name': 'Smart Audio',
        'icy-description': 'ESP32 Audio Stream',
        'icy-br': '64'
    });

    const source = q.startsWith('http') ? q : `scsearch1:${q}`;

    // yt-dlp STREAM MODE (QUAN TRỌNG)
    const ytdlp = spawn(YTDLP_PATH, [
        source,
        '-f', 'bestaudio',
        '-o', '-',
        '--no-playlist',
        '--no-warnings',
        '--force-ipv4',
        '--hls-use-mpegts',      // 🔥 stream HLS mượt
        '--no-part',             // 🔥 không chờ download đủ
        '--no-cache-dir'
    ]);

    ytdlp.stderr.on('data', d => {
        const msg = d.toString();
        if (!msg.includes('%')) {
            console.log('[yt-dlp]', msg.trim());
        }
    });

    const ff = ffmpeg(ytdlp.stdout)
        .inputOptions(['-re'])
        .audioCodec('libmp3lame')
        .audioBitrate('64k')      // CBR
        .audioChannels(1)
        .audioFrequency(44100)    // 🔥 ESP32 BẮT BUỘC
        .format('mp3')
        .outputOptions([
            '-vn',
            '-write_xing 0',       // 🔥 bỏ Xing header
            '-flush_packets 1'
        ])
        .on('start', () => console.log('🚀 FFmpeg started'))
        .on('error', err => {
            if (!err.message.includes('EPIPE')) {
                console.error('❌ FFmpeg:', err.message);
            }
            res.end();
        })
        .on('end', () => {
            console.log('✅ Stream end');
            res.end();
        });

    ff.pipe(res);

    req.on('close', () => {
        console.log('🔌 Client disconnected');
        ytdlp.kill('SIGKILL');
        ff.kill('SIGKILL');
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
