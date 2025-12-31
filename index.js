const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');

const app = express();
app.use(cors());

let serverStatus = 'Booting...';

// ===============================
// 0. UPDATE yt-dlp (ngầm)
// ===============================
spawn('yt-dlp', ['-U']).on('close', () => {
    serverStatus = 'Online (Fast Pipe Mode)';
});

// ===============================
// 1. TÌM LINK SOUNDCLOUD (NHANH)
// ===============================
function getAudioUrl(query) {
    return new Promise((resolve) => {
        const clean = query
            .toLowerCase()
            .replace(/youtube|zing|mp3|phát nhạc|mở nhạc|bài hát|của/g, '')
            .trim();

        const args = [
            `scsearch1:${clean}`,
            '-f', 'http_mp3_128/bestaudio',
            '--get-url',
            '--no-playlist',
            '--no-warnings',
            '--force-ipv4'
        ];

        const yt = spawn('yt-dlp', args);
        let out = '';

        yt.stdout.on('data', d => out += d.toString());
        yt.on('close', code => {
            if (code === 0 && out.trim()) {
                resolve(out.trim().split('\n')[0]);
            } else {
                resolve(null);
            }
        });
    });
}

// ===============================
// 2. WEB STATUS (UPTIMEROBOT)
// ===============================
app.get('/', (req, res) => {
    res.send(`ESP32 Music Server | ${serverStatus}`);
});

// ===============================
// 3. SEARCH API
// ===============================
app.get('/search', (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });

    const url = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({
        success: true,
        title: q,
        artist: 'SoundCloud',
        url
    });
});

// ===============================
// 4. STREAM – TỐI ƯU ESP32
// ===============================
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send('No query');

    const audioUrl = await getAudioUrl(q);
    if (!audioUrl) return res.status(404).send('Not found');

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        // ⚡ Tải audio bằng axios (NHANH HƠN FFmpeg tự tải)
        const audioStream = await axios({
            url: audioUrl,
            method: 'GET',
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        // ⚡ FFmpeg chỉ convert – không tải
        ffmpeg(audioStream.data)
            .audioCodec('libmp3lame')
            .audioBitrate(64)          // nhẹ cho ESP32
            .audioChannels(2)
            .audioFrequency(44100)     // GIỮ NGUYÊN – không ép lại
            .format('mp3')
            .outputOptions([
                '-vn',
                '-map_metadata', '-1',
                '-preset', 'ultrafast',
                '-flush_packets', '1',
                '-bufsize', '32k'
            ])
            .on('error', err => {
                if (!err.message.includes('Output')) {
                    console.error('FFmpeg:', err.message);
                }
            })
            .pipe(res, { end: true });

    } catch (e) {
        console.error('Stream error:', e.message);
        if (!res.headersSent) res.status(502).send('Stream error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
