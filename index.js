/**
 * 🎵 ULTRA SERVER V12 (HYBRID STABLE)
 * - Cơ chế: yt-dlp lấy link -> FFmpeg "ăn tạp" convert sang MP3 128kbps
 * - Fix lỗi Crash SIGSEGV bằng cấu hình FFmpeg chuẩn
 * - Hỗ trợ Podcast Giang Ơi + SoundCloud Search
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static'); // Dùng bản static cho chắc ăn
const Parser = require('rss-parser');

// Cấu hình đường dẫn FFmpeg cứng
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const parser = new Parser();
app.use(cors());

const PORT = process.env.PORT || 10000;
const YTDLP_PATH = './yt-dlp'; 
const GIANGOI_RSS = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

app.get('/', (req, res) => res.send('🔥 Server V12 (Hybrid Stable) Ready'));

// --- HÀM TÌM KIẾM SOUNDCLOUD ---
function searchSoundCloud(query) {
    return new Promise((resolve, reject) => {
        // Lọc từ khóa rác
        let cleanQuery = query.toLowerCase().replace(/youtube|zing|mp3|phát nhạc|mở nhạc|bài hát|của/g, "").trim();
        let finalQuery = cleanQuery.length > 1 ? cleanQuery : query;
        
        console.log(`🔎 Executing yt-dlp for: ${finalQuery}`);
        
        const args = [
            `scsearch1:${finalQuery}`, 
            '--get-url',        
            '--no-playlist', 
            '--no-warnings',
            '--format', 'bestaudio/best', 
            // Fake User-Agent để tránh bị chặn
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        ];

        const yt = spawn(YTDLP_PATH, args);
        let url = '';
        
        yt.stdout.on('data', d => url += d.toString());
        
        yt.on('close', code => {
            const finalUrl = url.trim().split('\n')[0];
            
            if (code === 0 && finalUrl) {
                console.log(`✅ Found URL: ${finalUrl}`);
                resolve({
                    url: finalUrl,
                    title: finalQuery 
                });
            } else {
                console.error(`❌ Search Failed. Code: ${code}`);
                resolve(null);
            }
        });
    });
}

// --- API TÌM KIẾM (TRẢ VỀ LINK STREAM CỦA SERVER) ---
app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    const host = req.get('host'); 
    const protocol = req.protocol === 'http' && host.includes('localhost') ? 'http' : 'https';
    
    // Hàm tạo link stream nội bộ
    // ESP32 sẽ gọi vào link này -> Server chạy FFmpeg -> Trả về MP3
    const makeStreamUrl = (targetUrl) => {
        return `${protocol}://${host}/stream?url=${encodeURIComponent(targetUrl)}`;
    };

    console.log(`🔍 Search Request: ${q}`);

    // --- 1. XỬ LÝ PODCAST ---
    if (q.includes('cmd:podcast') || q.includes('giang oi')) {
        console.log("🎙 Mode: PODCAST");
        try {
            const feed = await parser.parseURL(GIANGOI_RSS);
            const item = feed.items[0]; 
            if (item) {
                const audioUrl = item.enclosure ? item.enclosure.url : item.link;
                return res.json({ 
                    success: true, 
                    title: item.title, 
                    artist: 'Giang Oi Radio', 
                    url: makeStreamUrl(audioUrl), // Qua FFmpeg
                    is_podcast: true 
                });
            }
        } catch (e) { console.error('RSS Error:', e.message); }

        const fallbackData = await searchSoundCloud("Giang Oi Radio Podcast");
        if (fallbackData) {
            return res.json({ 
                success: true, 
                title: "Giang Oi Podcast (Auto)", 
                artist: 'Giang Oi', 
                url: makeStreamUrl(fallbackData.url), // Qua FFmpeg
                is_podcast: true
            });
        }
        return res.json({ success: false, error: 'Podcast Not Found' });
    }

    // --- 2. XỬ LÝ NHẠC THƯỜNG ---
    const searchData = await searchSoundCloud(q);
    if (!searchData) return res.json({ success: false, error: 'Not found' });

    res.json({ 
        success: true, 
        title: q, 
        artist: "SoundCloud", 
        url: makeStreamUrl(searchData.url) // Qua FFmpeg
    });
});

// --- API STREAM (FFMPEG "ĂN TẠP" - BẢN ỔN ĐỊNH) ---
app.get('/stream', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("No URL");

    console.log("🚀 Transcoding Stream...");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    ffmpeg(url)
        .inputOptions([
            '-reconnect 1', 
            '-reconnect_streamed 1', 
            '-reconnect_delay_max 5',
            // Cấu hình an toàn: Không ép probesize quá nhỏ để tránh Crash với M3U8 lạ
            '-probesize 128000', 
            '-user_agent "Mozilla/5.0"'
        ])
        .audioFilters(['volume=1.5']) 
        .audioCodec('libmp3lame')      
        .audioBitrate(128)   // 128k là chuẩn, nghe hay hơn 64k         
        .audioChannels(2)    // Stereo          
        .audioFrequency(44100)        
        .format('mp3')                
        .outputOptions([
            '-vn', '-map_metadata', '-1',
            '-id3v2_version', '0', 
            '-flush_packets', '1',        
            '-preset', 'veryfast',  // veryfast ổn định hơn ultrafast trên Render     
            '-movflags', 'frag_keyframe+empty_moov'
        ])
        .on('error', (err) => {
            if (!err.message.includes('Output stream closed')) {
                console.error('FFmpeg Log:', err.message);
            }
        })
        .pipe(res, { end: true });
});

app.listen(PORT, () => {
    console.log(`🚀 Server V12 running on port ${PORT}`);
});
