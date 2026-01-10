/**
 * 🎵 ULTRA SERVER V9 (SMART FALLBACK)
 * - Tự động cập nhật yt-dlp
 * - Fix lỗi Podcast: Nếu RSS chết -> Tự động tìm kiếm trên SoundCloud
 * - Fix lỗi M3U8 & 60KB (Dùng FFmpeg Transcode)
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const Parser = require('rss-parser');

const app = express();
const parser = new Parser();
app.use(cors());

const PORT = process.env.PORT || 10000;
const YTDLP_PATH = './yt-dlp'; 

// RSS Podcast (Nếu link này chết, Server sẽ tự tìm kiếm thay thế)
const GIANGOI_RSS = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

app.get('/', (req, res) => res.send('🔥 Server V9 (Smart Fallback) Ready'));

// --- HÀM TÌM KIẾM SOUNDCLOUD (Dùng khi RSS lỗi) ---
function searchSoundCloud(query) {
    return new Promise((resolve, reject) => {
        const args = [
            `scsearch1:${query}`, 
            '--get-url',       
            '--no-playlist', 
            '--no-warnings',
            '--format', 'bestaudio/best'
        ];

        const yt = spawn(YTDLP_PATH, args);
        let url = '';

        yt.stdout.on('data', d => url += d.toString());
        
        yt.on('close', code => {
            const finalUrl = url.trim().split('\n')[0];
            if (code === 0 && finalUrl) {
                resolve({
                    url: finalUrl,
                    title: query // Tạm dùng query làm title
                });
            } else {
                resolve(null);
            }
        });
    });
}

// --- API TÌM KIẾM THÔNG MINH ---
app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    console.log(`🔍 Search: ${q}`);

    // --- 1. XỬ LÝ PODCAST ---
    if (q.includes('cmd:podcast') || q.includes('giang oi')) {
        console.log("🎙 Mode: PODCAST");
        
        // CÁCH 1: Thử lấy qua RSS (Nhanh, chuẩn)
        try {
            const feed = await parser.parseURL(GIANGOI_RSS);
            const item = feed.items[0]; // Lấy bài mới nhất
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
            console.error('⚠️ RSS Failed (Chuyển sang tìm kiếm):', e.message);
        }

        // CÁCH 2: RSS lỗi -> Chuyển sang tìm kiếm thủ công (FALLBACK)
        console.log("🔄 Fallback: Searching SoundCloud...");
        const fallbackData = await searchSoundCloud("Giang Oi Radio Podcast");
        
        if (fallbackData) {
            console.log(`✅ Fallback Success: ${fallbackData.url}`);
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

// --- API STREAM (FFMPEG TRANSCODE) ---
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
            // [THÊM MỚI] Giảm thời gian phân tích để phát ngay lập tức
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
            '-flush_packets', '1',        // Bơm gói tin đi ngay lập tức
            '-preset', 'ultrafast',       // Xử lý siêu tốc
            '-movflags', 'frag_keyframe+empty_moov'
        ])
        .on('error', (err) => {
            if (!err.message.includes('Output stream closed')) {
                // console.error('FFmpeg Err:', err.message);
            }
        })
        .pipe(res, { end: true });
});

app.listen(PORT, () => {
    console.log(`🚀 Server V9 running on port ${PORT}`);
});
