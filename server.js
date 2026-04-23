const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

// node-pty：用于 TTY 伪终端（tdl QR 登录需要真实终端环境）
let pty = null;
try {
    pty = require('node-pty');
    console.log('[pty] node-pty loaded successfully');
} catch (e) {
    console.warn('[pty] node-pty not available, QR login will use fallback mode:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3210;

// ==================== 配置 ====================

// tdl 路径（Docker 环境下通过 TDL_PATH 环境变量指定）
const TDL_PATH = process.env.TDL_PATH || (process.platform === 'win32' ? 'C:\\tdl\\tdl.exe' : '/usr/local/bin/tdl');

// 下载目录（支持环境变量覆盖）
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, 'downloads');

// 配置持久化文件（支持环境变量覆盖）
const CONFIG_FILE = process.env.CONFIG_FILE || path.join(__dirname, 'data', 'config.json');

// 中间件
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 确保目录存在
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 存储任务状态
const tasks = new Map();

// ==================== 配置持久化 ====================

/**
 * 默认配置
 */
const defaultConfig = {
    proxy: {
        enabled: false,
        protocol: 'http',
        host: '',
        port: '',
        username: '',
        password: ''
    },
    loginStatus: {
        loggedIn: false,
        checkedAt: null,
        info: ''
    },
    download: {
        quality: '',           // 空 = 原始
        limit: 2,
        threads: 4,
        include: '',
        exclude: '',
        desc: false,
        skipSame: true,
        group: false,
        rewriteExt: false,
        template: '',
        delay: '',
        reconnect: ''
    }
};

/**
 * 加载配置（从文件或使用默认值）
 */
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
            const loaded = JSON.parse(raw);
            // 合并默认值，防止字段缺失
            return {
                ...defaultConfig,
                ...loaded,
                proxy: { ...defaultConfig.proxy, ...(loaded.proxy || {}) },
                loginStatus: { ...defaultConfig.loginStatus, ...(loaded.loginStatus || {}) },
                download: { ...defaultConfig.download, ...(loaded.download || {}) }
            };
        }
    } catch (e) {
        console.error('[config] 加载失败:', e.message);
    }
    return { ...defaultConfig };
}

/**
 * 保存配置到文件
 */
function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (e) {
        console.error('[config] 保存失败:', e.message);
    }
}

// 全局配置（启动时加载）
let appConfig = loadConfig();
console.log(`[config] 配置已加载 (代理${appConfig.proxy.enabled ? '已启用' : '未启用'})`);

// ==================== 代理配置（兼容持久化）====================

/**
 * 获取当前代理配置
 */
function getProxyConfig() {
    return appConfig.proxy;
}

function setProxyConfig(config) {
    appConfig.proxy = {
        enabled: config.enabled === true || config.enabled === 'true',
        protocol: (config.protocol || 'http').toLowerCase(),
        host: (config.host || '').trim(),
        port: String(config.port || '').trim(),
        username: (config.username || '').trim(),
        password: (config.password || '').trim()
    };
    // 自动保存
    saveConfig(appConfig);
}

function getProxyArg() {
    const cfg = getProxyConfig();
    if (!cfg.enabled) return null;
    if (!cfg.host || !cfg.port) return null;

    let auth = '';
    if (cfg.username && cfg.password) {
        auth = `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@`;
    } else if (cfg.username) {
        auth = `${encodeURIComponent(cfg.username)}@`;
    }

    const proto = cfg.protocol === 'socks5' ? 'socks5' : 'http';
    return `${proto}://${auth}${cfg.host}:${cfg.port}`;
}

// ==================== 下载默认配置 ====================

function getDlConfig() {
    return appConfig.download || { ...defaultConfig.download };
}

app.get('/api/download-settings', (req, res) => {
    res.json(getDlConfig());
});

app.post('/api/download-settings', (req, res) => {
    const dl = req.body;
    appConfig.download = {
        quality: typeof dl.quality === 'string' ? dl.quality : '',
        limit: parseInt(dl.limit) || 2,
        threads: parseInt(dl.threads) || 4,
        include: (dl.include || '').trim(),
        exclude: (dl.exclude || '').trim(),
        desc: !!dl.desc,
        skipSame: dl.skipSame !== false,
        group: !!dl.group,
        rewriteExt: !!dl.rewriteExt,
        template: (dl.template || '').trim(),
        delay: (dl.delay || '').trim(),
        reconnect: (dl.reconnect || '').trim()
    };
    saveConfig(appConfig);
    console.log(`[download-settings] 已保存全局默认配置`);
    res.json({ success: true });
});

/**
 * 解析 Telegram 链接
 */
