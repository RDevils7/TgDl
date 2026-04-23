# 🎬 TG-DL - Telegram 文件/视频下载工具

<p align="center">
  <strong>输入链接，即刻下载</strong> · 基于 tdl 的 Telegram 媒体文件下载方案
</p>

---

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 🔗 **链接解析** | 支持公开频道、群组、私有频道、单条消息等多种链接格式 |
| 📹 **视频下载** | 支持 MP4 视频，可选择画质（原始/高清/标清/流畅） |
| 📄 **文件下载** | 支持文档、压缩包、图片等各类文件类型 |
| 📊 **实时进度** | SSE (Server-Sent Events) 实时推送，显示速度/百分比/已下载大小 |
| 🖥️ **TTY 终端** | 内嵌终端输出区域，实时展示 tdl 引擎完整运行日志和下载过程 |
| 🔐 **Telegram 登录** | 支持验证码登录 + 扫码登录两种方式（需 [tdl](https://github.com/tyler1234/tdl)） |
| 🌐 **代理支持** | HTTP/HTTPS/SOCKS5 代理，支持用户名密码认证 |
| 📜 **历史记录** | 本地存储下载历史，方便回顾 |
| 🎨 **深色 UI** | 玻璃拟态风格 (Glassmorphism)，响应式设计 |

## 📸 截面预览

> （待补充截图）

## 🚀 快速开始

### 环境要求

- **Node.js** >= 16.0.0
- **[tdl](https://github.com/tyler1234/tdl)** — Telegram 下载 CLI 工具（用于登录和下载）
  - 下载后放到 `C:\tdl\tdl.exe`（默认路径），或通过环境变量 `TDL_PATH` 自定义

### 安装运行

```bash
# 1. 克隆仓库
git clone https://github.com/RDevils7/TgDl.git
cd TgDl

# 2. 安装依赖
npm install

# 3. 启动服务（默认端口 3210）
npm start

# 4. 浏览器访问
# http://localhost:3210
```

### 自定义配置

```bash
# 指定端口
PORT=8080 npm start

# 指定 tdl 路径
TDL_PATH="D:\tools\tdl.exe" npm start
```

## 📖 使用说明

### 1. 配置代理（如需要）

如果网络环境需要代理才能访问 Telegram：

1. 点击右上角 ⚙️ 设置按钮
2. 开启「启用代理」开关
3. 填写代理地址、端口、认证信息（可选）
4. 选择协议类型：HTTP / HTTPS / SOCKS5
5. 点击「测试」验证连通性，点击「保存」

### 2. 登录 Telegram（推荐）

> 未登录时只能解析公开频道内容。登录后可访问私有频道/群组。

**方式一：验证码登录**
1. 点击右上角「未登录」按钮
2. 输入手机号（带国家代码，如 `+8613800138000`）
3. 输入收到的验证码
4. 如开启两步验证，还需输入密码

**方式二：扫码登录**
1. 切换到「扫码登录」标签
2. 点击「获取二维码」
3. 用 Telegram App 扫描二维码

### 3. 解析 & 下载

```
1. 粘贴 Telegram 链接 → 点击「解析」
2. 选择画质（视频）或文件
3. 点击「开始下载」→ 实时查看进度（含 TTY 终端输出）
4. 下载完成 → 「保存到本地」
```

### ⌨️ 快捷键

| 按键 | 功能 |
|------|------|
| `Enter` | 在输入框按回车直接解析 |
| `Esc` | 重置所有状态，重新开始 |

## 🔗 支持的链接格式

| 格式 | 示例 | 说明 |
|------|------|------|
| 公开频道 + 消息ID | `t.me/cnn/12345` | 解析指定消息中的媒体文件 |
| 公开频道预览页 | `t.me/s/cnn` | 从公开预览页获取信息 |
| 私有频道 | `t.me/c/123456789/1` | 需要登录才能访问 |
| 仅频道名 | `t.me/cnn` | 获取最新消息 |

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express.js |
| 前端 | 原生 HTML5 / CSS3 / JavaScript (ES6+) |
| 实时通信 | SSE (Server-Sent Events) |
| 终端模拟 | TTY 内嵌输出（ANSI 码处理 + 关键词高亮） |
| Telegram 接口 | [tdl](https://github.com/tyler1234/tdl) CLI |
| 样式风格 | CSS Glassmorphism (玻璃拟态) |
| 二维码生成 | [qrcode.js](https://github.com/soldair/node-qrcode) |

## 📁 项目结构

```
tg-dl/
├── server.js              # Express 后端服务（API 路由 + 业务逻辑 + tdl 进程管理）
├── package.json           # 项目配置与依赖声明
├── public/
│   ├── index.html         # 主页面（SPA 单页应用结构）
│   ├── style.css          # 样式文件（深色玻璃拟态主题）
│   └── app.js             # 前端交互逻辑（SSE 进度 / TTY 输出 / UI 控制）
├── data/
│   └── config.json        # 运行时配置（代理设置 / 登录状态等）
├── downloads/             # 下载文件存储目录（自动创建）
└── README.md              # 本文件
```

## 📡 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/proxy` | 设置/更新代理配置 |
| `GET` | `/api/proxy` | 获取当前代理配置 |
| `POST` | `/api/login/code/start` | 发起验证码登录（发送手机号） |
| `POST` | `/api/login/code/submit` | 提交验证码 / 两步验证密码 |
| `POST` | `/api/login/qr` | 获取登录二维码 |
| `GET` | `/api/login/qr/stream` | 二维码登录状态 SSE 流 |
| `GET` | `/api/login/status` | 获取当前登录状态 |
| `POST` | `/api/login/cancel` | 取消正在进行的登录进程 |
| `DELETE` | `/api/logout` | 退出登录（清除 session） |
| `POST` | `/api/test-connection` | 测试代理连通性 |
| `POST` | `/api/parse` | 解析 Telegram 链接 |
| `POST` | `/api/download` | 开始下载任务 |
| `GET` | `/api/progress/:taskId` | 获取下载进度 (SSE) |
| `GET` | `/api/files/:taskId` | 获取任务文件列表 |
| `GET` | `/api/file/:taskId/:filename` | 下载指定文件 |
| `GET` | `/api/task/:taskId` | 获取任务详情 |

## ⚠️ 注意事项

1. **网络环境**：中国大陆等地区需要配置代理才能正常连接 Telegram
2. **tdl 依赖**：登录和部分下载功能依赖 [tdl](https://github.com/tyler1234/tdl) CLI 工具，使用前请确保已安装
3. **私有内容**：未登录时仅支持解析公开频道/群组的内容
4. **大文件下载**：超大文件可能需要较长时间，请保持页面打开
5. **仅供学习研究**：请尊重版权，支持正版

## 📄 License

MIT License - 仅供学习研究使用

---

<p align="center">
  <sub>Made with ❤️ by <a href="https://github.com/RDevils7">RDevils7</a></sub>
</p>
