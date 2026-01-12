/**
 * 🎵 ULTRA SERVER V15 (CROSS-PLATFORM KING)
 * - Tự động nhận diện Windows/Linux để tải yt-dlp chuẩn
 * - Fix lỗi "spawn ENOENT" trên Windows
 * - Tích hợp FFmpeg Static an toàn
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const YTDlpWrap = require('yt-dlp-wrap').default;
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

// 1. Cấu hình FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// 2. Cấu hình yt-dlp (Tự động tải binary đúng hệ điều hành)
const ytDlpBinaryPath = path.join(__dirname, 'yt-dlp-binary'); // Tên file chung
const ytDlpWrap = new YTDlpWrap();

// Kiểm tra và tải yt-dlp nếu chưa có
(async () => {
    if (!fs.existsSync(ytDlpBinaryPath)) {
        console.log("⏳ Đang tải yt-dlp phù hợp cho máy tính của bạn...");
        await ytDlpWrap.downloadFromGithub(ytDlpBinaryPath);
        console.log("✅ Đã tải xong yt-dlp!");
        // Cấp quyền thực thi (quan trọng cho Linux/Mac)
        try { fs.chmodSync(ytDlpBinaryPath, '755'); } catch (e) {}
    } else {
        console.log("✅ Đã tìm thấy yt-dlp binary.");
    }
    ytDlpWrap.setBinaryPath(ytDlpBinaryPath);
})();

const app = express();
const parser = new Parser();
app.use(cors());

const PORT = process.env.PORT || 10000;
const GIANGOI_RSS = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

app.get('/', (req, res) => res.send('🔥 Server V15 (Windows/Linux Compatible) Ready'));

// --- HÀM TÌM KIẾM SOUNDCLOUD (Dùng yt-dlp-wrap) ---
function searchSoundCloud(query) {
    return new Promise(async (resolve, reject) => {
        let cleanQuery = query.toLowerCase().replace(/youtube|zing|mp3|phát nhạc|mở nhạc|bài hát|của/g, "").trim();
        let finalQuery = cleanQuery.length > 1 ? cleanQuery : query;
        
        console.log(`🔎 Tìm kiếm: ${finalQuery}`);

        try {
            // Dùng execPromise của thư viện wrapper -> An toàn hơn spawn thủ công
            let stdout = await ytDlpWrap.execPromise([
                `scsearch1:${finalQuery}`,
                '--get-url',
                '--no-playlist',
                '--no-warnings',
                '--format', 'bestaudio/best',
                // Buộc dùng IPv4 để tránh lỗi mạng trên một số router
                '--force-ipv4', 
                // User Agent giả lập
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            ]);

            const finalUrl = stdout.trim().split('\n')[0];
            if (finalUrl) {
                console.log(`✅ Link gốc: ${finalUrl}`);
                resolve({ url: finalUrl, title: finalQuery });
            } else {
                resolve(null);
            }
        } catch (error) {
            console.error(`❌ Lỗi tìm kiếm: ${error.message}`);
            resolve(null);
        }
    });
}

// --- API TÌM KIẾM ---
app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    const host = req.get('host');
    const protocol = req.protocol === 'http' && host.includes('localhost') ? 'http' : 'https';
    
    const makeStreamUrl = (targetUrl) => {
        return `${protocol}://${host}/stream?url=${encodeURIComponent(targetUrl)}`;
    };

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

// --- API STREAM (GIỮ NGUYÊN SPAWN FFMPEG VÌ NÓ TỐT NHẤT CHO STREAM) ---
app.get('/stream', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("No URL");

    console.log("🚀 Đang Transcode nhạc...");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    const ffmpegArgs = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-analyzeduration', '0',
        '-probesize', '128000',
        '-i', url,
        '-vn',
        '-filter:a', 'volume=2.0',
        '-acodec', 'libmp3lame',
        '-ac', '2',
        '-ar', '44100',
        '-b:a', '128k',
        '-preset', 'ultrafast',
        '-f', 'mp3',
        'pipe:1'
    ];

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

    ffmpegProcess.stdout.pipe(res);

    ffmpegProcess.stderr.on('data', (data) => {
        // console.log(`FFmpeg: ${data}`); // Bật lên nếu muốn debug
    });

    ffmpegProcess.on('close', (code) => {
        if (code !== 0 && code !== 255) {
            console.log(`FFmpeg kết thúc với mã: ${code}`);
        }
    });

    req.on('close', () => {
        console.log("🔌 ESP32 ngắt kết nối, dừng FFmpeg.");
        ffmpegProcess.kill('SIGKILL');
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server V15 đang chạy tại port ${PORT}`);
    console.log(`👉 Hãy dùng Ngrok để public port ${PORT} nhé!`);
});
