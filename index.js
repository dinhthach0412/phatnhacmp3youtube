const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const Parser = require('rss-parser'); 
const parser = new Parser();

const app = express();
app.use(cors());

// --- CẤU HÌNH ---
// RSS CHUẨN CỦA GIANG ƠI RADIO (ID: 253460064)
const RSS_GIANG_OI_RADIO = 'https://feeds.soundcloud.com/users/soundcloud:users:253460064/sounds.rss';

let serverStatus = "Booting...";

// Update yt-dlp khi khởi động (Quan trọng để search SoundCloud luôn mượt)
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => { 
    serverStatus = "Online (Lite Mode)"; 
    console.log("✅ yt-dlp updated.");
});

// ============================================================
// 1. TOOL: TÌM KIẾM NHANH (Dùng yt-dlp search SoundCloud)
// ============================================================
// ... (Đoạn trên giữ nguyên)

function getLinkFast(query) {
    return new Promise((resolve) => {
        let cleanQuery = query.toLowerCase().replace(/youtube|zing|mp3|phát nhạc|mở nhạc|bài hát|của|tiktok/g, "").trim();
        let finalQuery = cleanQuery.length > 1 ? cleanQuery : query;
        
        console.log(`⚡ Tìm nhanh SC: "${finalQuery}"`);
        
        const args = [
            `scsearch1:${finalQuery}`, 
            // [FIX QUAN TRỌNG] SỬA DÒNG NÀY
            // Cũ: '-f', 'bestaudio/best',  <-- Cái này nó hay lôi đầu link m3u8 lỗi về
            // Mới: Ép lấy protocol http (link trực tiếp) để FFmpeg dễ nuốt
            '-f', 'bestaudio[protocol^=http]',    
            '--get-url', '--no-playlist', '--no-warnings', '--force-ipv4', '--no-check-certificate'
        ];

        const yt = spawn('/usr/local/bin/yt-dlp', args);
        // ... (Đoạn dưới giữ nguyên)
        let url = '';

        yt.stdout.on('data', d => url += d.toString());
        
        yt.on('close', code => {
            if (code === 0 && url.trim()) {
                const finalUrl = url.trim().split('\n')[0];
                console.log(`✅ Link tìm được: ${finalUrl.substring(0, 30)}...`);
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

        // Chọn ngẫu nhiên 1 tập để nghe thay đổi không khí
        const randomItem = feed.items[Math.floor(Math.random() * feed.items.length)];
        console.log(`🎯 Chọn tập: ${randomItem.title}`);
        
        // SoundCloud RSS luôn có link file xịn trong enclosure
        return randomItem.enclosure ? randomItem.enclosure.url : null;
    } catch (e) {
        console.error("❌ Lỗi RSS:", e.message);
        return null;
    }
}

// ============================================================
// 3. BỘ NÃO ĐIỀU PHỐI (Router thông minh)
// ============================================================
async function getAudioUrl(query) {
    const lowerQ = query.toLowerCase();

    // A. NẾU LÀ "GIANG ƠI" / "PODCAST" / "TÂM SỰ"
    if (['podcast', 'giang ơi', 'bót cát', 'tâm trạng', 'chữa lành', 'radio'].some(k => lowerQ.includes(k))) {
        
        // Bước 1: Thử lấy từ RSS chính chủ (Ngon nhất)
        const url = await getPodcastGiangOi();
        if (url) return url;

        // Bước 2: Nếu RSS lỗi -> Tìm kiếm bằng từ khóa "Giang Ơi Radio"
        // Thêm chữ "Radio" để yt-dlp tìm đúng kênh talkshow, né nhạc remix
        console.log("⚠️ RSS lỗi -> Tìm kiếm khóa 'Giang Ơi Radio'...");
        return await getLinkFast("Giang Ơi Radio Podcast"); 
    }

    // B. NẾU LÀ TIKTOK (Giả lập)
    if (['tiktok', 'tít tót', 'nhạc trend'].some(k => lowerQ.includes(k))) {
        // Tìm nhạc chill tiktok trên SoundCloud (Vừa nhẹ vừa không bị chặn)
        return await getLinkFast("Nhạc TikTok Ballad Hot Trend Chill"); 
    }

    // C. MẶC ĐỊNH: TÌM NHẠC THƯỜNG
    return await getLinkFast(query);
}

// ============================================================
// SERVER SETUP
// ============================================================
app.get('/', (req, res) => res.send(`ESP32 Music Server - ${serverStatus}`));

// API Search (JSON)
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
        .audioFilters([
            'volume=2.0',        // Tăng âm lượng
            'alimiter=limit=0.9' // Chống vỡ tiếng (Thêm cái này cho an toàn)
        ]) 
        .audioCodec('libmp3lame')
        .audioBitrate(64)       
        .audioChannels(1)       // Mono (Bắt buộc)
        .audioFrequency(44100)  // 44.1kHz (Chuẩn quốc tế cho MP3, ESP32 thích cái này nhất)
        .format('mp3')
        .outputOptions([
            '-vn', '-flush_packets 1', '-preset ultrafast', 
            '-movflags frag_keyframe+empty_moov'
        ])
        .on('error', (err) => {
            if (!err.message.includes('closed')) console.error('FFmpeg Err:', err.message);
        })
        .pipe(res, { end: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy port ${PORT}`));
