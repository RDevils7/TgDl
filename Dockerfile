# ============================================================
# TG-DL Docker 镜像
# Telegram 文件/视频下载工具 - 容器化部署
# ============================================================

# 构建阶段
FROM node:20-slim AS builder

WORKDIR /app

# 复制 package 文件并安装生产依赖（跳过 devDependencies）
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# 运行阶段（使用 Debian slim 作为基础镜像，方便安装 tdl 依赖）
FROM debian:bookworm-slim AS runtime

LABEL maintainer="RDevils7"
LABEL description="TG-DL - Telegram File/Video Downloader (Docker)"
LABEL version="1.0.0"

# 安装基础依赖 + tdl 运行所需依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Node.js 20.x (tdl 和 tg-dl 都需要)
    curl gnupg ca-certificates \
    libssl3 libstdc++6 zlib1g \
    # tdl 依赖的系统库
    libopus0 libssl-dev \
    # 其他工具
    wget unzip \
    && rm -rf /var/lib/apt/lists/*

# ---- 安装 Node.js 20.x ----
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version && npm --version

# ---- 安装 tdl CLI ----
# 从 GitHub Releases 获取最新版 tdl Linux 二进制
ARG TDL_VERSION=latest
ENV TDL_PATH=/usr/local/bin/tdl

RUN echo "Installing tdl..." \
    && if [ "$TDL_VERSION" = "latest" ]; then \
        TDL_URL="https://github.com/tyler1234/tdl/releases/latest/download/tdl-linux-x64"; \
       else \
        TDL_URL="https://github.com/tyler1234/tdl/releases/download/v${TDL_VERSION}/tdl-linux-x64"; \
       fi \
    && wget -qO /usr/local/bin/tdl "${TDL_URL}" \
    && chmod +x /usr/local/bin/tdl \
    && tdl --version || echo "tdl installed at ${TDL_PATH}"

# ---- 复制应用代码 ----
WORKDIR /app

# 从 builder 阶段复制 node_modules
COPY --from=builder /app/node_modules ./node_modules

# 复制应用源码
COPY server.js ./
COPY public/ ./public/
COPY data/ ./data/

# 创建必要目录
RUN mkdir -p downloads \
    && mkdir -p /root/.tdl \
    && chmod -R 777 /root/.tdl downloads data

# 环境变量
ENV NODE_ENV=production
ENV PORT=3210
ENV TDL_PATH=/usr/local/bin/tdl
ENV DOWNLOAD_DIR=/app/downloads
ENV CONFIG_FILE=/app/data/config.json

# 暴露端口
EXPOSE 3210

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3210/ || exit 1

# 启动命令
CMD ["node", "server.js"]
