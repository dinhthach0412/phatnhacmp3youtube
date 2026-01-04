/**
 * Smart Audio Stream Server
 * Stable for Render + ESP32
 * SoundCloud / Spoken Content Focus
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
const updater = spawn(YTDLP_PATH, ['-U']);
updater.on('close', () => {
    serverStatus = 'Online (Stable Stream Mode)';
    console.log('✅ yt-dlp updated');
});

// ======================
// ROOT
// ======================
app.get('/', (req, res) => {
    res.send(`Smart Audio Server – ${serverStatus}`);
});

// ======================
// SEARCH (FAKE META)
// ======================
app.get('/search', (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });

    const streamUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;

    res.json({
        success: true,
        title: q,
        artist: 'Smart Audio',
        url: streamUrl
    });
});

// ======================
// STREAM (CORE)
// ======================
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send('No query');

    console.log(`🎧 STREAM: ${q}`);

    // Headers for ESP32 / IoT
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    // yt-dlp source
    let source = q;
    if (!q.startsWith('http')) {
        source = `scsearch1:${q}`;
    }

    try {
        // Spawn yt-dlp
        const ytdlp = spawn(YTDLP_PATH, [
            source,
            '-f', 'bestaudio',
            '-o', '-',
            '--no-playlist',
            '--no-warnings',
            '--force-ipv4'
        ]);

        ytdlp.stderr.on('data', d => {
            const msg = d.toString();
            if (!msg.includes('WARNING')) {
                console.log('[yt-dlp]', msg.trim());
            }
        });

        // FFmpeg pipe
        const ff = ffmpeg(ytdlp.stdout)
            .inputOptions(['-re'])
            .audioCodec('libmp3lame')
            .audioBitrate(64)
            .audioChannels(1)
            .audioFrequency(22050)
            .format('mp3')
            .outputOptions([
                '-vn',
                '-flush_packets 1'
            ])
            .on('start', () => {
                console.log('🚀 FFmpeg started');
            })
            .on('error', err => {
                if (!err.message.includes('EPIPE') && !err.message.includes('closed')) {
                    console.error('❌ FFmpeg error:', err.message);
                }
                res.end();
            })
            .on('end', () => {
                console.log('✅ Stream ended');
                res.end();
            });

        ff.pipe(res, { end: true });

        // Kill process when client disconnects
        req.on('close', () => {
            console.log('🔌 Client disconnected');
            ytdlp.kill('SIGKILL');
            ff.kill('SIGKILL');
        });

    } catch (e) {
        console.error('❌ Stream fatal error:', e.message);
        res.status(500).end();
    }
});

// ======================
// START SERVER
// ======================
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
