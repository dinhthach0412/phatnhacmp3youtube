const express = require('express');
const { zing: ZingMp3 } = require('zingmp3-api-next');  // Thư viện mới nhất 2025

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send(`
        <h2>SERVER PHÁT NHẠC ZINGMP3 VIỆT NAM ĐANG CHẠY MƯỢT! 🔥</h2>
        <p>Test: /search?q=khóc cùng em</p>
        <p>Query gợi ý: khóc cùng em, nơi này có anh, bolero, remix, lofi...</p>
    `);
});

app.get('/search', async (req, res) => {
    const query = req.query.q || '';

    if (!query) {
        return res.json({ success: false, error: "Thiếu tên bài hát! Ví dụ: /search?q=khóc cùng em" });
    }

    try {
        console.log(`Tìm bài: ${query}`);

        const searchResult = await ZingMp3.search({ keyword: query });

        if (!searchResult.data || !searchResult.data.songs || searchResult.data.songs.length === 0) {
            return res.json({ success: false, error: "Không tìm thấy bài hát nào" });
        }

        const song = searchResult.data.songs[0];
        const songId = song.encodeId;

        const streamResult = await ZingMp3.getSong({ id: songId });

        let streamUrl = null;
        if (streamResult.data) {
            streamUrl = streamResult.data["320k"] || streamResult.data["128k"] || streamResult.data["lossless"];
        }

        if (!streamUrl) {
            return res.json({ success: false, error: "Không lấy được link phát (VIP?)" });
        }

        res.json({
            success: true,
            title: song.title || "Không rõ",
            artist: song.artistsNames || "Không rõ",
            stream_url: streamUrl
        });

        console.log(`Phát OK: ${song.title}`);

    } catch (error) {
        console.error("Lỗi Zing:", error.message);
        res.json({ success: false, error: "Lỗi kết nối ZingMP3, thử lại sau" });
    }
});

app.listen(PORT, () => {
    console.log(`Server chạy port ${PORT}`);
});
