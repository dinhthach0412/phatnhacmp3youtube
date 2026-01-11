/**
 * 🎵 ULTRA SERVER V11 (STABILITY FIX)
 * - Fix lỗi FFmpeg SIGSEGV (Crash)
 * - Fix lỗi trả về link gốc thay vì link proxy
 * - Tối ưu buffer cho mạng yếu
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static'); 
const Parser = require('rss-parser');

// Cấu hình đường dẫn FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const parser = new Parser();
app.use(cors());

const PORT = process.env.PORT || 10000;
const YTDLP_PATH = './yt-dlp'; 

const GIANGOI_RSS = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

app.get('/', (req, res) => res.send('🔥 Server V11 (Stable FFmpeg) Ready'));

// --- HÀM TÌM KIẾM SOUNDCLOUD ---
function searchSoundCloud(query) {
    return new Promise((resolve, reject) => {
        console.log(`🔎 Executing yt-dlp for: ${query}`);
        
        const args = [
            `scsearch1:${query}`, 
            '--get-url',        
            '--no-playlist', 
            '--no-warnings',
            '--format', 'bestaudio/best', // Lấy bản tốt nhất
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
                    title: query 
                });
            } else {
                console.error(`❌ Search Failed. Code: ${code}`);
                resolve(null);
            }
        });
    });
}

// --- API TÌM KIẾM ---
app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    const host = req.get('host'); // Lấy domain hiện tại (ví dụ: phatnhacmp3youtube.onrender.com)
    const protocol = req.protocol === 'http' && host.includes('localhost') ? 'http' : 'https';
    
    // Hàm tạo link stream qua proxy của mình
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
                console.log(`✅ RSS Success: ${item.title}`);
                
                return res.json({ 
                    success: true, 
                    title: item.title, 
                    artist: 'Giang Oi Radio', 
                    url: makeStreamUrl(audioUrl), // [QUAN TRỌNG] Luôn dùng link proxy
                    is_podcast: true 
                });
            }
        } catch (e) {
            console.error('⚠️ RSS Failed:', e.message);
        }

        console.log("🔄 Fallback: Searching SoundCloud...");
        const fallbackData = await searchSoundCloud("Giang Oi Radio Podcast");
        
        if (fallbackData) {
            return res.json({ 
                success: true, 
                title: "Giang Oi Podcast (Auto)", 
                artist: 'Giang Oi', 
                url: makeStreamUrl(fallbackData.url), // [QUAN TRỌNG]
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
        url: makeStreamUrl(searchData.url) // [QUAN TRỌNG]
    });
});

// --- API STREAM (CẤU HÌNH FFMPEG AN TOÀN) ---
app.get('/stream', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("No URL");

    console.log("🚀 Streaming...");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    ffmpeg(url)
        .inputOptions([
            '-reconnect 1', 
            '-reconnect_streamed 1', 
            '-reconnect_delay_max 5',
            // [FIX CRASH] Tăng analyzeduration lên một chút để FFmpeg nhận diện luồng tốt hơn
            // Thay vì 0 (quá gắt), ta để 500000 (0.5s)
            '-analyzeduration 1000000', 
            '-probesize 1000000',
            '-user_agent "Mozilla/5.0"'
        ])
        .audioFilters(['volume=1.5']) // Giảm volume boost chút cho đỡ vỡ tiếng
        .audioCodec('libmp3lame')      
        .audioBitrate(128)            
        .audioChannels(2) // [FIX] Chuyển về Stereo (2 kênh) chuẩn MP3              
        .audioFrequency(44100)        
        .format('mp3')                
        .outputOptions([
            '-vn', '-map_metadata', '-1',
            '-id3v2_version', '0', 
            '-flush_packets', '1',        
            // [FIX CRASH] Dùng preset 'veryfast' thay vì 'ultrafast' để ổn định hơn
            '-preset', 'veryfast',       
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
    console.log(`🚀 Server V11 running on port ${PORT}`);
});
