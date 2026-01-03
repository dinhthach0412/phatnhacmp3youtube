const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const Parser = require('rss-parser'); 
const parser = new Parser();

const app = express();
app.use(cors());

// --- CẤU HÌNH ---
// Đây là RSS của kênh "Giang Ơi Radio" chuẩn trên SoundCloud
// Nếu RSS này lỗi, code bên dưới sẽ tự fallback sang tìm kiếm từ khóa chuẩn
const RSS_GIANG_OI_RADIO = 'https://feeds.soundcloud.com/users/soundcloud:users:277689862/sounds.rss';

let serverStatus = "Booting...";

// Update yt-dlp khi khởi động
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => { serverStatus = "Online (Giang Oi Radio Fixed)"; });

// ============================================================
// 1. TOOL: TÌM KIẾM NHANH (Dùng yt-dlp tại chỗ)
// ============================================================
function getLinkFast(query) {
    return new Promise((resolve) => {
        // Lọc từ khóa rác
        let cleanQuery = query.toLowerCase().replace(/youtube|zing|mp3|phát nhạc|mở nhạc|bài hát|của/g, "").trim();
        let finalQuery = cleanQuery.length > 1 ? cleanQuery : query;
        
        console.log(`⚡ Tìm nhanh SC: "${finalQuery}"`);
        
        const args = [
            `scsearch1:${finalQuery}`, 
            '-f', 'bestaudio/best',    
            '--get-url', '--no-playlist', '--no-warnings', '--force-ipv4', '--no-check-certificate'
        ];

        const yt = spawn('/usr/local/bin/yt-dlp', args);
        let url = '';

        yt.stdout.on('data', d => url += d.toString());
        
        yt.on('close', code => {
            if (code === 0 && url.trim()) {
                const finalUrl = url.trim().split('\n')[0];
                console.log(`✅ Link tìm được: ${finalUrl}`);
                resolve(finalUrl);
            } else {
                console.log("❌ Không tìm thấy.");
                resolve(null);
            }
        });
    });
}

// ============================================================
// 2. TOOL: LẤY PODCAST TỪ RSS (Ưu tiên số 1)
// ============================================================
async function getPodcastGiangOi() {
    try {
        console.log("🎙 Đang đọc RSS Giang Ơi Radio...");
        const feed = await parser.parseURL(RSS_GIANG_OI_RADIO);
        if (!feed.items || !feed.items.length) return null;

        // Chọn ngẫu nhiên 1 tập để nghe
        const randomItem = feed.items[Math.floor(Math.random() * feed.items.length)];
        console.log(`🎯 Chọn tập: ${randomItem.title}`);
        
        return randomItem.enclosure ? randomItem.enclosure.url : null;
    } catch (e) {
        console.error("Lỗi RSS:", e.message);
        return null;
    }
}

// ============================================================
// 3. BỘ NÃO ĐIỀU PHỐI (Router thông minh)
// ============================================================
async function getAudioUrl(query) {
    const lowerQ = query.toLowerCase();

    // A. NẾU LÀ "GIANG ƠI" / "PODCAST" / "TÂM SỰ"
    if (['podcast', 'giang ơi', 'bót cát', 'tâm trạng', 'chữa lành'].some(k => lowerQ.includes(k))) {
        
        // Bước 1: Thử lấy từ RSS chính chủ (Ngon nhất)
        const url = await getPodcastGiangOi();
        if (url) return url;

        // Bước 2: Nếu RSS lỗi -> Tìm kiếm bằng từ khóa "Giang Ơi Radio" (CÓ CHỮ RADIO)
        // Tuyệt đối không tìm mỗi chữ "Giang Ơi" vì sẽ ra nhạc remix
        console.log("⚠️ RSS lỗi, chuyển sang tìm kiếm khóa 'Giang Ơi Radio'...");
        return await getLinkFast("Giang Ơi Radio Podcast"); 
    }

    // B. NẾU LÀ TIKTOK
    if (['tiktok', 'tít tót', 'nhạc trend'].some(k => lowerQ.includes(k))) {
        // Tìm nhạc chill tiktok trên SoundCloud cho nhẹ
        return await getLinkFast("Nhạc TikTok Ballad Hot Trend Chill"); 
    }

    // C. MẶC ĐỊNH: TÌM NHẠC THƯỜNG
    return await getLinkFast(query);
}

// ============================================================
// SERVER SETUP
// ============================================================
app.get('/', (req, res) => res.send(`ESP32 Music Server - ${serverStatus}`));

// API Search
app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "Smart Audio", url: myServerUrl });
});

// API Stream (FFmpeg xử lý âm thanh)
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    // Lấy link nguồn
    const audioUrl = await getAudioUrl(q);
    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    console.log("🚀 Streaming...");

    // FFmpeg: Volume x2 + MP3 64kbps Mono (Chuẩn ESP32)
    ffmpeg(audioUrl)
        .inputOptions([
            '-reconnect 1', '-reconnect_streamed 1', '-reconnect_delay_max 5',
            '-user_agent "Mozilla/5.0"'
        ])
        .audioFilters('volume=2.0') 
        .audioCodec('libmp3lame')
        .audioBitrate(64)       
        .audioChannels(1) // Mono cho nhẹ, loa của bạn cũng là loa đơn mà
        .audioFrequency(24000)
        .format('mp3')
        .outputOptions([
            '-vn', '-flush_packets 1', '-preset ultrafast', 
            '-movflags frag_keyframe+empty_moov'
        ])
        .on('error', (err) => {
            if (!err.message.includes('closed')) console.error('Err:', err.message);
        })
        .pipe(res, { end: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy port ${PORT}`));
