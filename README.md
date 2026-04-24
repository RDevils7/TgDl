# TgDl — Telegram 文件下载工具

基于 [tdl](https://github.com/iyear/tdl) 的 Web 界面下载工具，支持通过浏览器下载 Telegram 频道/群组中的文件、视频和媒体内容。

## 功能特性

- **Web 图形界面** — 无需命令行操作，浏览器中完成全部操作
- **扫码登录 / 验证码登录** — 两种 Telegram 登录方式
- **代理支持** — HTTP / SOCKS5 代理，支持认证
- **实时进度** — SSE 实时推送下载进度、速度、ETA
- **批量下载** — 支持并发控制、文件过滤（包含/排除）
- **断点续传** — 默认开启，中断后可继续
- **下载设置** — 自定义画质、并发数、线程数、文件名模板等
- **终端输出** — 实时展示 tdl 原始终端日志

## 系统要求

| 环境 | 要求 |
|------|------|
| 操作系统 | Windows / Linux / macOS |
| Node.js | >= 18 |
| tdl CLI | v0.20.2（已内置） |

## 快速开始

### 1. 安装依赖

```bash
git clone https://github.com/RDevils7/TgDl.git
cd TgDl
npm install
```

### 2. 配置 tdl

Windows 用户需要将 `tdl.exe` 放到 `C:\tdl\tdl.exe`，或设置环境变量：

```bash
export TDL_PATH=/你的路径/tdl
```

### 3. 启动服务

```bash
npm start
```

服务启动后访问 **http://localhost:3210**

## 项目结构

```
tg-dl/
├── server.js       # 后端服务（Express）
├── package.json    # 依赖配置
├── tdl             # tdl CLI 二进制 (v0.20.2)
├── public/
│   ├── index.html  # 前端页面
│   ├── style.css   # 样式
│   └── app.js      # 前端逻辑
├── data/           # 配置存储
└── downloads/      # 下载文件存放目录
```

## 使用说明

### 登录

首次使用需要登录 Telegram 账号：

1. 打开 http://localhost:3210
2. 选择**扫码登录**或**验证码登录**
3. 扫码登录：用手机 Telegram 扫描页面二维码
4. 验证码登录：输入手机号 → 收到验证码 → 填入确认

> ⚠️ 国内网络需在设置中配置代理才能连接 Telegram

### 下载

1. 粘贴 Telegram 链接（支持以下格式）：
   - 公开频道：`https://t.me/频道名/消息ID`
   - 私有频道：`https://t.me/c/频道ID/消息ID`
   - 仅频道名：自动获取最新消息
2. 可选调整下载参数（画质、并发数、过滤规则等）
3. 点击「下载」，页面实时显示进度
4. 下载完成后可直接下载文件

### 代理设置

如果网络无法直连 Telegram，可在页面设置中配置代理：

| 字段 | 说明 |
|------|------|
| 协议 | HTTP 或 SOCKS5 |
| 地址 | 代理服务器地址 |
| 端口 | 代理端口 |
| 用户名 | 认证用户名（可选） |
| 密码 | 认证密码（可选） |

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/proxy` | 设置代理 |
| GET | `/api/proxy` | 获取当前代理配置 |
| POST | `/api/login/qr` | 启动扫码登录 |
| GET | `/api/login/qr/stream` | SSE 流式获取 QR 终端输出 |
| POST | `/api/login/code/start` | 开始验证码登录 |
| POST | `/api/login/code/submit` | 提交验证码 |
| GET | `/api/login/status` | 获取登录状态 |
| POST | `/api/login/cancel` | 取消登录 |
| DELETE | `/api/logout` | 退出登录 |
| POST | `/api/test-connection` | 测试连接 |
| POST | `/api/parse` | 解析 Telegram 链接 |
| POST | `/api/download` | 创建下载任务 |
| GET | `/api/progress/:taskId` | SSE 实时进度 |
| GET | `/api/files/:taskId` | 获取已下载文件列表 |
| GET | `/api/file/:taskId/:filename` | 下载单个文件 |

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JavaScript
- **引擎**: [tdl](https://github.com/iyear/tdl) v0.20.2（Go 语言 Telegram DL 客户端）
- **终端模拟**: node-pty（用于 QR 扫码登录的 TTY 渲染）

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3210` | 服务监听端口 |
| `TDL_PATH` | 自动检测 | tdl 可执行文件路径 |
| `DOWNLOAD_DIR` | `./downloads` | 文件下载目录 |
| `CONFIG_FILE` | `./data/config.json` | 配置文件路径 |

## 开源协议

[AGPL-3.0](LICENSE)
