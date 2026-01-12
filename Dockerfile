# Sử dụng Node.js 18 bản nhẹ (slim)
FROM node:18-slim

# Cài đặt Python3 và chứng chỉ SSL (Cần thiết để yt-dlp hoạt động tốt)
RUN apt-get update && apt-get install -y python3 ca-certificates && rm -rf /var/lib/apt/lists/*

# Thiết lập thư mục làm việc
WORKDIR /app

# Copy file package.json trước để cài thư viện (Tối ưu cache)
COPY package*.json ./

# Cài đặt các thư viện Node.js
RUN npm install

# Copy toàn bộ code vào
COPY . .

# Mở port 10000
EXPOSE 10000

# Lệnh chạy server
CMD ["node", "index.js"]
