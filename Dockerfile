FROM node:18-slim

# 1. Cài đặt FFmpeg + Python3 + Curl
RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 2. Tải và cài đặt yt-dlp (Phiên bản mới nhất)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