function parseTelegramUrl(url) {
    // 私有频道链接必须优先匹配（t.me/c/数字ID/消息ID）
    let match = url.match(/t\.me\/c\/(\d+)\/(\d+)/);
    if (match) return { channelId: match[1], postId: parseInt(match[2]), type: 'private' };

    // 公开频道链接（t.me/频道名/消息ID）
    match = url.match(/t\.me\/([a-zA-Z_0-9]+)\/(\d+)/);
    if (match) return { channel: match[1], postId: parseInt(match[2]), type: 'public' };

    // 仅频道名（无消息ID）
    match = url.match(/t\.me\/([a-zA-Z_0-9]+)/);
    if (match && !url.includes('/c/')) return { channel: match[1], type: 'public_latest' };

    return null;
}


// ==================== API 路由 ====================

/**
 * POST /api/proxy - 设置代理
 */
app.post('/api/proxy', (req, res) => {
    const { enabled, protocol, host, port, username, password } = req.body;
    setProxyConfig({ enabled, protocol, host, port, username, password });
    
    const cfg = getProxyConfig();
    const usingProxy = cfg.enabled && cfg.host && cfg.port;
    res.json({
        success: true,
        message: usingProxy ? `已设置代理 ${protocol}://${host}:${port}` : '直连模式'
    });
});

app.get('/api/proxy', (req, res) => {
    const cfg = getProxyConfig();
    res.json({
        enabled: cfg.enabled,
        protocol: cfg.protocol,
        host: cfg.host,
        port: cfg.port,
        username: cfg.username ? '***' : '',
        password: !!cfg.password
    });
});

// ==================== 登录 API ====================

// 当前登录进程
let loginProcess = null;
let loginPty = null; // 保存 pty 实例（用于流式输出）
// 当前登录交互状态（用于 code 模式）
let loginState = null; // { phase: 'phone'|'code'|'2fa', phone: '', ... }
// QR 登录的 TTY 输出缓冲
let qrOutputBuffer = '';
// 当前 login ID（用于 SSE 关联）
let currentLoginId = null;
// 登录成功标志（在 onData 中检测到成功关键词时立即设置）
let qrLoginSuccess = false;

/**
 * POST /api/login/qr - 启动扫码登录（使用 node-pty 伪终端）
 * tdl 的 QR 模式依赖 TTY 终端渲染 Unicode 二维码图形，必须用 pty 而非普通 spawn
 */
/**
 * killStaleTdlProcesses - 清理残留的 tdl 进程，避免数据库锁冲突
 */
function killStaleTdlProcesses() {
    try {
        // Windows: 使用 taskkill 结束 tdl.exe 进程
        exec('taskkill /F /IM tdl.exe 2>nul', (err) => {
            if (!err) console.log('[login-qr] Killed stale tdl processes');
        });
    } catch(e) { /* ignore */ }
}

/**
 * POST /api/login/qr - 启动扫码登录（快速返回，通过 SSE 流式推送 TTY 输出）
 */
app.post('/api/login/qr', async (req, res) => {
    if (loginProcess) { return res.json({ success: false, error: '已有登录进程在进行中，请先取消或等待完成' }); }

    // 启动前清理可能残留的 tdl 进程
    killStaleTdlProcesses();
    await new Promise(r => setTimeout(r, 1000));

    currentLoginId = uuidv4();
    const args = ['login', '--type', 'qr'];
    // 添加 NTP 时间同步，避免 AUTH_TOKEN_EXPIRED（token 过期常因系统时间偏差导致）
    args.push('--ntp', 'ntp.aliyun.com');
    const proxyAddr = getProxyArg();
    if (proxyAddr) args.push('--proxy', proxyAddr);
    console.log('[login-qr] Starting: ' + TDL_PATH + ' ' + args.join(' '));
    
    qrOutputBuffer = '';
    let loginSuccess = false;

    if (pty) {
        try {
            loginPty = pty.spawn(TDL_PATH, args, {
                name: 'xterm-256color', cols: 80, rows: 24,
                cwd: process.env.TEMP, env: Object.assign({}, process.env)
            });
            
            loginProcess = loginPty;
            qrLoginSuccess = false; // 重置成功标志

            loginPty.onData(data => {
                qrOutputBuffer += data;
                console.log('[login-qr] TTY +' + data.length + 'B total=' + qrOutputBuffer.length);
                
                // 检测登录成功的多种可能输出（tdl 不同版本的提示不同）
                if (/login.*success|authorized|已登录|logged.*in|Login successful/i.test(data)) {
                    loginSuccess = true;
                    qrLoginSuccess = true; // 立即设置全局标志
                    console.log('[login-qr] Login success detected!');
                }
                // 扫码确认后 tdl 可能输出 "Waiting for result..." 然后直接退出码0
                if (/Waiting for result|waiting for result|scan.*confirmed|QR.*confirmed|扫码成功/i.test(data)) {
                    console.log('[login-qr] Scan confirmed detected, login likely to succeed');
                }
                if (/database is used by another process/i.test(data)) {
                    console.error('[login-qr] DB locked error detected');
                }
                // 打印原始数据用于调试
                const cleanData = data.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r\n?/g, '\\n').trim();
                if (cleanData) console.log('[login-qr] TTY text:', cleanData.slice(0, 200));
            });
            
            loginPty.onExit(({ exitCode }) => {
                console.log('[login-qr] PTY exited: ' + exitCode + ', loginSuccess=' + loginSuccess + ', qrLoginSuccess=' + qrLoginSuccess);
                const finalSuccess = (exitCode === 0 || loginSuccess || qrLoginSuccess);
                if (finalSuccess && !appConfig.loginStatus?.loggedIn) {
                    appConfig.loginStatus = { loggedIn: true, checkedAt: new Date().toISOString(), info: '已通过扫码登录' };
                    saveConfig(appConfig);
                    console.log('[login-qr] Config updated: loggedIn=true');
                }
                loginProcess = null; loginPty = null; loginState = null;
            });

            // 立即返回！前端通过 SSE 获取实时输出
            return res.json({ 
                success: true, 
                loginId: currentLoginId,
                streaming: true,
                status: 'connecting',
                hint: '正在连接 Telegram 服务器，终端即将显示...'
            });

        } catch (e) { 
            console.error('[login-qr] PTY spawn failed:', e.message); 
            loginProcess = null;
            return res.json({ success: false, error: 'PTY 启动失败: ' + e.message }); 
        }
    } else {
        return res.json({ 
            success: false, 
            error: 'node-pty 未安装，QR 模式不可用。请使用验证码登录。',
            noPty: true 
        });
    }
});

