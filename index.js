const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process'); // Cần cái này để chạy yt-dlp search SoundCloud
const ffmpeg = require('fluent-ffmpeg');
const Parser = require('rss-parser');
const axios = require('axios'); // Để gọi Cobalt
const parser = new Parser();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// --- CẤU HÌNH NGUỒN ---
const RSS_TIKTOK_BALLAD = 'https://proxitok.pabloferreiro.es/@ballad.bmz/rss';
const RSS_GIANG_OI = 'https://feeds.soundcloud.com/users/soundcloud:users:253460064/sounds.rss';

// --- TRẠNG THÁI SERVER ---
let serverStatus = "Booting...";
// Update yt-dlp (Quan trọng cho SoundCloud Search)
const updateProcess = spawn('/usr/local/bin/yt-dlp', ['-U']);
updateProcess.on('close', () => { serverStatus = "Online (Full Option)"; });

// ============================================================
// 1. TOOL: COBALT (Tải link TikTok/Youtube/FB không bị chặn)
// ============================================================
async function getLinkViaCobalt(url) {
    try {
        console.log(`🌐 Cobalt: Đang xử lý link -> ${url}`);
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
        console.error("❌ Cobalt Error (Thử lại sau)");
        return null;
    }
}

// ============================================================
// 2. TOOL: LẤY RSS (Hỗ trợ cả SC & TikTok)
// ============================================================
async function getRandomFromRSS(rssUrl, type) {
    try {
        console.log(`🎙 Đọc RSS (${type})...`);
        const feed = await parser.parseURL(rssUrl);
        if (!feed.items || !feed.items.length) return null;

        const randomItem = feed.items[Math.floor(Math.random() * feed.items.length)];
        console.log(`✅ Chọn bài: ${randomItem.title}`);

        // Nếu là TikTok RSS -> Lấy link video rồi ném qua Cobalt
        if (type === 'tiktok') {
            return await getLinkViaCobalt(randomItem.link);
        }
        // Nếu là SoundCloud RSS -> Lấy link file trực tiếp
        return randomItem.enclosure ? randomItem.enclosure.url : randomItem.link;
    } catch (e) {
        console.error("❌ Lỗi RSS:", e.message);
        return null;
    }
}

// ============================================================
// 3. TOOL: TÌM KIẾM SOUNDCLOUD (Cái cũ bạn cần giữ lại đây)
// ============================================================
function searchSoundCloud(query) {
    return new Promise((resolve, reject) => {
        let cleanQuery = query.toLowerCase().replace(/youtube|zing|mp3|phát nhạc|mở nhạc|bài hát|của/g, "").trim();
        let finalQuery = cleanQuery.length > 1 ? cleanQuery : query;
        
        console.log(`🔍 Fallback Search SC: "${finalQuery}"`);
        
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
// LOGIC ĐIỀU PHỐI TRUNG TÂM (Main Brain)
// ============================================================
async function getAudioUrl(query) {
    const lowerQ = query.toLowerCase();

    // 1. LINK TRỰC TIẾP -> Cobalt
    if (lowerQ.includes('http')) {
        return await getLinkViaCobalt(query);
    }

    // 2. PODCAST GIANG ƠI
    if (['podcast', 'giang ơi', 'bót cát'].some(k => lowerQ.includes(k))) {
        const url = await getRandomFromRSS(RSS_GIANG_OI, 'sc');
        if (url) return url;
    }

    // 3. TIKTOK TÂM TRẠNG (Kênh @ballad.bmz)
    const tiktokKeywords = ['tiktok', 'tít tót', 'tíc tốc', 'tâm trạng', 'ballad', 'buồn', 'nhạc tiktok'];
    if (tiktokKeywords.some(k => lowerQ.includes(k))) {
        const url = await getRandomFromRSS(RSS_TIKTOK_BALLAD, 'tiktok');
        if (url) return url;
        // Nếu lỗi RSS TikTok -> Nó sẽ tự trôi xuống bước 4 (SoundCloud) chứ không chết luôn
    }

    // 4. MẶC ĐỊNH -> TÌM NHẠC SOUNDCLOUD (Phần bạn muốn giữ)
    return await searchSoundCloud(query);
}

app.get('/', (req, res) => res.send(`Server Music ESP32 - ${serverStatus}`));

// API Search trả về JSON cho App/Web (nếu có)
app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'No query' });
    const myServerUrl = `https://${req.get('host')}/stream?q=${encodeURIComponent(q)}`;
    res.json({ success: true, title: q, artist: "Smart Audio", url: myServerUrl });
});

// API Stream Audio về ESP32
app.get('/stream', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("No query");

    const audioUrl = await getAudioUrl(q);
    
    if (!audioUrl) return res.status(404).send("Not found");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    console.log("🚀 Streaming Mono 64k...");

    ffmpeg(audioUrl)
        .inputOptions([
            '-reconnect 1', '-reconnect_streamed 1', '-reconnect_delay_max 5',
            '-user_agent "Mozilla/5.0"'
        ])
        .audioFilters(['volume=2.0', 'alimiter=limit=0.95'])
        .audioCodec('libmp3lame')
        .audioBitrate(64)
        .audioChannels(1) // MONO
        .audioFrequency(44100)
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

app.listen(PORT, () => console.log(`Server chạy port ${PORT}`));
