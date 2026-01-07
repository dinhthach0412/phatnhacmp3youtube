/**
 * 🎵 SOUNDCLOUD SERVER V5 (LIVE PIPE EDITION)
 * - Khắc phục triệt để lỗi 60KB (HTML Error Page)
 * - Cơ chế: Dùng yt-dlp tải và bơm trực tiếp (Stream Pipe)
 * - Không cần lấy link trung gian -> Tránh bị SoundCloud chặn Token
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const Parser = require('rss-parser');
// Bỏ luôn thư viện https vì không dùng Node để tải nữa

const app = express();
const parser = new Parser();
app.use(cors());

const PORT = process.env.PORT || 10000;
const YTDLP_PATH = './yt-dlp'; 

// RSS Podcast Giang Ơi
const GIANGOI_RSS = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

app.get('/', (req, res) => res.send('🔥 SoundCloud Server V5 (Live Pipe) Ready'));

/* =========================================
   1. HÀM STREAM TRỰC TIẾP (QUAN TRỌNG NHẤT)
   - Thay vì Node.js tải, ta bắt yt-dlp tải và phun ra stdout
   - Node.js chỉ việc hứng stdout và ném về cho ESP32
   ========================================= */
app.get('/proxy', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).end();

    console.log(`▶️ Live Streaming: ${url}`);

    // Cấu hình yt-dlp để stream trực tiếp (dùng tài nguyên của nó để fake browser)
    const args = [
        '-o', '-',             // Quan trọng: In dữ liệu ra màn hình (stdout) để Node hứng
        '-f', 'bestaudio',     // Lấy âm thanh tốt nhất
        '--no-playlist',
        '--no-part',           // Không tạo file .part
        '--buffer-size', '16K', // Buffer nhỏ để stream mượt
        url
    ];

    // Spawn tiến trình yt-dlp
    const ytDlpProcess = spawn(YTDLP_PATH, args);

    // Set Header trả về cho ESP32
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked'); // Báo cho ESP32 biết là dữ liệu stream liên tục

    // NỐI ỐNG: yt-dlp (stdout) ===> ESP32 (res)
    ytDlpProcess.stdout.pipe(res);

    // Xử lý lỗi
    ytDlpProcess.stderr.on('data', (data) => {
        // console.error(`[Stream Log]: ${data}`); // Bật lên nếu muốn debug
    });

    ytDlpProcess.on('close', (code) => {
        if (code !== 0) console.log(`Stream kết thúc với mã: ${code}`);
        res.end();
    });

    // Khi ESP32 ngắt kết nối (tắt loa), giết luôn yt-dlp để đỡ tốn RAM server
    req.on('close', () => {
        console.log('🛑 Client ngắt kết nối -> Kill yt-dlp');
        ytDlpProcess.kill();
    });
});

/* =========================================
   2. HÀM TÌM KIẾM SOUNDCLOUD
   ========================================= */
function searchSoundCloud(query) {
    return new Promise((resolve, reject) => {
        const proc = spawn(YTDLP_PATH, [
            `scsearch1:${query}`, 
            '--dump-json',        
            '--no-playlist'
        ]);

        let output = '';
        proc.stdout.on('data', d => output += d.toString());
        
        proc.on('close', code => {
            if (code !== 0 || !output) return reject(new Error('No result'));
            try {
                const data = JSON.parse(output);
                resolve(data);
            } catch (e) {
                reject(e);
            }
        });
    });
}

/* =========================================
   3. API TÌM KIẾM (TRẢ VỀ LINK GỐC, KHÔNG PHẢI LINK TOKEN)
   ========================================= */
app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    console.log(`🔍 Search: ${q}`);

    // --- LUỒNG 1: PODCAST (RSS) ---
    if (q.includes('cmd:podcast') || q.includes('giang oi')) {
        console.log('🎙 Mode: PODCAST (RSS)');
        try {
            const feed = await parser.parseURL(GIANGOI_RSS);
            const item = feed.items[0];

            if (item) {
                // Lấy Link Gốc (thường là link feedproxy hoặc soundcloud direct)
                // V5: Cứ ném link gốc cho yt-dlp xử lý, nó cân tất
                const audioUrl = item.enclosure ? item.enclosure.url : item.link;
                const proxyUrl = `https://${req.get('host')}/proxy?url=${encodeURIComponent(audioUrl)}`;

                return res.json({
                    success: true,
                    title: item.title,
                    artist: 'Giang Oi Radio',
                    url: proxyUrl,
                    is_podcast: true
                });
            }
        } catch (e) {
            console.error('RSS Error:', e.message);
            return res.json({ success: false, error: 'Lỗi RSS' });
        }
        return res.json({ success: false, error: 'Không tìm thấy Podcast' });
    }

    // --- LUỒNG 2: NHẠC SOUNDCLOUD ---
    console.log("☁️ Mode: SOUNDCLOUD MUSIC");
    try {
        const data = await searchSoundCloud(q);
        
        // [CỰC KỲ QUAN TRỌNG - THAY ĐỔI LỚN Ở V5]
        // Ở V4: Ta lấy data.url (link token dài ngoằng) -> Dễ bị chặn
        // Ở V5: Ta lấy data.webpage_url (link gốc: soundcloud.com/user/bai-hat)
        // Lý do: Đưa link gốc cho yt-dlp ở hàm /proxy, nó sẽ tự lo việc lách luật.
        
        const safeLink = data.webpage_url || data.url; 
        const proxyUrl = `https://${req.get('host')}/proxy?url=${encodeURIComponent(safeLink)}`;

        console.log(`✅ Found SC (Webpage): ${data.title}`);
        return res.json({
            success: true,
            title: data.title,
            artist: data.uploader || 'SoundCloud Artist',
            url: proxyUrl
        });

    } catch (e) {
        console.error("SC Error:", e.message);
        return res.json({ success: false, error: 'Không tìm thấy nhạc' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 SoundCloud V5 (Live Pipe) running on port ${PORT}`);
});