/**
 * GET /api/login/qr/stream - SSE 流式推送 TTY 输出
 */
app.get('/api/login/qr/stream', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    console.log('[stream] Client connected');

    // 先推送已有缓冲数据
    if (qrOutputBuffer && qrOutputBuffer.length > 0) {
        const cleaned = stripAnsi(qrOutputBuffer).slice(0, 5000);
        res.write('data: ' + JSON.stringify({ type: 'output', text: cleaned, full: true }) + '\n\n');
    }

    let lastSentLength = qrOutputBuffer ? qrOutputBuffer.length : 0;
    
    const interval = setInterval(() => {
        try {
            if (!loginPty) {
                // 进程结束 —— 使用多重判断确定是否登录成功
                const finalOutput = stripAnsi(qrOutputBuffer || '').slice(0, 5000);
                const loggedIn = !!(qrLoginSuccess || appConfig.loginStatus?.loggedIn);
                console.log('[stream] Sending exit: loggedIn=' +loggedIn + ' (qrLoginSuccess='+qrLoginSuccess+', configLoggedIn='+(appConfig.loginStatus?.loggedIn)+')');
                
                // 如果 exitCode 为 0 但还没标记成功，再检查输出中是否包含成功关键词
                if (!loggedIn && finalOutput) {
                    const successPatterns = /login.*success|authorized|已登录|logged.*in|Login successful/i;
                    if (successPatterns.test(finalOutput)) {
                        qrLoginSuccess = true;
                        appConfig.loginStatus = { loggedIn: true, checkedAt: new Date().toISOString(), info: '已通过扫码登录' };
                        saveConfig(appConfig);
                        console.log('[login-qr] Post-exit check found success pattern, updated config');
                    }
                }

                res.write('data: ' + JSON.stringify({
                    type: 'exit',
                    output: finalOutput,
                    loggedIn: !!(qrLoginSuccess || appConfig.loginStatus?.loggedIn)
                }) + '\n\n');
                res.end();
                clearInterval(interval);
                return;
            }

            const currentLen = qrOutputBuffer ? qrOutputBuffer.length : 0;
            if (currentLen > lastSentLength) {
                const newText = stripAnsi(qrOutputBuffer.slice(lastSentLength));
                lastSentLength = currentLen;
                res.write('data: ' + JSON.stringify({ type: 'output', text: newText }) + '\n\n');
            } else {
                res.write(': heartbeat\n\n');
            }
        } catch(e) {
            console.error('[stream] Send error:', e.message);
            clearInterval(interval);
            try { res.end(); } catch(_) {}
        }
    }, 300);

    req.on('close', () => {
        console.log('[stream] Client disconnected');
        clearInterval(interval);
    });
});

/**
 * stripAnsi - 清理 ANSI 转义序列，提取纯文本含 Unicode 字符
 */
