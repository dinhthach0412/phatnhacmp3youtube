/**
 * 🎵 ULTRA SERVER V10 (ANTI-BLOCK & STABLE)
 * - Tích hợp ffmpeg-static (Không lo thiếu thư viện)
 * - Fake User-Agent cho yt-dlp (Chống chặn)
 * - Log lỗi chi tiết
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static'); // [MỚI] Dùng bản static
const Parser = require('rss-parser');

// [MỚI] Cấu hình đường dẫn FFmpeg cứng
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const parser = new Parser();
app.use(cors());

const PORT = process.env.PORT || 10000;
const YTDLP_PATH = './yt-dlp'; 

const GIANGOI_RSS = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

app.get('/', (req, res) => res.send('🔥 Server V10 (Anti-Block) Ready'));

// --- HÀM TÌM KIẾM SOUNDCLOUD (Fix chặn IP) ---
function searchSoundCloud(query) {
    return new Promise((resolve, reject) => {
        console.log(`🔎 Executing yt-dlp for: ${query}`);
        
        const args = [
            `scsearch1:${query}`, 
            '--get-url',        
            '--no-playlist', 
            '--no-warnings',
            '--format', 'bestaudio/best',
            // [MỚI] Giả danh trình duyệt để tránh bị chặn 403 Forbidden
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        ];

        const yt = spawn(YTDLP_PATH, args);
        let url = '';
        let errorLog = '';

        yt.stdout.on('data', d => url += d.toString());
        yt.stderr.on('data', d => errorLog += d.toString()); // Hứng lỗi
        
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
                console.error(`❌ Error Log: ${errorLog}`); // In lỗi ra xem bị gì
                resolve(null);
            }
        });
    });
}

// --- API TÌM KIẾM THÔNG MINH ---
app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
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
                const myStreamUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(audioUrl)}`;
                return res.json({ 
                    success: true, 
                    title: item.title, 
                    artist: 'Giang Oi Radio', 
                    url: myStreamUrl, 
                    is_podcast: true 
                });
            }
        } catch (e) {
            console.error('⚠️ RSS Failed:', e.message);
        }

        console.log("🔄 Fallback: Searching SoundCloud...");
        const fallbackData = await searchSoundCloud("Giang Oi Radio Podcast");
        
        if (fallbackData) {
            const myStreamUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(fallbackData.url)}`;
            return res.json({ 
                success: true, 
                title: "Giang Oi Podcast (Auto)", 
                artist: 'Giang Oi', 
                url: myStreamUrl,
                is_podcast: true
            });
        }

        return res.json({ success: false, error: 'Podcast Not Found' });
    }

    // --- 2. XỬ LÝ NHẠC THƯỜNG ---
    const searchData = await searchSoundCloud(q);
    if (!searchData) return res.json({ success: false, error: 'Not found' });

    const myStreamUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(searchData.url)}`;
    
    res.json({ 
        success: true, 
        title: q, 
        artist: "SoundCloud", 
        url: myStreamUrl 
    });
});

// --- API STREAM ---
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
            '-analyzeduration 0', 
            '-probesize 32', 
            '-user_agent "Mozilla/5.0"'
        ])
        .audioFilters(['volume=2.0']) 
        .audioCodec('libmp3lame')      
        .audioBitrate(128)            
        .audioChannels(1)              
        .audioFrequency(44100)        
        .format('mp3')                
        .outputOptions([
            '-vn', '-map_metadata', '-1',
            '-id3v2_version', '0', 
            '-flush_packets', '1',        
            '-preset', 'ultrafast',       
            '-movflags', 'frag_keyframe+empty_moov'
        ])
        .on('error', (err) => {
            // Ignor lỗi đóng kết nối thông thường
            if (!err.message.includes('Output stream closed')) {
                console.error('FFmpeg Log:', err.message);
            }
        })
        .pipe(res, { end: true });
});

app.listen(PORT, () => {
    console.log(`🚀 Server V10 running on port ${PORT}`);
});
