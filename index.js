const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const Parser = require('rss-parser');
const axios = require('axios'); // Bắt buộc phải có trong package.json
const parser = new Parser();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// --- CẤU HÌNH NGUỒN ---
// 1. Kênh TikTok @ballad.bmz (Dùng RSS của ProxiTok)
const RSS_TIKTOK_BALLAD = 'https://proxitok.pabloferreiro.es/@ballad.bmz/rss';

// 2. Podcast Giang Ơi (SoundCloud)
const RSS_GIANG_OI = 'https://feeds.soundcloud.com/users/soundcloud:users:253460064/sounds.rss';

// --- TRẠNG THÁI SERVER ---
let serverStatus = "Booting...";

// Update yt-dlp khi khởi động (để tính năng tìm kiếm SoundCloud luôn mượt)
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => { 
    serverStatus = "Online (Ready)"; 
    console.log("✅ yt-dlp updated.");
});

// ============================================================
// 1. TOOL: COBALT (Tải link TikTok/Youtube không bị chặn)
// ============================================================
async function getLinkViaCobalt(url) {
    try {
        // [QUAN TRỌNG] Chuyển link ProxiTok (RSS) thành link TikTok gốc
        // RSS trả về: https://proxitok.../status/7438...
        // TikTok cần: https://www.tiktok.com/@user/video/7438...
        let realUrl = url;
        if (url.includes('proxitok')) {
            const videoId = url.split('/status/')[1]?.split('?')[0];
            if (videoId) {
                // Tên user không quan trọng, quan trọng là ID video
                realUrl = `https://www.tiktok.com/@ballad.bmz/video/${videoId}`;
            }
        }

        console.log(`🌐 Cobalt Processing: ${realUrl}`);
        
        // Gọi API Cobalt (Instance Public ổn định)
        const response = await axios.post('https://api.cobalt.tools/api/json', {
            url: realUrl,
            aFormat: 'mp3',       // Chỉ lấy Audio
            isAudioOnly: true,
            filenamePattern: 'nerdy'
        }, { 
            headers: { 
                'Accept': 'application/json', 
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0' 
            },
            timeout: 15000 // Chờ tối đa 15s
        });

        if (response.data && response.data.url) {
            console.log(`✅ Cobalt Success`);
            return response.data.url;
        }
        return null;
    } catch (error) {
        console.error("❌ Cobalt Error:", error.message);
        return null;
    }
}

// ============================================================
// 2. TOOL: TÌM KIẾM SOUNDCLOUD (Phương án dự phòng)
// ============================================================
function searchSoundCloud(query) {
    return new Promise((resolve) => {
        // Lọc bớt từ khóa rác để tìm chính xác hơn
        let cleanQuery = query.toLowerCase().replace(/youtube|zing|mp3|phát nhạc|mở nhạc|bài hát|của|tiktok/g, "").trim();
        let finalQuery = cleanQuery.length > 1 ? cleanQuery : query;
        
        console.log(`🔍 Fallback Searching SC: "${finalQuery}"`);
        
        const args = [
            `scsearch1:${finalQuery}`, 
            '-f', 'bestaudio/best',     
            '--get-url', '--no-playlist', '--no-warnings', '--force-ipv4', '--no-check-certificate'
        ];

        const sc = spawn('/usr/local/bin/yt-dlp', args);
        let url = '';

        sc.stdout.on('data', d => url += d.toString());
        
        sc.on('close', code => {
            if (code === 0 && url.trim()) {
                const finalUrl = url.trim().split('\n')[0];
                console.log(`✅ SC Found: ${finalUrl.substring(0,30)}...`);
                resolve(finalUrl);
            } else {
                console.log("❌ SC Not Found.");
                resolve(null);
            }
        });
    });
}