function stripAnsi(str) {
    return str
        .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
        .replace(/\x1b\[\?[0-9;]*[A-Za-z]/g, '')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .replace(/\x1b[(\)][AB0-9]/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

/**
 * POST /api/login/code/start - 开始验证码登录（发送手机号）
 */
app.post('/api/login/code/start', async (req, res) => {
    if (loginProcess) {
        return res.json({ success: false, error: '已有登录进程在进行中' });
    }

    // 启动前清理可能残留的 tdl 进程
    killStaleTdlProcesses();
    await new Promise(r => setTimeout(r, 1000));

    const { phone } = req.body;
    if (!phone || !/^\+?\d{7,15}$/.test(phone.replace(/\s/g, ''))) {
        return res.json({ success: false, error: '请输入有效的手机号（含国家代码，如 +8613800138000）' });
    }

    const args = ['login', '--type', 'code'];
    // 添加 NTP 时间同步
    args.push('--ntp', 'ntp.aliyun.com');

    const proxyAddr = getProxyArg();
    if (proxyAddr) {
        args.push('--proxy', proxyAddr);
    }

    console.log(`[login-code] Starting with phone: ${phone}`);

    loginProcess = spawn(TDL_PATH, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
    });

    let fullOutput = '';
    let loginSuccess = false;
    let waitingForInput = false;
    let currentPrompt = '';

    loginState = {
        phase: 'phone',
        phone: phone,
        sentCode: false
    };

    const handleData = (data) => {
        const text = data.toString();
        fullOutput += text;
        console.log(`[login-code]`, text.replace(/\r?\n/g, '|'));

        // 检测各种提示
        const lowerText = text.toLowerCase();

        if (/phone.?number|电话|手机号|please enter phone/i.test(text)) {
            currentPrompt = 'phone';
            waitingForInput = true;
        } else if (/code|验证码|verification/i.test(text) && /sent|send|发送/i.test(text)) {
            currentPrompt = 'code';
            waitingForInput = true;
            loginState.phase = 'code';
            loginState.sentCode = true;
        } else if (/password|two-factor|2fa|两步验证/i.test(text)) {
            currentPrompt = '2fa';
            waitingForInput = true;
            loginState.phase = '2fa';
        } else if (/login.*success|authorized|已登录|logged.?in/i.test(text)) {
            loginSuccess = true;
        } else if (/error|invalid|incorrect|wrong|fail/i.test(text)) {
            console.warn('[login-code] Error in output:', text.trim());
        }

        // 通用提示：如果输出包含 ":" 或 "?" 结尾的行，可能在等待输入
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
            const trimmed = line.trim();
            if (/[?：:]$/.test(trimmed) || /enter|input|请输入/i.test(trimmed)) {
                waitingForInput = true;
            }
        }
    };

    loginProcess.stdout.on('data', handleData);
    loginProcess.stderr.on('data', handleData);

    loginProcess.on('close', (code) => {
        console.log(`[login-code] Exited with code: ${code}`);
        loginProcess = null;

        if (code === 0 || loginSuccess) {
            appConfig.loginStatus = { loggedIn: true, checkedAt: new Date().toISOString(), info: `已通过验证码登录 (${phone})` };
            saveConfig(appConfig);
        }
        loginState = null;
    });

    loginProcess.on('error', (err) => {
        console.error('[login-code] Error:', err.message);
        loginProcess = null;
        loginState = null;
    });

    // 等待进程启动并输出初始提示
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 发送手机号
    if (loginProcess) {
        try {
            loginProcess.stdin.write(phone + '\n');
            console.log(`[login-code] Sent phone: ${phone}`);

            // 等待响应（验证码发送确认）
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (e) {
            console.error('[login-code] Failed to write phone:', e.message);
        }
    }

    res.json({
        success: true,
        phase: loginState?.phase || 'code',
        sentCode: loginState?.sentCode || false,
        hint: loginState?.sentCode ?
            `验证码已发送到 ${phone}，请输入收到的验证码` :
            '正在发送验证码...',
        outputPreview: fullOutput.slice(0, 300)
    });
});

/**
 * POST /api/login/code/submit - 提交验证码或密码
 */
app.post('/api/login/code/submit', async (req, res) => {
    if (!loginProcess) {
        return res.json({ success: false, error: '没有进行中的登录进程，请先开始登录' });
    }

    const { code, type } = req.body;
    const submitType = type || loginState?.phase || 'code';

    console.log('[login-code] Submitting ' + submitType + ': ' + (code ? '***' : '(empty)'));

    try {
        loginProcess.stdin.write(code + '\n');
        await new Promise(resolve => setTimeout(resolve, 4000));

        if (submitType === 'code') {
            loginState.phase = 'verifying';
        }

        res.json({
            success: true,
            phase: loginState?.phase || 'done',
            hint: '验证码已提交，正在验证...'
        });
    } catch (e) {
        return res.json({ success: false, error: '写入失败: ' + e.message });
    }
});

/**

/**
 * GET /api/login/status - 获取登录状态（增强版：实时检测 tdl session）
 */
app.get('/api/login/status', async (req, res) => {
    let isProcessing = loginProcess !== null;

    if (!appConfig.loginStatus?.loggedIn && !isProcessing) {
        try {
            const whoamiResult = await new Promise((resolve) => {
                const proxyAddr = getProxyArg();
                const args = ['whoami'];
                if (proxyAddr) args.push('--proxy', proxyAddr);
                const child = spawn(TDL_PATH, args, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true,
                    timeout: 15000
                });
                let output = '';
                child.stdout.on('data', function(d) { output += d.toString(); });
                child.stderr.on('data', function(d) { output += d.toString(); });
                child.on('close', function(code) { resolve({ code: code, output: output }); });
                child.on('error', function(e) { resolve({ code: -1, output: e.message }); });
                setTimeout(function() { child.kill(); resolve({ code: -2, output: 'timeout' }); }, 15000);
            });

            console.log('[login-status] whoami result:', JSON.stringify(whoamiResult).slice(0, 300));
            
            // 如果 whoami 成功返回用户信息，说明 session 有效
            if (whoamiResult.code === 0 && whoamiResult.output.trim() && !/error|not logged|unauthorized|AUTH/i.test(whoamiResult.output)) {
                appConfig.loginStatus = { 
                    loggedIn: true, 
                    checkedAt: new Date().toISOString(), 
                    info: '已通过扫码登录 (' + whoamiResult.output.trim().slice(0, 50) + ')' 
                };
                saveConfig(appConfig);
                console.log('[login-status] Found valid session via whoami!');
            }
        } catch(e) {
            console.warn('[login-status] whoami check failed:', e.message);
        }
    }

    res.json({
        ...appConfig.loginStatus,
        processing: isProcessing
    });
});

/**
 * POST /api/login/cancel - 取消登录
 */
app.post('/api/login/cancel', (req, res) => {
    if (loginProcess) {
        loginProcess.kill();
        loginProcess = null;
        res.json({ success: true, message: '已取消' });
    } else {
        res.json({ success: true, message: '没有进行中的登录' });
    }
});

/**
 * DELETE /api/logout - 退出登录（删除 session）
 * 注意：这会删除 tdl 的 session 文件
 */
app.delete('/api/logout', (req, res) => {
    // tdl 的 session 存储在默认路径 ~/.tdl/data/
    // 我们不直接删除文件，只标记为未登录
    appConfig.loginStatus = { loggedIn: false, checkedAt: null, info: '' };
    saveConfig(appConfig);

    // 尝试调用 tdl 删除 session（可选）
    res.json({ success: true, message: '已退出登录标记。重启服务后生效或手动删除 tdl session 目录。' });
});

/**
 * POST /api/test-connection - 测试连接
 */
app.post('/api/test-connection', async (req, res) => {
    const startTime = Date.now();
    try {
        // 用 tdl version 来检测是否可用（同时测试网络）
        await new Promise((resolve, reject) => {
            const args = ['version'];
            const proxyAddr = getProxyArg();
            if (proxyAddr) args.push('--proxy', proxyAddr);

            const child = spawn(TDL_PATH, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 15000
            });

            let output = '';
            child.stdout.on('data', d => output += d.toString());
            child.stderr.on('data', d => output += d.toString());

            child.on('close', (code) => {
                const elapsed = Date.now() - startTime;
                if (code === 0) {
                    resolve({ connected: true, latency: elapsed, info: output.trim() });
                } else {
                    reject(new Error(`退出码 ${code}: ${output.slice(0, 200)}`));
                }
            });

            child.on('error', reject);
            setTimeout(() => { child.kill(); reject(new Error('超时')); }, 15000);
        });

        res.json({ success: true, connected: true, message: '✅ 连接正常，tdl 可用' });

    } catch (error) {
        const elapsed = Date.now() - startTime;
        let suggestion = error.message.includes('ENOENT') 
            ? 'tdl 未找到，请确认 C:\\tdl\\tdl.exe 存在'
            : error.message.includes('ECONNREFUSED') || error.message.includes('timeout')
                ? '连接超时或被拒绝，请检查代理设置'
                : error.message.includes('401') || error.message.includes('Unauthorized')
                    ? '代理认证失败'
                    : error.message;

        res.json({
            success: true,
            connected: false,
            error: true,
            message: `❌ ${error.message}`,
            suggestion
        });
    }
});

