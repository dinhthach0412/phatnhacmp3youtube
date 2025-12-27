const express = require('express');
const cors = require('cors');
const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');

const app = express();
app.use(cors());

// Hàm lấy link stream (Cố gắng lấy format nhẹ nhất cho ESP32)
async function getAudioLink(videoId) {
    try {
        const info = await ytdl.getInfo(videoId);
        // Lọc lấy chỉ âm thanh (audio only)
        const formats = ytdl.filterFormats(info.formats, 'audioonly');
        
        // Ưu tiên định dạng m4a hoặc mp3 bitrate thấp để ESP32 load nhanh
        // Sắp xếp bitrate từ thấp lên cao (để đỡ lag)
        const sorted = formats.sort((a, b) => a.bitrate - b.bitrate);
        
        if (sorted.length > 0) {
            return sorted[0].url; // Lấy link nhẹ nhất
        }
        return null;
    } catch (e) {
        console.error("Lỗi lấy link YTDL:", e);
        return null;
    }
}

app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: "Thiếu tên bài" });

        console.log(`🔍 Đang tìm Youtube: ${query}`);
        
        // 1. Tìm video
        const r = await yts(query);
        const videos = r.videos;

        if (videos && videos.length > 0) {
            const video = videos[0]; // Lấy kết quả đầu tiên
            console.log(`✅ Thấy bài: ${video.title} (${video.videoId})`);

            // 2. Lấy link stream thực tế
            const streamUrl = await getAudioLink(video.videoId);

            if (streamUrl) {
                return res.json({
                    success: true,
                    title: video.title,
                    url: streamUrl
                });
            } else {
                return res.status(500).json({ error: "Không lấy được link stream" });
            }
        }
        res.status(404).json({ error: "Không tìm thấy video nào" });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Lỗi Server Youtube" });
    }
});

app.get('/', (req, res) => res.send('<h1>Server Nhạc Youtube Sẵn Sàng! 🎵</h1>'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server chạy port ${port}`));