// ============================================================
// 3. TOOL: RSS READER (Lấy ngẫu nhiên từ danh sách)
// ============================================================
async function getRandomFromRSS(rssUrl, type) {
    try {
        console.log(`🎙 Đọc RSS (${type})...`);
        const feed = await parser.parseURL(rssUrl);
        if (!feed.items || !feed.items.length) return null;

        // Chọn ngẫu nhiên 1 bài trong danh sách RSS (thường là 20 bài mới nhất)
        const randomItem = feed.items[Math.floor(Math.random() * feed.items.length)];
        console.log(`🎯 RSS Picked: ${randomItem.title}`);

        if (type === 'tiktok') {
            // Nếu là TikTok -> Phải qua bước Cobalt xử lý link
            return await getLinkViaCobalt(randomItem.link);
        } else {
            // Nếu là SoundCloud -> Lấy link trực tiếp
            return randomItem.enclosure ? randomItem.enclosure.url : null;
        }
    } catch (e) {
        console.error(`❌ RSS Error (${type}):`, e.message);
        return null;
    }
}

// ============================================================
// LOGIC ĐIỀU PHỐI (MAIN BRAIN)
// ============================================================
async function getAudioUrl(query) {
    const lowerQ = query.toLowerCase();

    // 1. LINK TRỰC TIẾP (Nếu người dùng paste link)
    if (lowerQ.includes('http')) {
        return await getLinkViaCobalt(query) || await searchSoundCloud(query);
    }

    // 2. PODCAST GIANG ƠI
    if (['podcast', 'giang ơi', 'bót cát', 'radio'].some(k => lowerQ.includes(k))) {
        const url = await getRandomFromRSS(RSS_GIANG_OI, 'sc');
        if (url) return url;
        return await searchSoundCloud("Giang Ơi Podcast"); // Dự phòng
    }

    // 3. TIKTOK BALLAD (@ballad.bmz)
    const tiktokKeywords = ['tiktok', 'tít tót', 'tíc tốc', 'tâm trạng', 'ballad', 'buồn', 'nhạc tiktok'];
    if (tiktokKeywords.some(k => lowerQ.includes(k))) {
        // Thử lấy TikTok thật
        const url = await getRandomFromRSS(RSS_TIKTOK_BALLAD, 'tiktok');
        
        if (url) {
            return url;
        } else {
            // NẾU TIKTOK LỖI -> TỰ ĐỘNG TÌM TRÊN SOUNDCLOUD
            // Để đảm bảo không bao giờ bị im lặng
            console.log("⚠️ TikTok RSS Lỗi -> Chuyển sang tìm trên SoundCloud...");
            return await searchSoundCloud("Nhạc TikTok Ballad Buồn Chill");
        }
    }

    // 4. MẶC ĐỊNH: TÌM NHẠC THƯỜNG
    return await searchSoundCloud(query);
}

// ============================================================
// ROUTES & SERVER
// ============================================================
app.get('/', (req, res) => res.send(`Xiaozhi Music Server - ${serverStatus}`));

// API Search (Trả về JSON)
app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Missing query' });
    const streamUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "Smart Audio", url: streamUrl });
});

// API Stream (Xử lý Audio cho ESP32)
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    console.log(`\n🚀 Request: "${q}"`);
    const audioUrl = await getAudioUrl(q);

    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    // STREAM VÀ TRANSCODE
    ffmpeg(audioUrl)
        .inputOptions([
            '-reconnect 1', '-reconnect_streamed 1', '-reconnect_delay_max 5',
            '-user_agent "Mozilla/5.0"'
        ])
        .audioFilters([
            'volume=2.0',         // Tăng âm lượng
            'alimiter=limit=0.9'  // Chống vỡ tiếng/rè
        ])
        .audioCodec('libmp3lame')
        .audioBitrate(64)       // 64kbps (Nhẹ)
        .audioChannels(1)       // Mono (Bắt buộc cho ESP32 để không crash)
        .audioFrequency(44100)  // 44.1kHz (Chuẩn)
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

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
