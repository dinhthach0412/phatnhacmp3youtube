const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const Parser = require('rss-parser');
const axios = require('axios'); // Bắt buộc phải có thư viện này
const parser = new Parser();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// --- NGUỒN DỮ LIỆU ---
// 1. Podcast Giang Ơi (SoundCloud - Ổn định)
const RSS_GIANG_OI = 'https://feeds.soundcloud.com/users/soundcloud:users:253460064/sounds.rss';

// 2. Kênh TikTok @ballad.bmz (Thông qua ProxiTok RSS - Có thể chập chờn tùy server)
// Nếu link này chết, bạn có thể tìm "TikTok RSS Generator" để thay link khác
const RSS_TIKTOK_BALLAD = 'https://proxitok.pabloferreiro.es/@ballad.bmz/rss';

// --- TRẠNG THÁI SERVER ---
let serverStatus = "Booting...";
// Update yt-dlp 
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => { serverStatus = "Online (Ballad Mode Ready)"; });

// ============================================================
// 1. TOOL: COBALT (Cứu tinh tải link TikTok/Youtube)
// ============================================================
async function getLinkViaCobalt(url) {
    try {
        console.log(`🌐 Cobalt: Đang xử lý link -> ${url}`);
        // Sử dụng instance này hoặc tìm instance khác nếu quá tải (https://instances.cobalt.tools)
        const response = await axios.post('https://api.cobalt.tools/api/json', {
            url: url,
            aFormat: 'mp3',
            isAudioOnly: true,
            filenamePattern: 'nerdy'
        }, { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' } });

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
// 2. TOOL: LẤY LINK NGẪU NHIÊN TỪ RSS (Hỗ trợ cả SC & TikTok)
// ============================================================
async function getRandomFromRSS(rssUrl, sourceName) {
    try {
        console.log(`🎙 Đang đọc RSS: ${sourceName}...`);
        // Timeout 5s để tránh treo server nếu ProxiTok bị lag
        const feed = await parser.parseURL(rssUrl);
        
        if (!feed.items || !feed.items.length) return null;

        // Chọn ngẫu nhiên
        const randomItem = feed.items[Math.floor(Math.random() * feed.items.length)];
        console.log(`✅ Đã chọn bài: ${randomItem.title}`);

        // Xử lý kết quả trả về
        // Nếu là SoundCloud (Giang Ơi) -> Lấy enclosure
        if (sourceName === 'SoundCloud') {
            return randomItem.enclosure ? randomItem.enclosure.url : randomItem.link;
        }
        
        // Nếu là TikTok (@ballad.bmz) -> Lấy Link gốc -> Ném sang Cobalt
        if (sourceName === 'TikTok') {
            const tiktokLink = randomItem.link; // Link video tiktok
            // Gọi Cobalt để lấy MP3 từ link video này
            return await getLinkViaCobalt(tiktokLink);
        }

        return randomItem.link;
    } catch (e) {
        console.error(`❌ Lỗi RSS ${sourceName}:`, e.message);
        return null;
    }
}

// ============================================================
// 3. LOGIC ĐIỀU PHỐI (MAIN)
// ============================================================
async function getAudioUrl(query) {
    const lowerQ = query.toLowerCase();

    // A. NẾU LÀ LINK TRỰC TIẾP (Paste link) -> Cobalt
    if (lowerQ.includes('http')) {
        return await getLinkViaCobalt(query);
    }

    // B. NẾU MUỐN NGHE KÊNH @BALLAD.BMZ (Mới)
    // Từ khóa: "ballad", "nhạc tâm trạng", "tiktok chill"
    const balladKeywords = ['ballad', 'tâm trạng', 'nhạc buồn', 'tiktok chill'];
    if (balladKeywords.some(k => lowerQ.includes(k))) {
        // Thử lấy từ RSS TikTok trước
        const tiktokUrl = await getRandomFromRSS(RSS_TIKTOK_BALLAD, 'TikTok');
        if (tiktokUrl) return tiktokUrl;
        
        // Nếu RSS TikTok lỗi (do server chặn), TỰ ĐỘNG chuyển sang tìm trên YouTube
        // Tìm "Ballad BMZ compilation" trên Youtube -> Bao ổn định
        console.log("⚠️ RSS TikTok lỗi -> Chuyển sang tìm YouTube Compilation cho chắc ăn.");
        const yt = spawn('/usr/local/bin/yt-dlp', [
            `ytsearch1:ballad bmz tiktok compilation audio`, 
            '-f', 'bestaudio/best', '--get-url', '--no-playlist', '--no-warnings'
        ]);
        let url = '';
        return new Promise((resolve) => {
            yt.stdout.on('data', d => url += d);
            yt.on('close', () => resolve(url.trim() ? url.trim().split('\n')[0] : null));
        });
    }

    // C. NẾU LÀ PODCAST GIANG ƠI
    if (['podcast', 'giang', 'bót', 'radio'].some(k => lowerQ.includes(k))) {
        const podcastUrl = await getRandomFromRSS(RSS_GIANG_OI, 'SoundCloud');
        if (podcastUrl) return podcastUrl;
    }

    // D. CÒN LẠI -> TÌM NHẠC SOUNDCLOUD (Fallback)
    console.log(`🔍 Fallback Search SC: ${query}`);
    const sc = spawn('/usr/local/bin/yt-dlp', [
        `scsearch1:${query}`, 
        '-f', 'bestaudio/best', '--get-url', '--no-playlist', '--no-warnings'
    ]);
    let scUrl = '';
    return new Promise((resolve) => {
        sc.stdout.on('data', d => scUrl += d);
        sc.on('close', () => resolve(scUrl.trim() ? scUrl.trim().split('\n')[0] : null));
    });
}

// --- CÁC API KHÁC GIỮ NGUYÊN ---
app.get('/search', async (req, res) => {
    const q = req.query.q;
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: "Smart Stream", url: myServerUrl });
});

app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    console.log("🚀 Streaming Mono 64k...");

    ffmpeg(audioUrl)
        .inputOptions(['-reconnect 1', '-reconnect_streamed 1', '-reconnect_delay_max 5', '-user_agent "Mozilla/5.0"'])
        .audioFilters(['volume=2.0', 'alimiter=limit=0.95'])
        .audioCodec('libmp3lame')
        .audioBitrate(64)
        .audioChannels(1) // MONO
        .audioFrequency(44100)
        .format('mp3')
        .outputOptions(['-vn', '-flush_packets 1', '-preset ultrafast', '-movflags frag_keyframe+empty_moov'])
        .on('error', () => {})
        .pipe(res, { end: true });
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
