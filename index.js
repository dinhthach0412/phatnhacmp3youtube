const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const Parser = require('rss-parser'); // Thư viện đọc RSS
const parser = new Parser();

const app = express();
app.use(cors());

// --- CẤU HÌNH ---
// Link RSS của Giang Ơi (Lấy từ SoundCloud)
const RSS_GIANG_OI = 'https://feeds.soundcloud.com/users/soundcloud:users:253460064/sounds.rss';

// --- TRẠNG THÁI SERVER ---
let serverStatus = "Booting...";

// Update yt-dlp (Tự động cập nhật công cụ tải khi khởi động)
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => { serverStatus = "Online (Stable Core)"; });

// --- HÀM 1: LẤY PODCAST NGẪU NHIÊN (Logic mới) ---
async function getRandomPodcastUrl() {
    try {
        console.log("🎙 Server: Phát hiện yêu cầu Podcast -> Đang lấy Giang Ơi Radio...");
        const feed = await parser.parseURL(RSS_GIANG_OI);
        
        if (!feed.items || feed.items.length === 0) return null;

        // Chọn ngẫu nhiên 1 tập trong danh sách
        const randomItem = feed.items[Math.floor(Math.random() * feed.items.length)];
        
        console.log(`✅ Server: Đã chọn tập: "${randomItem.title}"`);
        
        // Lấy link file mp3 trực tiếp
        return randomItem.enclosure ? randomItem.enclosure.url : randomItem.link;
    } catch (e) {
        console.error("❌ Lỗi lấy RSS:", e.message);
        return null;
    }
}

// --- HÀM 2: TÌM KIẾM THÔNG MINH (Smart Search) ---
async function getAudioUrl(query) {
    // 1. CHẶN TỪ KHÓA PODCAST TRƯỚC
    const lowerQ = query.toLowerCase();
    const podcastKeywords = ['podcast', 'giang ơi', 'tâm sự', 'radio', 'chữa lành', 'tình yêu', 'buồn quá'];
    
    // Nếu câu nói có chứa từ khóa trên -> Gọi hàm lấy Podcast ngay
    if (podcastKeywords.some(keyword => lowerQ.includes(keyword))) {
        const podcastUrl = await getRandomPodcastUrl();
        if (podcastUrl) return podcastUrl;
        // Nếu lỗi RSS thì mới chạy xuống tìm kiếm thường
    }

    // 2. NẾU KHÔNG PHẢI PODCAST -> TÌM NHẠC THƯỜNG (Logic cũ)
    return new Promise((resolve, reject) => {
        // Lọc từ khóa rác
        let cleanQuery = lowerQ.replace(/youtube|zing|mp3|phát nhạc|mở nhạc|bài hát|của/g, "").trim();
        let finalQuery = cleanQuery.length > 1 ? cleanQuery : query;
        
        console.log(`🔍 Server: Tìm nhạc thường: "${finalQuery}"`);
        
        const args = [
            `scsearch1:${finalQuery}`, // Tìm 1 bài
            '-f', 'bestaudio/best',    
            '--get-url', '--no-playlist', '--no-warnings', '--force-ipv4', '--no-check-certificate'
        ];

        const yt = spawn('/usr/local/bin/yt-dlp', args);
        let url = '';

        yt.stdout.on('data', d => url += d.toString());
        
        yt.on('close', code => {
            if (code === 0 && url.trim()) {
                const finalUrl = url.trim().split('\n')[0];
                console.log(`✅ Link nhạc: ${finalUrl}`);
                resolve(finalUrl);
            } else {
                console.log("❌ Không tìm thấy bài nào.");
                resolve(null);
            }
        });
    });
}

app.get('/', (req, res) => res.send(`Server Music ESP32 - ${serverStatus}`));

app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    
    // Server trả về link stream của chính nó
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    
    // Trả JSON để ESP32 biết đường gọi
    res.json({ success: true, title: q, artist: "Smart Audio", url: myServerUrl });
});

// --- API STREAM (FFMPEG MONO - Fix lỗi tắt nguồn) ---
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    // Gọi hàm thông minh: Tự quyết định là Nhạc hay Podcast
    const audioUrl = await getAudioUrl(q);
    
    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    console.log("🚀 Streaming về ESP32...");

    ffmpeg(audioUrl)
        .inputOptions([
            '-reconnect 1', 
            '-reconnect_streamed 1', 
            '-reconnect_delay_max 5',
            '-probesize 128000',
            '-user_agent "Mozilla/5.0"'
        ])
        
        // --- CHỈNH VOLUME & KÊNH ---
        .audioFilters([
            'volume=2.0',         // Tăng âm lượng
            'alimiter=limit=0.95' // Chống vỡ tiếng
        ]) 
        
        .audioCodec('libmp3lame')
        .audioBitrate(64)
        
        // *** QUAN TRỌNG: CHUYỂN VỀ MONO (1 KÊNH) ***
        // Code cũ của bạn là .audioChannels(2) -> Gây crash ESP32
        // Code mới là .audioChannels(1) -> Nhẹ, mượt, không lỗi
        .audioChannels(1) 
        
        .audioFrequency(44100)
        .format('mp3')
        
        .outputOptions([
            '-vn', '-map_metadata', '-1',
            '-id3v2_version', '0', '-write_id3v1', '0', '-write_xing', '0',
            '-flush_packets', '1', 
            '-bufsize', '64k',     
            '-minrate', '64k', '-maxrate', '64k', 
            '-preset', 'ultrafast',
            '-movflags', 'frag_keyframe+empty_moov'
        ])
        .on('error', (err) => {
            if (!err.message.includes('Output stream closed')) console.error('Err:', err.message);
        })
        .pipe(res, { end: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy port ${PORT}`));