/**
 * POST /api/parse - 解析链接
 */
app.post('/api/parse', (req, res) => {
    const { url } = req.body;

    if (!url) return res.status(400).json({ error: '请提供链接' });

    const parsed = parseTelegramUrl(url);
    if (!parsed) return res.status(400).json({ error: '无法识别的链接格式' });

    res.json({
        success: true,
        parsed,
        data: {
            files: null,
            useTdl: true
        },
        url: url
    });
});

// ==================== 下载任务 ====================

/**
 * POST /api/download - 启动 tdl 下载任务
 */
app.post('/api/download', async (req, res) => {
    const { 
        urls, quality, taskId: existingId,
        limit, threads, include, exclude,
        desc, skipSame, group, rewriteExt,
        template, delay, reconnect
    } = req.body;

    const id = existingId || uuidv4();
    const taskDir = path.join(DOWNLOAD_DIR, id);
    if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });

    // 收集所有下载选项
    const downloadOptions = {
        quality: quality || 'source',
        limit: parseInt(limit) || 2,
        threads: parseInt(threads) || 4,
        include: include || '',
        exclude: exclude || '',
        desc: !!desc,
        skipSame: skipSame !== false,   // 默认开启
        group: !!group,
        rewriteExt: !!rewriteExt,
        template: template || '',
        delay: delay || '',
        reconnect: reconnect || ''
    };

    // 初始化任务
    const task = {
        id,
        status: 'preparing',
        progress: 0,
        totalBytes: 0,
        downloadedBytes: 0,
        speed: 0,
        fileName: '--',
        fileNames: [],
        currentFile: '',
        totalFiles: 0,
        completedFiles: 0,
        startTime: Date.now(),
        urls: urls || [],
        options: downloadOptions,
        log: [],
        ttyOutput: ''          // tdl 原始终端输出（用于 TTY 嵌入显示）
    };
    tasks.set(id, task);

    res.json({ success: true, taskId: id });

    // 异步启动下载
    startTdlDownload(id, taskDir);
});

