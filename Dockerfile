# ============================================================
# TG-DL Docker 镜像 - NAS 优化版
# Telegram 文件/视频下载工具
#
# 支持：linux/amd64, linux/arm64（覆盖绝大多数 NAS）
# 构建方式：
#   docker buildx build --platform linux/amd64,linux/arm64 -t tg-dl .
#   docker compose up -d --build          # 自动构建并启动
# ============================================================

# ---- 第一阶段：安装 Node.js 依赖 ----
FROM node:20-slim AS node-deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- 第二阶段：最终镜像 ----
FROM debian:bookworm-slim

LABEL maintainer="RDevils7"
LABEL description="TG-DL - Telegram File/Video Downloader (NAS Docker)"
LABEL version="1.0.0"

# ===== 安装基础依赖 =====
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Node.js 运行依赖
    curl ca-certificates gnupg \
    # tdl (Go 二进制) 运行依赖
    libssl3 libstdc++6 zlib1g \
    # 其他工具
    wget unzip tzdata \
    && rm -rf /var/lib/apt/lists/* \
    # 设置时区（可被容器环境变量覆盖）
    && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

# ===== 安装 Node.js 20.x =====
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && echo "Node.js: $(node --version) / npm: $(npm --version)"

# ===== 安装 tdl CLI (iyear/tdl) =====#
# 支持通过构建参数指定版本，默认 latest
# tdl 是 Go 写的，单二进制文件，支持 linux-amd64 和 linux-arm64
ARG TDL_VERSION=latest
ENV TDL_PATH=/usr/local/bin/tdl

# 根据目标架构自动选择下载链接
RUN ARCH=$(dpkg --print-architecture); \
    echo "Target architecture: ${ARCH}"; \
    if [ "$ARCH" = "amd64" ]; then TDL_ARCH="x64"; \
    elif [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then TDL_ARCH="arm64"; \
    else echo "Unsupported architecture: ${ARCH}" && exit 1; \
    fi; \
    echo "Installing tdl (${TDL_VERSION}) for ${TDL_ARCH}..."; \
    if [ "$TDL_VERSION" = "latest" ]; then \
        # 获取最新版本号
        TAG=$(curl -fsSL "https://api.github.com/repos/iyear/tdl/releases/latest" | grep '"tag_name"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/') || TAG="0.18.5"; \
        URL="https://github.com/iyear/tdl/releases/download/v${TAG}/tdl-linux-${TDL_ARCH}"; \
    else \
        URL="https://github.com/iyear/tdl/releases/download/v${TDL_VERSION}/tdl-linux-${TDL_ARCH}"; \
    fi; \
    echo "Download URL: ${URL}"; \
    wget -qO "${TDL_PATH}" "${URL}" || { \
        echo "GitHub download failed, trying mirror..."; \
        # 备用方案：使用 goproxy.cn 加速下载
        export GOPROXY=https://goproxy.cn,direct; \
        go install github.com/iyear/tdl/cmd/tdl@${TDL_VERSION} || true; \
    }; \
    chmod +x "${TDL_PATH}" 2>/dev/null; \
    ${TDL_PATH} version || echo "tdl binary installed at ${TDL_PATH}"

# ===== 复制应用代码 =====
WORKDIR /app

COPY --from=node-deps /app/node_modules ./node_modules
COPY server.js ./
COPY public/ ./public/

# 确保 data 目录存在
RUN mkdir -p data downloads /root/.tdl \
    && chmod -R 777 /root/.tdl downloads data

# ===== 环境变量 =====
ENV NODE_ENV=production
ENV PORT=3210
ENV TDL_PATH=/usr/local/bin/tdl
ENV DOWNLOAD_DIR=/app/downloads
ENV CONFIG_FILE=/app/data/config.json

# ===== 端口 & 健康检查 =====
EXPOSE 3210

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3210/',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" 

# ===== 启动 =====
CMD ["node", "server.js"]
