const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const Parser = require('rss-parser'); // Phải có dòng này
const path = require('path');

const app = express();
const parser = new Parser(); // Khởi tạo Parser
app.use(cors());

const PORT = process.env.PORT || 10000;

// --- 1. KHAI BÁO CÁC BIẾN QUAN TRỌNG (ĐỪNG XÓA) ---
const YTDLP_PATH = './yt-dlp'; // Đảm bảo bạn đã có file yt-dlp và chmod +x

// Link RSS của Giang Ơi Radio (Lấy từ SoundCloud)
const GIANGOI_RSS_URL = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss'; 

// Hàm làm sạch tiêu đề (Để robot đọc cho dễ)
function cleanTitle(title) {
    if (!title) return "Unknown Track";
    return title.replace(/\(.*?\)|\[.*?\]/g, '').replace(/\.mp3$/i, '').trim();
}
// ----------------------------------------------------

app.get('/', (req, res) => {
    res.send('Music Server Online - Podcast Ready');
});

// ROUTE TÌM KIẾM VÀ TRẢ VỀ LINK
app.get('/search', async (req, res) => {
    const q = req.query.q || '';
    if (!q) return res.status(400).json({ error: 'No query provided' });

    console.log(`🔍 Searching: ${q}`);
    
    let keyword = q.toLowerCase();

    // --- CASE 1: XỬ LÝ PODCAST GIANG ƠI (Nhanh, không dùng yt-dlp) ---
    if (keyword.includes('cmd:podcast') || keyword.includes('giang oi') || keyword.includes('giangoi')) {
        console.log("⚡ Mode: PODCAST DETECTED - Đang lấy RSS...");
        
        try {
            // Lấy RSS
            const feed = await parser.parseURL(GIANGOI_RSS_URL);
            
            // Lấy bài mới nhất (item[0])
            // Muốn lấy bài ngẫu nhiên thì dùng: feed.items[Math.floor(Math.random() * feed.items.length)]
            const latestItem = feed.items[0]; 

            if (latestItem) {
                const safeTitle = cleanTitle(latestItem.title);
                
                // SoundCloud RSS thường trả về link enclosure direct
                const audioUrl = latestItem.enclosure ? latestItem.enclosure.url : latestItem.link;

                // Redirect về chính server này để giữ kết nối (Proxy) hoặc trả link gốc
                // Ở đây trả link gốc cho nhanh:
                console.log(`✅ Podcast Found: ${safeTitle}`);
                
                return res.json({
                    success: true,
                    title: safeTitle,
                    artist: 'Giang Oi Radio',
                    url: audioUrl,  // Link trực tiếp từ RSS
                    is_podcast: true
                });
            } else {
                console.log("❌ Không tìm thấy bài nào trong RSS");
            }
        } catch (e) {
            console.error('❌ Lỗi RSS:', e.message);
            // Nếu lỗi RSS thì kệ nó, để nó chạy xuống logic Youtube bên dưới
        }
    }

    // --- CASE 2: TÌM YOUTUBE / SOUNDCLOUD (Dùng yt-dlp) ---
    // (Logic cũ giữ nguyên)
    console.log("🐢 Fallback: Tìm bằng yt-dlp...");

    const searchProcess = spawn(YTDLP_PATH, [
        '--default-search', 'ytsearch',
        '--dump-json',
        '--no-playlist',
        '--format', 'bestaudio[ext=m4a]/best[ext=mp4]/best', 
        q // Từ khóa tìm kiếm
    ]);

    let output = '';
    
    searchProcess.stdout.on('data', (data) => {
        output += data.toString();
    });

    searchProcess.stderr.on('data', (data) => {
        // console.error(`yt-dlp stderr: ${data}`); // Bỏ comment nếu muốn debug
    });

    searchProcess.on('close', (code) => {
        if (code !== 0 || !output) {
            return res.status(500).json({ error: 'Search failed or no result' });
        }

        try {
            const data = JSON.parse(output);
            const title = cleanTitle(data.title);
            
            // Tạo link stream qua server của mình
            const streamUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(data.webpage_url)}`;
            
            console.log(`✅ YT Found: ${title}`);

            res.json({
                success: true,
                title: title,
                artist: data.uploader || 'Unknown',
                url: streamUrl 
            });
        } catch (e) {
            console.error('Parse error:', e);
            res.status(500).json({ error: 'Failed to parse yt-dlp output' });
        }
    });
});

// ROUTE STREAM NHẠC (PROXY)
app.get('/stream', (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('No URL provided');

    console.log(`▶️ Streaming: ${videoUrl}`);

    const ytDlp = spawn(YTDLP_PATH, [
        '-o', '-',
        '-f', 'bestaudio', 
        videoUrl
    ]);

    res.setHeader('Content-Type', 'audio/mpeg');
    
    ytDlp.stdout.pipe(res);

    ytDlp.stderr.on('data', (data) => {
        // console.error(`Stream stderr: ${data}`);
    });

    req.on('close', () => {
        console.log('⏹️ Client disconnected, killing stream.');
        ytDlp.kill();
    });
});

app.listen(PORT, () => {
    console.log(`🚀 News & Music Server running on port ${PORT}`);
});