/**
 * GET /api/progress/:taskId - SSE 进度推送
 */
app.get('/api/progress/:taskId', (req, res) => {
    const { taskId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const interval = setInterval(() => {
        const task = tasks.get(taskId);
        if (task) {
            res.write(`data: ${JSON.stringify(task)}\n\n`);
            if (task.status === 'completed' || task.status === 'error') {
                clearInterval(interval);
                setTimeout(() => res.end(), 2000);
            }
        } else {
            res.write(`data: ${JSON.stringify({ error: '任务不存在' })}\n\n`);
            clearInterval(interval);
            res.end();
        }
    }, 500);

    req.on('close', () => clearInterval(interval));
});

/**
 * GET /api/files/:taskId - 列出下载完成的文件
 */
app.get('/api/files/:taskId', (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task || task.status !== 'completed') return res.status(404).json({ error: '无文件' });

    const taskDir = path.join(DOWNLOAD_DIR, req.params.taskId);
    let files = [];
    try {
        files = fs.readdirSync(taskDir)
            .filter(f => f !== '.progress')
            .map(f => ({
                name: f,
                size: fs.statSync(path.join(taskDir, f)).size,
                url: `/api/file/${req.params.taskId}/${encodeURIComponent(f)}`
            }));
    } catch (e) {}

    res.json({ files, dir: taskDir });
});

/**
 * GET /api/file/:taskid/:filename - 下载单个文件
 */
app.get('/api/file/:taskId/:filename', (req, res) => {
    const filePath = path.join(DOWNLOAD_DIR, req.params.taskId, decodeURIComponent(req.params.filename));
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ error: '文件不存在' });
    }
});

/**
 * GET /api/task/:taskId - 获取任务详情
 */
app.get('/api/task/:taskId', (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (task) res.json(task);
    else res.status(404).json({ error: '任务不存在' });
});

// ==================== 核心下载逻辑 ====================

