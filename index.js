/**
 * 🎵 ULTRA SERVER V14 (FINAL PERFECT)
 * - Kết hợp sự ổn định của V13 + Tốc độ & Volume của bản cũ
 * - Có Volume 2.0 (Loa to)
 * - Có Preset Ultrafast (Xử lý cực nhanh, không delay)
 * - Dùng Spawn Core (Không bao giờ Crash SIGSEGV)
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static'); // Dùng bản static
const Parser = require('rss-parser');

const app = express();
const parser = new Parser();
app.use(cors());

const PORT = process.env.PORT || 10000;
const YTDLP_PATH = './yt-dlp'; 
const GIANGOI_RSS = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

app.get('/', (req, res) => res.send('🔥 Server V14 (Volume 2.0 + Ultrafast) Ready'));

// --- HÀM TÌM KIẾM ---
function searchSoundCloud(query) {
    return new Promise((resolve, reject) => {
        let cleanQuery = query.toLowerCase().replace(/youtube|zing|mp3|phát nhạc|mở nhạc|bài hát|của/g, "").trim();
        let finalQuery = cleanQuery.length > 1 ? cleanQuery : query;
        
        console.log(`🔎 yt-dlp: ${finalQuery}`);
        
        const args = [
            `scsearch1:${finalQuery}`, 
            '--get-url', '--no-playlist', '--no-warnings', 
            '--format', 'bestaudio/best', 
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        ];

        const yt = spawn(YTDLP_PATH, args);
        let url = '';
        
        yt.stdout.on('data', d => url += d.toString());
        
        yt.on('close', code => {
            const finalUrl = url.trim().split('\n')[0];
            if (code === 0 && finalUrl) {
                console.log(`✅ Link: ${finalUrl}`);
                resolve({ url: finalUrl, title: finalQuery });
            } else {
                console.error(`❌ Search Failed: ${code}`);
                resolve(null);
            }
        });
    });
}

// --- API SEARCH ---
app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    const host = req.get('host'); 
    const protocol = req.protocol === 'http' && host.includes('localhost') ? 'http' : 'https';
    
    const makeStreamUrl = (targetUrl) => {
        return `${protocol}://${host}/stream?url=${encodeURIComponent(targetUrl)}`;
    };

    console.log(`🔍 Search: ${q}`);

    // PODCAST
    if (q.includes('cmd:podcast') || q.includes('giang oi')) {
        try {
            const feed = await parser.parseURL(GIANGOI_RSS);
            const item = feed.items[0]; 
            if (item) {
                const audioUrl = item.enclosure ? item.enclosure.url : item.link;
                return res.json({ 
                    success: true, title: item.title, artist: 'Giang Oi Radio', 
                    url: makeStreamUrl(audioUrl), is_podcast: true 
                });
            }
        } catch (e) { console.error('RSS Error:', e.message); }

        const fallbackData = await searchSoundCloud("Giang Oi Radio Podcast");
        if (fallbackData) {
            return res.json({ 
                success: true, title: "Giang Oi Podcast (Auto)", artist: 'Giang Oi', 
                url: makeStreamUrl(fallbackData.url), is_podcast: true
            });
        }
        return res.json({ success: false, error: 'Podcast Not Found' });
    }

    // NHẠC THƯỜNG
    const searchData = await searchSoundCloud(q);
    if (!searchData) return res.json({ success: false, error: 'Not found' });

    res.json({ success: true, title: q, artist: "SoundCloud", url: makeStreamUrl(searchData.url) });
});

// --- API STREAM (BẢN FINAL: VOLUME 2.0 + ULTRAFAST) ---
app.get('/stream', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("No URL");

    console.log("🚀 Spawning FFmpeg (Ultrafast Mode)...");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    const ffmpegArgs = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-analyzeduration', '0',          // [HỒI SINH] Đọc lẹ, không chờ phân tích
        '-probesize', '128000',           // [HỒI SINH] Thăm dò ít thôi cho nhanh
        '-i', url,
        '-vn',
        '-filter:a', 'volume=2.0',        // [HỒI SINH] Tăng âm lượng 200% (Loa to)
        '-acodec', 'libmp3lame',
        '-ac', '2',
        '-ar', '44100',
        '-b:a', '128k',
        '-preset', 'ultrafast',           // [HỒI SINH] Xử lý siêu tốc để ESP32 không timeout
        '-f', 'mp3',
        'pipe:1'
    ];

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

    ffmpegProcess.stdout.pipe(res);

    ffmpegProcess.stderr.on('data', (data) => {
        // Uncomment để debug nếu cần
        // console.log(`FFmpeg: ${data}`);
    });

    ffmpegProcess.on('close', (code) => {
        if (code !== 0 && code !== 255) {
            console.log(`FFmpeg exited with code ${code}`);
        }
    });

    req.on('close', () => {
        console.log("🔌 Client disconnected, killing FFmpeg...");
        ffmpegProcess.kill('SIGKILL');
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server V14 running on port ${PORT}`);
});
