# TgDl — Telegram 文件下载工具
# 多阶段构建：依赖安装 → 运行时

# ---- 基础镜像 ----
FROM node:20-slim

# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 安装运行时依赖（node-pty 需要编译工具，tdl 需要 C 运行时）
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    curl ca-certificates \
    libc6 libssl3 libstdc++6 zlib1g libgcc-s1 \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装 Node.js 依赖
COPY package.json ./
RUN npm install && npm cache clean --force

# 复制项目文件
COPY server.js ./
COPY public/ ./public/

# 安装 tdl CLI
COPY tdl /usr/local/bin/tdl
RUN chmod +x /usr/local/bin/tdl

# 下载目录
RUN mkdir -p /app/downloads /app/data

# 环境变量
ENV PORT=3210
ENV TDL_PATH=/usr/local/bin/tdl
ENV DOWNLOAD_DIR=/app/downloads
ENV CONFIG_FILE=/app/data/config.json

EXPOSE 3210

CMD ["node", "server.js"]
