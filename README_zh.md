# TgDl — Telegram 文件下载工具

<p>
  <a href="https://github.com/RDevils7/TgDl"><img src="https://img.shields.io/badge/version-v2.2-blue?style=flat-square" alt="version"></a>
  <a href="https://github.com/RDevils7/TgDl/pkgs/container/tgdl"><img src="https://img.shields.io/badge/ghcr-tgdl-00a6ed?style=flat-square" alt="ghcr"></a>
  <img src="https://img.shields.io/badge/license-AGPL--3.0-green?style=flat-square" alt="license">
  <a href="#%E5%8A%9F%E8%83%BD%E7%89%B9%E6%80%A7"><img src="https://img.shields.io/badge/-Bot轮询-orange?style=flat-square" alt="bot"></a>
  <a href="#%E5%8A%9F%E8%83%BD%E7%89%B9%E6%80%A7"><img src="https://img.shields.io/badge/-移动端适配-lightgrey?style=flat-square" alt="mobile"></a>
</p>

基于 [tdl](https://github.com/iyear/tdl) 的 **Web 可视化界面**，让你在浏览器中轻松下载 Telegram 频道/群组中的文件、视频和媒体内容 —— 无需敲一行命令。

> 本项目仅提供可视化操作界面，核心下载能力由 [tdl](https://github.com/iyear/tdl) 驱动。如需使用命令行原版，欢迎访问 [tdl 仓库](https://github.com/iyear/tdl) 了解更多。

---

## ✨ 功能特性

| 特性 | 说明 |
|------|------|
| 🤖 **Bot 轮询下载** | 给 Bot 发送 Telegram 链接即可自动下载，全生命周期通知（开始/完成/失败） |
| 🖥️ Web 图形界面 | 全部操作在浏览器完成，无需命令行 |
| 📱 移动端完美适配 | 4 级响应式断点，手机/平板/横屏均可流畅使用 |
| 🔐 双登录方式 | 支持扫码登录和手机验证码登录 |
| 📡 代理支持 | HTTP / SOCKS5 代理，支持用户认证，一键测试连通性 |
| 📊 实时进度 | SSE 实时推送下载进度、速度、剩余时间 |
| 💻 终端输出 | 实时展示 tdl 原始终端日志（TTY 渲染） |
| ⚡ 批量下载 | 并发控制、文件过滤（包含/排除规则） |
| 🔄 断点续传 | 默认开启，网络中断后可继续下载 |
| ⚙️ 丰富设置 | 自定义画质、并发数、线程数、文件名模板等 |
| 📜 下载历史 | 本地记录历史任务，方便重复下载 |
| 👤 登录状态展示 | 头部实时显示账号状态与用户信息 |

## 🚀 快速开始

### 方式一：直接运行

```bash
git clone https://github.com/RDevils7/TgDl.git
cd TgDl
npm install
npm start
```

启动后访问 **http://localhost:3210**

### 方式二：Docker 部署（推荐）

镜像托管在 [GitHub Container Registry (GHCR)](https://github.com/RDevils7/TgDl/pkgs/container/tgdl)，支持 `linux/amd64` 和 `linux/arm64` 多架构。

#### docker-compose 部署（推荐）

创建 `docker-compose.yml`：

```yaml
services:
  tg-dl:
    image: ghcr.io/rdevils7/tgdl:latest
    container_name: tg-dl
    restart: unless-stopped
    ports:
      - "3210:3210"
    volumes:
      # tdl 登录信息、session 等持久化
      - ./tdl-data:/root/.tdl
      # TgDl 应用配置文件（代理设置、下载默认参数等）
      - ./app-data:/app/data
      # 文件下载目录
      - ./downloads:/app/downloads
    environment:
      - TZ=Asia/Shanghai
      # 如需代理，取消注释并修改：
      # - PROXY_HOST=your-proxy-host
      # - PROXY_PORT=7890
```

启动：

```bash
docker compose up -d
```

访问 **http://localhost:3210**

#### 直接 docker run

```bash
docker run -d \
  --name tg-dl \
  --restart unless-stopped \
  -p 3210:3210 \
  -v $(pwd)/tdl-data:/root/.tdl \
  -v $(pwd)/app-data:/app/data \
  -v $(pwd)/downloads:/app/downloads \
  -e TZ=Asia/Shanghai \
  ghcr.io/rdevils7/tgdl:latest
```

#### 持久化目录说明

| 容器路径 | 挂载到 | 说明 |
|----------|--------|------|
| `/root/.tdl` | `./tdl-data` | tdl 配置目录，Telegram 登录信息和 session 保存在这里 |
| `/app/data` | `./app-data` | TgDl 应用配置文件（config.json），包含代理设置、下载默认参数等 |
| `/app/downloads` | `./downloads` | 文件下载存放目录 |

> ⚠️ 以上三个目录必须挂载为 volume，否则容器重建后数据会丢失。

## 📂 项目结构

```
tg-dl/
├── server.js       # 后端服务（Express）
├── package.json    # 依赖配置
├── Dockerfile       # Docker 镜像定义（多架构构建）
├── tdl             # tdl CLI 二进制
├── public/
│   ├── index.html  # 前端页面
│   ├── style.css   # 样式（含完整移动端响应式适配）
│   └── app.js      # 前端逻辑
├── data/           # 应用配置存储（运行时生成）
└── downloads/      # 下载文件存放目录（运行时生成）
```

## 📖 使用指南

### 登录

首次使用需要登录 Telegram 账号：

1. 打开 http://localhost:3210
2. 选择**扫码登录**或**验证码登录**
3. 扫码登录：用手机 Telegram 扫描页面二维码
4. 验证码登录：输入手机号 → 收到验证码 → 填入确认

> ⚠️ 国内网络需在设置中配置代理才能连接 Telegram。Docker 部署时可在 Web 界面的「设置 → 代理」中配置。

### 下载

1. 粘贴 Telegram 链接（支持以下格式）：
   - 公开频道：`https://t.me/频道名/消息ID`
   - 私有频道：`https://t.me/c/频道ID/消息ID`
   - 仅频道名：自动获取最新消息
2. 页面自动解析链接，显示消息预览和可选文件列表
3. 可选调整下载参数（画质、并发数、过滤规则、文件名模板等）
4. 点击「下载」，页面通过 SSE 实时显示进度和速度
5. 下载完成后可直接点击文件名下载

### 代理设置

如果网络无法直连 Telegram，可在页面设置面板中配置代理：

| 字段 | 说明 |
|------|------|
| 协议 | HTTP 或 SOCKS5 |
| 地址 | 代理服务器地址 |
| 端口 | 代理端口 |
| 用户名 | 认证用户名（可选） |
| 密码 | 认证密码（可选） |

## 🔗 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bot` | 获取 Bot 配置 |
| POST | `/api/bot` | 保存 Bot 配置（Token / Chat ID） |
| POST | `/api/bot/test` | 发送测试消息验证 Bot 连接 |
| GET | `/api/bot/poll/status` | 查询轮询运行状态 |
| POST | `/api/bot/poll/start` | 启动 Bot 轮询监听 |
| POST | `/api/bot/poll/stop` | 停止 Bot 轮询监听 |
| GET | `/api/download-settings` | 获取下载默认设置 |
| POST | `/api/download-settings` | 保存下载默认设置 |
| POST | `/api/proxy` | 设置代理 |
| GET | `/api/proxy` | 获取当前代理配置 |
| POST | `/api/login/qr` | 启动扫码登录 |
| GET | `/api/login/qr/stream` | SSE 流式获取 QR 终端输出 |
| POST | `/api/login/code/start` | 开始验证码登录 |
| POST | `/api/login/code/submit` | 提交验证码 |
| POST | `/api/login/code/2fa` | 提交两步验证密码 |
| GET | `/api/login/status` | 获取登录状态 |
| GET | `/api/login/me` | 获取当前登录账号信息 |
| POST | `/api/login/cancel` | 取消登录流程 |
| DELETE | `/api/logout` | 退出登录 |
| POST | `/api/test-connection` | 测试 tdl 连通性 |
| POST | `/api/parse` | 解析 Telegram 链接 |
| POST | `/api/download` | 创建下载任务 |
| GET | `/api/progress/:taskId` | SSE 实时进度推送 |
| GET | `/api/files/:taskId` | 获取已下载文件列表 |
| GET | `/api/file/:taskId/:filename` | 下载单个文件 |
| GET | `/api/task/:taskId` | 获取任务详情 |

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 前端 | 原生 HTML/CSS/JavaScript（无框架依赖） |
| 引擎 | [tdl](https://github.com/iyear/tdl)（Go 语言 Telegram DL 客户端） |
| 终端模拟 | node-pty（QR 扫码登录的 TTY 渲染） |
| 实时通信 | Server-Sent Events (SSE) |

## 🔧 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3210` | 服务监听端口 |
| `TDL_PATH` | `/usr/local/bin/tdl`（Linux）/ `C:\tdl\tdl.exe`（Windows） | tdl 可执行文件路径 |
| `DOWNLOAD_DIR` | `/app/downloads` | 文件下载目录 |
| `CONFIG_FILE` | `/app/data/config.json` | 配置文件路径 |

## 📋 版本历史

### v2.2 — 当前版本

- 🤖 **Telegram Bot 轮询下载**
  - 给 Bot 发消息即可自动下载，无需打开 Web 界面
  - 自动识别 `t.me` 链接并触发下载
  - 全生命周期通知：🚀 下载开始（链接/来源/参数）、🎉 下载完成（文件列表/大小/耗时）、❌ 下载失败（原因/建议）
  - 轮询状态实时查看（活跃状态 / 消息数 / 错误数）
  - 消息发送自动重试（3 次重试 + 指数退避，应对代理 TLS 不稳定）
- 🔧 **稳定性提升**
  - 修复 `node-fetch` + HttpsProxyAgent 长轮询 TLS 不稳定问题，改用短轮询模式
  - Bot 消息发送内置重试机制，大幅提高通知到达率

### v2.1

- 📱 **全面移动端适配**
  - 4 级响应式断点（≤480px / 481~600px / 601~768px / 横屏模式）
  - 头部紧凑布局，logo 与操作按钮同行
  - 输入框防 iOS 自动缩放，按钮最小触控高度 48px
  - 设置侧栏移动端全屏覆盖，登录弹窗全屏居中
  - iPhone X+ 安全区域适配（底部刘海/手势条）
  - 禁止双击缩放，虚拟键盘聚焦自动滚动
- 👤 **增强登录状态展示**
  - 新增 `/api/login/me` 接口获取账号详情
  - 头部按钮显示用户名或脱敏手机号
  - 弹窗内展示详细账号信息卡片
- 🎨 UI/UX 优化
  - 页脚增加项目来源说明与 tdl 仓库链接
  - 修复 CSS 残留语法错误
  - 整体视觉细节打磨

### v2.0

- 初始版本发布
- Web 图形界面 + tdl 引擎集成
- 扫码登录 / 验证码登录双模式
- SSE 实时进度推送
- 代理支持与连通性测试
- Docker 多架构镜像（amd64 + arm64），托管至 GHCR

---

## 📄 开源协议

[AGPL-3.0](LICENSE)

---

<p align="center">
  Built with ❤️ based on <a href="https://github.com/iyear/tdl">tdl</a> · 
  <a href="https://github.com/RDevils7/TgDl/issues">反馈问题</a> · 
  <a href="https://github.com/RDevils7/TgDl">GitHub</a>
</p>