function startTdlDownload(taskId, taskDir) {
    const task = tasks.get(taskId);
    if (!task) return;

    const opt = task.options || {};

    task.status = 'downloading';
    const startMsg = '正在启动 tdl 下载引擎...';
    addLog(task, startMsg);
    // 同步到 TTY 输出，确保前端能立即看到启动信息
    task.ttyOutput = `[${new Date().toLocaleTimeString('zh-CN')}] ${startMsg}\n`;

    // 构建 tdl 命令参数
    const args = [
        'dl',
        '-u', task.urls[0],  // 主 URL
        '-d', taskDir,       // 输出目录
        '--continue'          // 断点续传（默认开启）
    ];

    // --- 并发控制 ---
    if (opt.limit && opt.limit > 0) {
        args.push('-l', String(opt.limit));
    }
    if (opt.threads && opt.threads > 0) {
        args.push('-t', String(opt.threads));
    }

    // --- 文件过滤 ---
    if (opt.include) {
        args.push('-i', opt.include);
    }
    if (opt.exclude) {
        args.push('-e', opt.exclude);
    }

    // --- 开关选项 ---
    if (opt.desc) {
        args.push('--desc');
        addLog(task, '下载顺序: 从新到旧');
    }
    if (opt.skipSame) {
        args.push('--skip-same');
    }
    if (opt.group) {
        args.push('--group');
        addLog(task, '已开启自动分组下载');
    }
    if (opt.rewriteExt) {
        args.push('--rewrite-ext');
        addLog(task, '已开启扩展名修正');
    }

    // --- 文件名模板 ---
    if (opt.template) {
        args.push('--template', opt.template);
    }

    // --- 高级选项 ---
    if (opt.delay) {
        args.push('--delay', opt.delay);
    }
    if (opt.reconnect) {
        args.push('--reconnect-timeout', opt.reconnect);
    }

    // 添加代理参数
    const proxyAddr = getProxyArg();
    if (proxyAddr) {
        args.push('--proxy', proxyAddr);
        const cfg = getProxyConfig();
        addLog(task, `使用代理: ${cfg.protocol}://${cfg.host}:${cfg.port}`);
    }

    console.log(`[download] Starting tdl: ${TDL_PATH} ${args.join(' ')}`);

    const tdlProcess = spawn(TDL_PATH, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
    });

    task.process = tdlProcess;

    // 收集完整的 stdout 和 stderr 用于错误诊断
    let fullStdout = '';
    let fullStderr = '';

    // 解析 tdl 输出来获取进度
    let buffer = '';
    
    tdlProcess.stdout.on('data', (data) => {
        const text = data.toString();
        fullStdout += text;
        
        // 追加到 TTY 输出（去 ANSI 码后存入，限制总长度防内存膨胀）
        const cleanText = stripAnsi(text);
        task.ttyOutput = (task.ttyOutput + cleanText).slice(-50000);

        buffer += text;
        
        // 逐行处理
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';  // 最后一个可能不完整

        for (const line of lines) {
            parseTdlOutput(line, task);
        }
    });

    tdlProcess.stderr.on('data', (data) => {
        const text = data.toString();
        fullStderr += text;

        // 追加到 TTY 输出
        const cleanText = stripAnsi(text);
        task.ttyOutput = (task.ttyOutput + cleanText).slice(-50000);

        buffer += text;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            parseTdlOutput(line, task);
            // stderr 行通常包含错误/警告信息，确保记录
            if (line.trim()) {
                addLog(task, `[stderr] ${line.trim()}`);
            }
        }
    });

    tdlProcess.on('close', (code) => {
        addLog(task, `tdl 进程结束 (exit code: ${code})`);
        
        // 保存完整输出用于调试
        task.fullStdout = fullStdout.slice(-5000);  // 保留最后5K
        task.fullStderr = fullStderr.slice(-5000);

        if (code === 0) {
            // 将 tdl 的原始输出也追加到 TTY（用户可以看到完整过程）
            if (fullStdout) {
                const cleanStdout = stripAnsi(fullStdout);
                task.ttyOutput = (task.ttyOutput + '\n--- tdl 输出 ---\n' + cleanStdout + '\n--- 结束 ---').slice(-50000);
            }
            finishTask(task, taskDir);
            
            // 如果完成了但没有文件，添加警告
            if (!task.downloadedFiles || task.downloadedFiles.length === 0) {
                addLog(task, '⚠️ 未下载任何文件（消息可能已被删除或无媒体附件）');
                task.status = 'completed';
            }
        } else {
            task.status = 'error';
            
            // 从 stderr 提取有用的错误信息
            const errorLines = fullStderr.split('\n').filter(l => l.trim()).slice(-10);
            const errorDetail = errorLines.length > 0 
                ? errorLines.join('; ') 
                : (fullStdout.split('\n').filter(l => l.trim()).slice(-3).join('; ') || '无详细输出');
            
            task.error = code === null ? '进程被终止' : `tdl 退出码: ${code}`;
            task.errorDetail = errorDetail;
            addLog(task, `❌ 错误详情: ${errorDetail}`);
            
            // 即使出错也扫描一下已下载的文件
            scanDownloadedFiles(task, taskDir);
        }

        task.process = null;
    });

    tdlProcess.on('error', (err) => {
        addLog(task, `tdl 启动错误: ${err.message}`);
        task.status = 'error';
        task.error = err.message;
        scanDownloadedFiles(task, taskDir);
        task.process = null;
    });

    // 超时保护 (2 小时)
    setTimeout(() => {
        const t = tasks.get(taskId);
        if (t && t.status === 'downloading' && t.process) {
            addLog(t, '⚠️ 下载超时，终止进程');
            t.process.kill();
        }
    }, 7200000);
}

/**
 * 解析 tdl 的输出行，提取进度信息
 * 
 * tdl v0.20.2 实际输出格式：
 *   国产熟女(1842682231):15581 -> dow~ ... 70.5% [#####...] [4.79 MB in 11.2s; ~ETA: 5s; 437.03 KB/s]
 *   国产熟女(1842682231):15581 -> dow~ ... done! [6.79 MB in 12.1s; 568.92 KB/s]
 *   CPU: 0.00% Memory: 22.33 MB Goroutines: 50
 */
