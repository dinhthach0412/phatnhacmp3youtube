/**
 * 🎵 ULTRA SERVER V8 (FFMPEG TRANSCODE EDITION)
 * - "Máy xay sinh tố": Chuyển mọi định dạng (m3u8, aac...) thành MP3 Mono
 * - Tăng âm lượng 200% (Volume Boost)
 * - Cắt bỏ rác (Metadata) giúp ESP32 load siêu nhanh
 * - Fix triệt để lỗi 60KB và lỗi M3U8
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
// Đường dẫn yt-dlp (do postinstall tải về)
const YTDLP_PATH = './yt-dlp'; 

// RSS Podcast Giang Ơi
const GIANGOI_RSS = 'https://feeds.soundcloud.com/users/soundcloud:users:302069608/sounds.rss';

app.get('/', (req, res) => res.send('🔥 Server V8 (FFmpeg Transcode) Ready'));

// --- HÀM LẤY LINK GỐC (SCSEARCH1) ---
function getAudioUrl(query) {
    return new Promise((resolve, reject) => {
        // Tìm kiếm trên SoundCloud
        const args = [
            `scsearch1:${query}`, 
            '--get-url',       // Chỉ lấy Link
            '--no-playlist', 
            '--no-warnings',
            '--format', 'bestaudio/best'
        ];

        const yt = spawn(YTDLP_PATH, args);
        let url = '';

        yt.stdout.on('data', d => url += d.toString());
        
        yt.on('close', code => {
            const finalUrl = url.trim().split('\n')[0]; // Lấy dòng đầu tiên
            if (code === 0 && finalUrl) {
                console.log(`✅ Link Gốc: ${finalUrl}`);
                resolve(finalUrl);
            } else {
                console.log("❌ Không tìm thấy bài nào.");
                resolve(null);
            }
        });
    });
}

// --- API TÌM KIẾM ---
app.get('/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    console.log(`🔍 Search: ${q}`);

    // PODCAST
    if (q.includes('cmd:podcast') || q.includes('giang oi')) {
        try {
            const feed = await parser.parseURL(GIANGOI_RSS);
            const item = feed.items[0];
            if (item) {
                const audioUrl = item.enclosure ? item.enclosure.url : item.link;
                // Chuyển qua stream ffmpeg luôn cho đồng bộ
                const myStreamUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(audioUrl)}`;
                return res.json({ success: true, title: item.title, artist: 'Giang Oi', url: myStreamUrl, is_podcast: true });
            }
        } catch (e) {}
    }

    // NHẠC SOUNDCLOUD
    const audioUrl = await getAudioUrl(q);
    if (!audioUrl) return res.json({ success: false, error: 'Not found' });

    // Trả về link Stream qua Server mình
    const myStreamUrl = `https://${req.get('host')}/stream?url=${encodeURIComponent(audioUrl)}`;
    
    res.json({ 
        success: true, 
        title: q, 
        artist: "SoundCloud", 
        url: myStreamUrl 
    });
});

// --- API STREAM (TRÁI TIM CỦA SERVER) ---
app.get('/stream', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("No URL");

    console.log("🚀 FFmpeg Transcoding...");

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    ffmpeg(url)
        .inputOptions([
            '-reconnect 1', 
            '-reconnect_streamed 1', 
            '-reconnect_delay_max 5',
            '-user_agent "Mozilla/5.0"' // Fake User-Agent để ko bị chặn
        ])
        // --- XỬ LÝ ÂM THANH CHO ESP32 ---
        .audioFilters(['volume=2.0'])    // Tăng âm lượng gấp đôi
        .audioCodec('libmp3lame')        // Ép về MP3
        .audioBitrate(128)               // 128k nghe cho hay (ESP32 chịu được tốt)
        .audioChannels(1)                // Chuyển về Mono (cho loa đơn)
        .audioFrequency(44100)           // Tần số lấy mẫu chuẩn
        .format('mp3')                   // Định dạng đầu ra MP3
        .outputOptions([
            '-vn', '-map_metadata', '-1', // Xoá sạch ảnh bìa, tag rác
            '-id3v2_version', '0', 
            '-flush_packets', '1',        // Bơm dữ liệu ngay lập tức
            '-preset', 'ultrafast',       // Xử lý siêu nhanh
            '-movflags', 'frag_keyframe+empty_moov'
        ])
        .on('error', (err) => {
            // Bỏ qua lỗi khi client tắt loa
            if (!err.message.includes('Output stream closed')) {
                // console.error('FFmpeg Err:', err.message);
            }
        })
        .pipe(res, { end: true }); // Bơm thẳng về ESP32
});

app.listen(PORT, () => {
    console.log(`🚀 Server V8 (FFmpeg) running on port ${PORT}`);
});