function parseTdlOutput(line, task) {
    const trimmed = line.trim();
    if (!trimmed) return;

    // 跳过 ANSI 转义码纯行
    if (/^\x1b\[/.test(trimmed) && trimmed.length < 10) return;

    // 去除 ANSI 转义码后再处理
    const clean = stripAnsi(trimmed);
    
    // 记录日志（跳过 CPU/Memory/Goroutines 重复状态行）
    if (clean.length < 200 && !/^CPU:/i.test(clean)) {
        addLog(task, clean);
    }

    // ====== 匹配 tdl 进度行（核心格式）======
    // 格式: ... XX.X% [...] [X.XX MB in Xs; ~ETA: Xs; XXX KB/s]
    // 或:   ... done! [X.XX MB in Xs; XXX KB/s]

    // 先检测完成
    if (/\bdone\b/i.test(clean)) {
        task.status = 'downloading';
        // done 行中提取最终大小
        const doneSizeMatch = clean.match(/\[(\d+\.?\d*\s*[KMGT]?B)\s+in\s+[^\]]+\]/);
        if (doneSizeMatch) {
            const sizeStr = doneSizeMatch[1];
            task.downloadedBytes = parseSizeStr(sizeStr);
            if (!task.totalBytes || task.totalBytes < task.downloadedBytes) {
                task.totalBytes = task.downloadedBytes;
            }
        }
        // 提取完成时的速度
        const doneSpeedMatch = clean.match(/;\s*([\d.]+\s*[KMGT]?B\/s)/i);
        if (doneSpeedMatch) task.speedStr = doneSpeedMatch[1];
        return;
    }

    // 匹配百分比进度行
    const pctMatch = clean.match(/(\d+\.?\d*)%\s*\[([#\.]+)\]\s*\[([^\]]+)\]/);
    if (pctMatch) {
        const pct = parseFloat(pctMatch[1]);
        const detail = pctMatch[3]; // "4.79 MB in 11.2s; ~ETA: 5s; 437.03 KB/s"

        task.progress = Math.round(pct);

        // 从 detail 中提取已下载大小
        const sizeMatch = detail.match(/^(\d+\.?\d*\s*[KMGT]?B)/i);
        if (sizeMatch) {
            task.downloadedBytes = parseSizeStr(sizeMatch[1]);
        }

        // 提取速度
        const speedMatch = detail.match(/;\s*([\d.]+\s*[KMGT]?B\/s)/i);
        if (speedMatch) task.speedStr = speedMatch[1];

        // 提取文件名（在 -> 和 ... 之间）
        const fileMatch = clean.match(/->\s*(.+?)\s*\.\.\./);
        if (fileMatch) {
            let fname = fileMatch[1].trim();
            // 去掉末尾截断标记
            if (fname.endsWith('~')) fname = fname.slice(0, -1).trimEnd();
            if (fname && fname !== '...') {
                task.currentFile = fname;
                if (!task.fileName || task.fileName === '--') {
                    task.fileName = fname;
                }
            }
        }

        task.status = 'downloading';
        return;
    }

    // 检测新文件开始（tdl 可能输出新文件信息）
    const newFileMatch = clean.match(/->\s*(.+?)(?:\s+\.\.\.)?\s+\d/);
    if (newFileMatch && newFileMatch[1] && newFileMatch[1] !== '...') {
        let fname = newFileMatch[1].trim().replace(/~$/, '');
        if (fname && fname.length > 2 && fname.length < 200) {
            task.currentFile = fname;
            if (!task.fileNames.includes(fname)) {
                task.fileNames.push(fname);
            }
            task.totalFiles = task.fileNames.length;
        }
    }
}

/**
 * 将大小字符串转换为字节数
 * 例如: "4.79 MB" → 5022208, "6.79 MB" → 7120179
 */
function parseSizeStr(str) {
    const match = str.match(/^(\d+\.?\d*)\s*(B|KB|MB|GB|TB)?$/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();
    const multipliers = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
    return num * (multipliers[unit] || 1);
}

/**
 * 去除 ANSI 转义码
 */

/**
 * 完成任务
 */
function finishTask(task, taskDir) {
    task.status = 'completed';
    task.progress = 100;

    scanDownloadedFiles(task, taskDir);

    // 如果只下了一个文件，设为主文件名
    if (task.downloadedFiles && task.downloadedFiles.length === 1) {
        task.fileName = task.downloadedFiles[0].name;
    } else if (task.downloadedFiles && task.downloadedFiles.length > 0) {
        task.fileName = `${task.downloadedFiles.length} 个文件`;
    }

    addLog(task, `✅ 下载完成！共 ${task.downloadedFiles?.length || 0} 个文件`);
}

/**
 * 扫描已下载的文件
 */
function scanDownloadedFiles(task, taskDir) {
    try {
        if (fs.existsSync(taskDir)) {
            task.downloadedFiles = fs.readdirSync(taskDir)
                .filter(f => f !== '.progress' && !f.startsWith('.'))
                .map(f => ({
                    name: f,
                    size: fs.statSync(path.join(taskDir, f)).size,
                    url: `/api/file/${task.id}/${encodeURIComponent(f)}`
                }));

            let totalSize = 0;
            for (const f of task.downloadedFiles) totalSize += f.size;
            task.downloadedBytes = totalSize;
            task.totalFiles = task.downloadedFiles.length;
        }
    } catch (e) {
        task.downloadedFiles = [];
    }
}

/**
 * 添加日志
 */
function addLog(task, msg) {
    const time = new Date().toLocaleTimeString('zh-CN');
    const logEntry = `[${time}] ${msg}`;
    task.log.push(logEntry);
    // 保留最近 200 条
    if (task.log.length > 200) task.log.shift();
    // 同步写入 TTY 输出（确保前端终端能显示关键状态信息）
    task.ttyOutput = (task.ttyOutput || '') + logEntry + '\n';
}

// ==================== 工具函数 ====================

function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==================== 启动服务器 ====================
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════╗
║   🎬 TG-DL v2.1 (Powered by tdl)     ║
║   地址: http://localhost:${PORT}         ║
║   引擎: tdl v0.20.2                   ║
╚══════════════════════════════════════╝
    `);
});
