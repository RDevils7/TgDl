/**
 * TG-DL - Telegram 下载工具 前端逻辑
 * 支持链接解析、参数选择、进度追踪、文件保存
 */

// ==================== 状态管理 ====================
const state = {
    parsedData: null,
    selectedFile: null,
    taskId: null,
    eventSource: null,
    downloadStartTime: null,
    timerInterval: null,
    history: JSON.parse(localStorage.getItem('tg-dl-history') || '[]'),
    proxyEnabled: false,  // 从后端加载
    settingsOpen: false,
    loginModalOpen: false,
    loginStatus: { loggedIn: false },
    qrPollInterval: null,
    loginMode: 'code' // 'code' | 'qr' - 当前登录模式
};

// ==================== DOM 引用 ====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ==================== 工具函数 ====================

function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec) {
    if (!bytesPerSec) return '--';
    return formatSize(bytesPerSec) + '/s';
}

function formatDuration(ms) {
    if (!ms) return '00:00';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function showEl(id) { $(`#${id}`).classList.remove('hidden'); }
function hideEl(id) { $(`#${id}`).classList.add('hidden'); }

/**
 * 截断 URL 显示
 */
function truncateUrl(url, maxLen = 40) {
    if (url.length <= maxLen) return url;
    return url.slice(0, maxLen - 3) + '...';
}
function toggleLoadingBtn(loading, btnId = 'parseBtn') {
    const btn = $(`#${btnId}`);
    const text = btn.querySelector('.btn-text');
    const loadingEl = btn.querySelector('.btn-loading');
    if (loading) {
        if (text) text.classList.add('hidden');
        if (loadingEl) loadingEl.classList.remove('hidden');
        btn.disabled = true;
    } else {
        if (text) text.classList.remove('hidden');
        if (loadingEl) loadingEl.classList.add('hidden');
        btn.disabled = false;
    }
}

function showError(msg) {
    $('#errorMsg').textContent = msg;
    showEl('errorMsg');
}
function hideError() { hideEl('errorMsg'); }

// ==================== 代理管理 ====================

/**
 * 切换代理开关
 */
function toggleProxy() {
    state.proxyEnabled = !state.proxyEnabled;

    const body = $('#proxyBody');
    const label = $('.proxy-toggle .toggle-label');
    const sw = $('.proxy-toggle .toggle-switch');

    if (state.proxyEnabled) {
        body.classList.remove('collapsed');
        label.textContent = '开启';
        sw.classList.add('active');
        sw.style.background = 'var(--accent-green)';
    } else {
        body.classList.add('collapsed');
        label.textContent = '关闭';
        sw.classList.remove('active');
        sw.style.background = '';
    }

    // 立即同步到后端（自动保存）
    syncProxyToBackend();
}

/**
 * 同步代理设置到后端
 */
async function syncProxyToBackend() {
    try {
        await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enabled: state.proxyEnabled,
                protocol: $('#proxyProtocol').value,
                host: $('#proxyHost').value.trim(),
                port: $('#proxyPort').value.trim(),
                username: $('#proxyUser').value.trim(),
                password: $('#proxyPass').value
            })
        });
    } catch (e) { /* 静默失败 */ }
}

/**
 * 保存代理设置到后端
 */
async function saveProxy() {
    const config = {
        enabled: state.proxyEnabled,
        protocol: $('#proxyProtocol').value,
        host: $('#proxyHost').value.trim(),
        port: $('#proxyPort').value.trim(),
        username: $('#proxyUser').value.trim(),
        password: $('#proxyPass').value
    };

    try {
        const res = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const data = await res.json();

        if (data.success) {
            showConnResult({
                success: true,
                connected: null,
                message: `💾 代理设置已保存${config.enabled && config.host ? ` (${config.protocol}://${config.host}:${config.port})` : ' (直连模式)'}`
            });
        } else {
            showConnResult({ success: false, message: '❌ 保存失败' });
        }
    } catch (err) {
        showConnResult({ success: false, message: `❌ 保存失败: ${err.message}` });
    }
}

/**
 * 测试 Telegram 连接
 */
async function testConnection() {
    const btn = $('#testConnBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg></span> 测试中...';

    // 先保存当前代理设置
    await saveProxy();

    try {
        const res = await fetch('/api/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        const data = await res.json();
        showConnResult(data);
    } catch (err) {
        showConnResult({
            success: false,
            connected: false,
            message: `❌ 测试请求失败: ${err.message}`
        });
    } finally {
        btn.disabled = false;
        btn.innerHTML = '🔗 测试';
    }
}

/**
 * 显示连接测试结果
 */
function showConnResult(data) {
    const el = $('#connTestResult');
    
    let icon = data.connected === false ? '❌' : (data.connected === true ? '✅' : '⚠️');
    let cls = data.connected === true ? 'success' : (data.error ? 'error' : 'warning');
    
    let html = `<div class="conn-test-inner conn-${cls}">`;
    html += `<div class="conn-test-msg">${icon} ${data.message || ''}</div>`;
    
    if (data.latency) {
        html += `<div class="conn-test-meta">`;
        html += `<span>延迟: <strong>${data.latency}</strong></span>`;
        if (data.server) html += `<span>服务器: <strong>${escapeHtml(data.server)}</strong></span>`;
        if (data.proxyInUse) html += `<span style="color:var(--accent-cyan)">📡 通过代理</span>`;
        html += `</div>`;
    }

    if (data.suggestion) {
        html += `<div class="conn-suggestion">💡 ${data.suggestion}</div>`;
    }

    html += `</div>`;
    
    el.innerHTML = html;
    showEl('connTestResult');

    // 3秒后自动隐藏成功结果
    if (data.connected === true) {
        setTimeout(() => hideEl('connTestResult'), 4000);
    }
}

/**
 * 初始化代理 UI 状态
 */
function initProxyUI() {
    if (state.proxyEnabled) {
        const body = $('#proxyBody');
        const label = $('.proxy-toggle .toggle-label');
        const sw = $('.proxy-toggle .toggle-switch');
        
        body.classList.remove('collapsed');
        label.textContent = '开启';
        sw.classList.add('active');
        sw.style.background = 'var(--accent-green)';
    }
}

/**
 * 从后端加载代理设置并填充表单
 */
async function loadProxyFromBackend() {
    try {
        const res = await fetch('/api/proxy');
        const cfg = await res.json();

        state.proxyEnabled = cfg.enabled;

        if (cfg.protocol) $('#proxyProtocol').value = cfg.protocol;
        if (cfg.host) $('#proxyHost').value = cfg.host;
        if (cfg.port) $('#proxyPort').value = cfg.port;
        if (cfg.username) $('#proxyUser').value = cfg.username;  // 密码不恢复

        initProxyUI();
    } catch (e) {
        console.warn('[proxy] 从后端加载配置失败:', e);
    }
}

// ==================== 链接解析 ====================

async function parseLink() {
    const url = $('#tgUrl').value.trim();
    
    if (!url) {
        showError('请输入 Telegram 链接');
        return;
    }

    if (!url.includes('t.me')) {
        showError('请输入有效的 Telegram 链接（需包含 t.me）');
        return;
    }

    hideError();
    toggleLoadingBtn(true);

    try {
        const res = await fetch('/api/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const data = await res.json();

        if (!data.success) {
            showError(data.error + (data.tip ? '\n\n💡 ' + data.tip : ''));
            return;
        }

        state.parsedData = data;

        // tdl 模式：不需要预先获取文件列表，直接显示准备下载
        renderTdlParseResult(data);

    } catch (err) {
        console.error('[parseLink] Error:', err);
        showError(`请求失败: ${err.message}（请确认服务是否启动 http://localhost:3210）`);
    } finally {
        toggleLoadingBtn(false);
    }
}

// ==================== 渲染解析结果（tdl 模式）====================

function renderTdlParseResult(data) {
    const container = $('#parseResult');
    const { parsed, url } = data;
    
    // 检测是否为 tdl 模式
    const isTdlMode = data.data && data.data.useTdl === true;

    let html = '';

    // ====== 链接信息详情卡片 ======
    html += `<div class="link-info-card">`;
    html += `<div class="link-info-header">📋 链接信息</div>`;
    html += `<div class="link-info-body">`;

    // 链接类型
    const typeLabel = parsed.type === 'private' ? '🔒 私有频道/群组' 
                    : parsed.type === 'public' ? '🌐 公开频道' 
                    : '📢 频道页面';
    html += `<div class="info-row"><span class="info-label">类型</span><span class="info-value">${typeLabel}</span></div>`;

    // 频道标识
    if (parsed.channel) {
        html += `<div class="info-row"><span class="info-label">频道</span><span class="info-value">@${escapeHtml(parsed.channel)}</span></div>`;
    } else if (parsed.channelId) {
        html += `<div class="info-row"><span class="info-label">频道 ID</span><span class="info-value mono">${escapeHtml(parsed.channelId)}</span></div>`;
    }

    // 消息 ID
    if (parsed.postId) {
        html += `<div class="info-row"><span class="info-label">消息 ID</span><span class="info-value mono">#${parsed.postId}</span></div>`;
    }

    // 原始链接（可复制）
    html += `<div class="info-row"><span class="info-label">链接</span><span class="info-value link-url" title="点击复制" onclick="navigator.clipboard.writeText('${escapeHtml(url)}').then(()=>this.textContent='已复制 ✓')">${truncateUrl(url, 40)}</span></div>`;

    html += `</div>`; // link-info-body
    html += `</div>`; // link-info-card

    if (isTdlMode) {
        // tdl 模式：显示引擎信息和下载准备状态
        html += `<div class="tdl-ready-card">`;
        html += `<div class="tdl-ready-icon">🚀</div>`;
        html += `<div class="tdl-ready-title">链接有效，准备下载</div>`;
        html += `<div class="tdl-ready-desc">`;
        html += `<span>🔧 引擎: <strong>tdl v0.20.2</strong></span>`;
        html += `<span>📦 支持视频 / 文档 / 音乐 / 压缩包</span></div>`;
        
        // 代理状态
        if (state.proxyEnabled) {
            html += `<div class="proxy-badge-active">🌐 代理模式 · 通过代理连接 Telegram</div>`;
        } else {
            html += `<div class="proxy-badge-inactive">🔗 直连模式</div>`;
        }
        html += `</div>`; // tdl-ready-card
        
        state.selectedFile = { type: 'tdl', urls: [url], isTdlMode: true };
    } else {
        // 原有模式（兼容）
        const { data: result } = data;
        if (result.messageText) {
            html += `<div class="message-preview">💬 ${escapeHtml(result.messageText)}</div>`;
        }

        if (result.files && result.files.length > 0) {
            result.files.forEach((file, idx) => {
                const icon = file.type === 'video' ? '🎬' : '📄';
                const name = file.name || (file.type === 'video' ? `视频_${idx + 1}.mp4` : `文件_${idx + 1}`);
                
                html += `<div class="result-item" onclick="selectFile(${idx})" id="resultItem${idx}" data-idx="${idx}">`;
                html += `<span class="file-type-icon">${icon}</span>`;
                html += `<div class="file-details">`;
                html += `<div class="file-name-text">${escapeHtml(name)}</div>`;
                html += `<div class="file-meta-text">`;
                html += `<span class="tag">${file.type === 'video' ? '视频' : '文档'}</span>`;
                if (file.qualities && file.qualities.length > 0) {
                    html += `<span class="tag">${file.qualities.length} 种画质可选</span>`;
                }
                html += `</div></div></div>`;
            });
            setTimeout(() => selectFile(0), 50);
        } else {
            html += `<div style="padding:20px;text-align:center;color:var(--text-muted);">`;
            html += `⚠️ 未检测到可下载的媒体文件</div>`;
        }
        
        state.selectedFile = null;  // 将在 selectFile 中设置
    }

    container.innerHTML = html;
    showEl('parseResult');

    // 显示选项面板
    if (isTdlMode || (data.data.files && data.data.files.length > 0)) {
        showEl('optionsPanel');
        hideEl('fileListGroup');  // tdl 模式不需要文件选择
    } else {
        hideEl('optionsPanel');
    }
}

function renderParseResult(data) {
    // 兼容旧接口
    renderTdlParseResult(data);
}

function renderFileList(files) {
    const list = $('#fileList');
    list.innerHTML = files.map((f, i) => `
        <div class="file-list-item ${i === 0 ? 'active' : ''}" 
             onclick="selectFile(${i});renderFileListActive(${i})"
             id="listItem${i}">
            <div class="check-mark">${i === 0 ? '✓' : ''}</div>
            <div>
                <div style="font-size:0.85rem;color:var(--text-primary);">
                    ${f.type === 'video' ? '🎬' : '📄'} ${escapeHtml(f.name || ('文件_' + (i+1)))}
                </div>
            </div>
        </div>
    `).join('');
}

function renderFileListActive(idx) {
    $$('.file-list-item').forEach(el => el.classList.remove('active'));
    const active = $(`#listItem${idx}`);
    if (active) active.classList.add('active');
    $$('.file-list-item .check-mark').forEach((el, i) => {
        el.textContent = i === idx ? '✓' : '';
    });
}

function selectFile(idx) {
    // 高亮选中项
    $$('.result-item').forEach(el => el.classList.remove('selected'));
    const item = $(`#resultItem${idx}`);
    if (item) item.classList.add('selected');

    // 更新状态
    if (state.parsedData && state.parsedData.data.files) {
        state.selectedFile = state.parsedData.data.files[idx];
        
        // 更新画质选项（如果是视频）
        if (state.selectedFile.type === 'video' && state.selectedFile.qualities) {
            const sel = $('#qualitySelect');
            const currentVal = sel.value;
            sel.innerHTML = state.selectedFile.qualities.map(q => 
                `<option value="${q.id}">${q.label}</option>`
            ).join('');
            // 尝试恢复之前的选择
            if (state.selectedFile.qualities.find(q => q.id === currentVal)) {
                sel.value = currentVal;
            }
        }
    }
}

// ==================== 开始下载 ====================

async function startDownload() {
    if (!state.selectedFile) {
        alert('请先解析链接');
        return;
    }

    // UI 切换
    $('#downloadBtn').disabled = true;
    showEl('progressPanel');

    // 重置进度 UI
    resetProgressUI();

    // 记录开始时间
    state.downloadStartTime = Date.now();
    startTimer();

    try {
        const isTdl = state.selectedFile.isTdlMode === true;

        if (isTdl) {
            // tdl 模式：发送 URL 列表给后端
            const res = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    urls: state.selectedFile.urls,
                    quality: $('#qualitySelect').value,
                    taskId: state.taskId
                })
            });

            const data = await res.json();

            if (data.success) {
                state.taskId = data.taskId;
                connectProgressStream(data.taskId);
            } else {
                throw new Error(data.error || '创建任务失败');
            }
        } else {
            // 原有模式（兼容）
            const quality = $('#qualitySelect').value;
            let downloadUrl = state.selectedFile.url;

            if (quality !== 'source' && state.selectedFile.qualities) {
                const qObj = state.selectedFile.qualities.find(q => q.id === quality);
                if (qObj && qObj.url) downloadUrl = qObj.url;
            }

            const res = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: downloadUrl, quality, taskId: state.taskId })
            });

            const data = await res.json();
            if (data.success) {
                state.taskId = data.taskId;
                connectProgressStream(data.taskId);
            } else {
                throw new Error(data.error || '创建任务失败');
            }
        }

    } catch (err) {
        console.error('[startDownload] Error:', err);
        updateStatus('error', err.message);
        $('#downloadBtn').disabled = false;
    }
}

// ==================== SSE 进度流 ====================

function connectProgressStream(taskId) {
    // 关闭之前的连接
    if (state.eventSource) {
        state.eventSource.close();
    }

    updateStatus('downloading', '正在连接...');

    try {
        state.eventSource = new EventSource(`/api/progress/${taskId}`);

        state.eventSource.onmessage = function(event) {
            try {
                const progress = JSON.parse(event.data);
                handleProgressUpdate(progress);
            } catch (e) {
                console.warn('[SSE] Parse error:', e);
            }
        };

        state.eventSource.onerror = function(err) {
            console.warn('[SSE] Connection error:', err);
            // SSE 断开时不要立即报错，可能是正常的结束
        };

    } catch (e) {
        console.error('[connectProgressStream] Error:', e);
        updateStatus('error', '无法连接到进度服务器');
    }
}

function handleProgressUpdate(progress) {
    if (progress.error) {
        const detail = progress.errorDetail ? `\n${progress.errorDetail}` : '';
        updateStatus('error', progress.error + detail);
        return;
    }

    // 更新文件名
    if (progress.fileName && progress.fileName !== '--') {
        $('#fileName').textContent = progress.fileName;
    }
    
    // tdl 模式：显示当前正在下载的文件
    if (progress.currentFile) {
        $('#fileName').textContent = progress.currentFile;
    }

    // 更新进度条
    const pct = Math.min(progress.progress || 0, 100);
    $('#progressBar').style.width = pct + '%';
    $('#progressGlow').style.width = Math.min(pct + 5, 100) + '%';
    $('#progressPercent').textContent = pct + '%';

    // 文件大小
    const total = progress.totalBytes || 0;
    const downloaded = progress.downloadedBytes || 0;

    if (total > 0 && downloaded > 0) {
        $('#fileSize').textContent = `${formatSize(downloaded)} / ${formatSize(total)}`;
        $('#downloadedSize').textContent = `${formatSize(downloaded)} / ${formatSize(total)}`;
        $('#progressDetail').textContent = `已下载 ${formatSize(downloaded)}，共 ${formatSize(total)}`;
    } else if (downloaded > 0) {
        $('#fileSize').textContent = formatSize(downloaded);
        $('#downloadedSize').textContent = formatSize(downloaded);
        $('#progressDetail').textContent = `已下载 ${formatSize(downloaded)}...`;
    } else {
        $('#fileSize').textContent = '准备中...';
        $('#downloadedSize').textContent = '等待中';
    }

    // 速度（tdl 格式或数字格式）
    if (progress.speedStr) {
        $('#downloadSpeed').textContent = progress.speedStr;
    } else if (progress.speed > 0) {
        $('#downloadSpeed').textContent = formatSpeed(progress.speed);
    }

    // 多文件进度信息
    if (progress.totalFiles > 1) {
        $('#progressDetail').textContent += ` · 第 ${progress.completedFiles || 0}/${progress.totalFiles} 个文件`;
    }

    // 状态
    if (progress.status === 'downloading') {
        updateStatus('downloading', '下载中...');
    } else if (progress.status === 'completed') {
        onDownloadComplete(progress);
    } else if (progress.status === 'error') {
        const detail = progress.errorDetail ? `\n${progress.errorDetail}` : '';
        updateStatus('error', (progress.error || '下载失败') + detail);
        $('#downloadBtn').disabled = false;
        showEl('cancelBtn');
    } else if (progress.status === 'preparing') {
        updateStatus('downloading', '准备下载资源...');
    }
}

function onDownloadComplete(progress) {
    updateStatus('completed', '下载完成 ✓');
    clearInterval(state.timerInterval);

    // 最终数值
    $('#progressBar').style.width = '100%';
    $('#progressGlow').style.width = '100%';
    $('#progressPercent').textContent = '100%';

    if (progress.downloadedBytes) {
        const size = formatSize(progress.downloadedBytes);
        $('#fileSize').textContent = size;
        $('#downloadedSize').textContent = size;
        
        // 多文件显示
        if (progress.downloadedFiles && progress.downloadedFiles.length > 0) {
            const fileCount = progress.downloadedFiles.length;
            const names = progress.downloadedFiles.map(f => f.name).join(', ');
            $('#fileName').textContent = `${fileCount} 个文件已下载`;
            $('#progressDetail').textContent = `共 ${size} · ${fileCount} 个文件`;
            
            // 记录所有文件到历史
            progress.downloadedFiles.forEach((f, i) => {
                addToHistory({
                    fileName: f.name,
                    size: f.size,
                    time: Date.now(),
                    status: 'completed'
                });
            });
        } else {
            $('#progressDetail').textContent = `共 ${size}`;
        }
    }
    
    if (progress.fileName && (!progress.downloadedFiles || progress.downloadedFiles.length <= 1)) {
        $('#progressDetail').textContent = `共 ${formatSize(progress.downloadedBytes || 0)}`;
        addToHistory({
            fileName: progress.fileName || 'unknown',
            size: progress.downloadedBytes || 0,
            time: Date.now(),
            status: 'completed'
        });
    }

    $('#downloadSpeed').textContent = '--';

    // 显示操作按钮
    hideEl('cancelBtn');
    
    if (progress.downloadedFiles && progress.downloadedFiles.length > 0) {
        showEl('newBtn');
        // 多文件时提供文件列表
        showMultiFileList(progress.id || state.taskId);
    } else {
        showEl('saveBtn');
        showEl('newBtn');
    }

    // 进度条动画效果
    $('#progressBar').style.background = 'linear-gradient(135deg, var(--accent-green), #059669)';
}

/**
 * 显示多文件下载列表
 */
function showMultiFileList(taskId) {
    if (!taskId) return;
    fetch(`/api/files/${taskId}`)
        .then(r => r.json())
        .then(data => {
            if (data.files && data.files.length > 0) {
                let html = '<div class="multi-file-list">';
                data.files.forEach(f => {
                    html += `<a href="${f.url}" target="_blank" class="multi-file-item">`;
                    html += `<span>📄</span>`;
                    html += `<span>${escapeHtml(f.name)}</span>`;
                    html += `<span>${formatSize(f.size)}</span>`;
                    html += `</a>`;
                });
                html += '</div>';
                
                // 插入到操作按钮区域
                let actionArea = document.getElementById('actionButtons');
                if (!actionArea.querySelector('.multi-file-list')) {
                    actionArea.insertAdjacentHTML('afterbegin', html);
                }
                hideEl('saveBtn');
            }
        })
        .catch(() => {});
}

// ==================== 状态更新 ====================

function updateStatus(status, text) {
    const el = $('#statusText');
    el.textContent = text;
    el.className = 'status-value';
    
    switch (status) {
        case 'pending': el.classList.add('status-pending'); break;
        case 'downloading': el.classList.add('status-downloading'); break;
        case 'completed': el.classList.add('status-completed'); break;
        case 'error': el.classList.add('status-error'); break;
    }
}

// ==================== 定时器 ====================

function startTimer() {
    clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
        if (state.downloadStartTime) {
            $('#elapsedTime').textContent = formatDuration(Date.now() - state.downloadStartTime);
        }
    }, 1000);
}

// ==================== 操作按钮 ====================

function cancelDownload() {
    if (state.eventSource) {
        state.eventSource.close();
    }
    clearInterval(state.timerInterval);
    
    updateStatus('error', '已取消');
    $('#downloadBtn').disabled = false;
    hideEl('cancelBtn');
}

function saveFile() {
    if (!state.taskId) return;
    // 检查是否是多文件下载
    fetch(`/api/files/${state.taskId}`)
        .then(r => r.json())
        .then(data => {
            if (data.files && data.files.length > 0) {
                // 多文件：打开第一个
                window.open(data.files[0].url, '_blank');
            } else {
                // 单文件
                window.open(`/api/file/${state.taskId}`, '_blank');
            }
        })
        .catch(() => {
            window.open(`/api/file/${state.taskId}`, '_blank');
        });
}

function resetAll() {
    // 清理
    if (state.eventSource) state.eventSource.close();
    clearInterval(state.timerInterval);
    state.parsedData = null;
    state.selectedFile = null;
    state.taskId = null;

    // 重置输入
    $('#tgUrl').value = '';

    // 隐藏面板
    hideEl('parseResult');
    hideEl('optionsPanel');
    hideEl('progressPanel');
    hideError();

    // 重置进度 UI
    resetProgressUI();

    // 聚焦输入框
    $('#tgUrl').focus();
}

function resetProgressUI() {
    $('#progressBar').style.width = '0%';
    $('#progressGlow').style.width = '0%';
    $('#progressBar').style.background = '';
    $('#progressPercent').textContent = '0%';
    $('#progressDetail').textContent = '等待中...';
    $('#fileName').textContent = '--';
    $('#fileSize').textContent = '计算中...';
    $('#downloadedSize').textContent = '0 B / 0 B';
    $('#downloadSpeed').textContent = '--';
    $('#elapsedTime').textContent = '00:00';
    updateStatus('pending', '准备就绪');
    
    hideEl('saveBtn');
    hideEl('newBtn');
    hideEl('cancelBtn');
    $('#downloadBtn').disabled = false;
}

// ==================== 历史记录 ====================

function addToHistory(item) {
    state.history.unshift(item);
    // 只保留最近 30 条
    if (state.history.length > 30) state.history.pop();
    
    localStorage.setItem('tg-dl-history', JSON.stringify(state.history));
    renderHistory();
}

function renderHistory() {
    const container = $('#historyList');
    
    if (state.history.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <p>暂无下载记录</p>
            </div>
        `;
        return;
    }

    container.className = 'history-list';
    container.innerHTML = state.history.map(item => `
        <div class="history-item">
            <span class="history-icon">${item.status === 'completed' ? '✅' : '❌'}</span>
            <div class="history-item-content">
                <div class="history-item-name" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</div>
                <div class="history-item-time">${formatTime(item.time)} · ${item.size ? formatSize(item.size) : ''}</div>
            </div>
            <span class="history-status-badge ${item.status}">${
                item.status === 'completed' ? '完成' : '失败'
            }</span>
        </div>
    `).join('');
}

function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    
    if (isToday) {
        return `今天 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
    
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ==================== 工具 ====================

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==================== 快捷键 ====================

document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter 或 Enter 在输入框中时触发解析
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        parseLink();
    }
    
    // Escape 重置
    if (e.key === 'Escape') {
        resetAll();
    }
});

// 输入框回车也触发
$('#tgUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        parseLink();
    }
});

// ==================== 设置侧边栏 ====================

function toggleSettings() {
    state.settingsOpen = !state.settingsOpen;
    const sidebar = $('#settingsSidebar');
    const overlay = $('#settingsOverlay');

    if (state.settingsOpen) {
        sidebar.classList.add('open');
        overlay.classList.add('active');
        // 打开时从后端加载最新配置
        loadProxyFromBackend();
    } else {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    }
}

// ==================== 登录模块 ====================

/**
 * 打开登录弹窗
 */
function openLoginModal() {
    state.loginModalOpen = true;
    const modal = $('#loginModal');
    const overlay = $('#loginModalOverlay');
    modal.classList.add('active');
    overlay.classList.add('active');

    // 重置到 code 模式
    switchLoginMode('code');

    // 检查登录状态
    checkLoginStatus();
    stopQrPolling();
}

/**
 * 关闭登录弹窗
 */
function closeLoginModal() {
    state.loginModalOpen = false;
    const modal = $('#loginModal');
    const overlay = $('#loginModalOverlay');
    modal.classList.remove('active');
    overlay.classList.remove('active');
    stopQrPolling();
}

/**
 * 切换登录方式（code / qr）
 */
function switchLoginMode(mode) {
    state.loginMode = mode;

    // 更新标签样式
    $$('.login-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    // 切换区域显示
    const codeArea = $('#codeArea');
    const qrArea = $('#qrArea');

    if (mode === 'code') {
        codeArea.classList.remove('hidden');
        qrArea.classList.add('hidden');
        // 显示 code 相关按钮，隐藏 qr 按钮
        $('#startCodeBtn').classList.remove('hidden');
        $('#startQrBtn').classList.add('hidden');
        $('#submitCodeBtn').classList.add('hidden');
        $('#submit2faBtn').classList.add('hidden');
    } else {
        codeArea.classList.add('hidden');
        qrArea.classList.remove('hidden');
        $('#startCodeBtn').classList.add('hidden');
        $('#startQrBtn').classList.remove('hidden');
        $('#submitCodeBtn').classList.add('hidden');
        $('#submit2faBtn').classList.add('hidden');
    }

    // 始终隐藏取消和退出按钮（由 updateLoginUI 控制）
    $('#cancelQrBtn').classList.add('hidden');
    $('#logoutBtn').classList.add('hidden');

    stopQrPolling();
}

/**
 * 检查登录状态
 */
async function checkLoginStatus() {
    const iconEl = $('#loginModalIcon');
    const msgEl = $('#loginModalMsg');
    iconEl.textContent = '⏳';
    msgEl.textContent = '检测登录状态中...';

    try {
        const res = await fetch('/api/login/status');
        const status = await res.json();
        state.loginStatus = status;

        updateLoginUI(status);
        updateHeaderLoginStatus(status);

    } catch (e) {
        iconEl.textContent = '❌';
        msgEl.textContent = '无法获取登录状态';
    }
}

/**
 * 更新头部登录状态按钮
 */
function updateHeaderLoginStatus(status) {
    const icon = $('#loginStatusIcon');
    const text = $('#loginStatusText');

    if (status.loggedIn) {
        icon.className = 'status-dot online';
        text.textContent = '已登录';
    } else {
        icon.className = 'status-dot offline';
        text.textContent = '未登录';
    }
}

/**
 * 更新登录弹窗 UI（统一管理两种模式的状态）
 */
function updateLoginUI(status) {
    const iconEl = $('#loginModalIcon');
    const msgEl = $('#loginModalMsg');
    const startCodeBtn = $('#startCodeBtn');
    const startQrBtn = $('#startQrBtn');
    const cancelBtn = $('#cancelQrBtn');
    const logoutBtn = $('#logoutBtn');
    const qrArea = $('#qrArea');

    // 重置公共状态
    cancelBtn.classList.add('hidden');
    stopQrPolling();

    if (status.loggedIn) {
        iconEl.textContent = '✅';
        msgEl.innerHTML = '<span style="color:var(--accent-green);font-weight:600">已登录</span><br><span style="font-size:0.82rem;color:var(--text-muted)">' + (status.info || 'Telegram 账号已认证') + '</span>';
        startCodeBtn.classList.add('hidden');
        startQrBtn.classList.add('hidden');
        $('#submitCodeBtn').classList.add('hidden');
        $('#submit2faBtn').classList.add('hidden');
        logoutBtn.classList.remove('hidden');
    } else if (status.processing && state.loginMode === 'qr') {
        iconEl.textContent = '📱';
        msgEl.textContent = '正在等待扫码...';
        startQrBtn.classList.add('hidden');
        cancelBtn.classList.remove('hidden');
        qrArea.classList.remove('hidden');
        startQrPolling();
    } else {
        iconEl.textContent = '🔒';
        msgEl.innerHTML = '未登录<br><span style="font-size:0.8rem;color:var(--text-muted)">需要登录后才能下载文件</span>';
        if (state.loginMode === 'code') {
            startCodeBtn.classList.remove('hidden');
        } else {
            startQrBtn.classList.remove('hidden');
        }
        logoutBtn.classList.add('hidden');
    }
}

// ==================== 验证码登录流程 ====================

/**
 * 发送手机号，启动验证码登录
 */
async function sendPhoneCode() {
    const phoneInput = $('#phoneInput');
    const btn = $('#startCodeBtn');
    const phone = phoneInput.value.trim();

    if (!phone) {
        shakeElement(phoneInput);
        phoneInput.focus();
        return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ 发送中...';

    try {
        const res = await fetch('/api/login/code/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || '发送失败');
        }

        // 切换到验证码输入界面
        $('#phoneStep').classList.add('hidden');
        $('#codeStep').classList.remove('hidden');
        $('#codeHint').textContent = data.hint || `验证码已发送到 ${phone}`;
        $('#codeInput').value = '';
        $('#codeInput').focus();

        btn.classList.add('hidden');
        $('#submitCodeBtn').classList.remove('hidden');

        // 更新状态提示
        $('#loginModalIcon').textContent = '📲';
        $('#loginModalMsg').innerHTML = '<span style="color:var(--accent-cyan)">验证码已发送</span><br><span style="font-size:0.82rem;color:var(--text-muted)">请查看 Telegram 应用</span>';

        // 开始轮询登录状态
        startQrPolling();

    } catch (e) {
        alert(e.message);
        btn.disabled = false;
        btn.textContent = '📱 发送验证码';
    }
}

/**
 * 提交验证码
 */
async function submitVerificationCode() {
    const codeInput = $('#codeInput');
    const code = codeInput.value.trim();

    if (!code) {
        shakeElement(codeInput);
        codeInput.focus();
        return;
    }

    const btn = $('#submitCodeBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 验证中...';

    try {
        const res = await fetch('/api/login/code/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, type: 'code' })
        });
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || '提交失败');
        }

        $('#loginModalIcon').textContent = '⏳';
        $('#loginModalMsg').textContent = data.hint || '正在验证...';

        // 等待一下再检查结果
        setTimeout(() => checkLoginStatus(), 3000);

    } catch (e) {
        alert(e.message);
        btn.disabled = false;
        btn.textContent = '✓ 确认验证码';
    }
}

/**
 * 提交两步验证密码
 */
async function submitTwoFactorPassword() {
    const twoFaInput = $('#twoFaInput');
    const password = twoFaInput.value.trim();

    if (!password) {
        shakeElement(twoFaInput);
        twoFaInput.focus();
        return;
    }

    const btn = $('#submit2faBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 验证中...';

    try {
        const res = await fetch('/api/login/code/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: password, type: '2fa' })
        });
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || '提交失败');
        }

        $('#loginModalIcon').textContent = '⏳';
        $('#loginModalMsg').textContent = '正在验证密码...';

        setTimeout(() => checkLoginStatus(), 3000);

    } catch (e) {
        alert(e.message);
        btn.disabled = false;
        btn.textContent = '🔑 确认密码';
    }
}

// ==================== 扫码登录流程 ====================

/**
 * 启动扫码登录
 */
let qrEventSource = null; // SSE 连接引用

async function startQrLogin() {
    const startBtn = $('#startQrBtn');
    startBtn.disabled = true;
    startBtn.textContent = '⏳ 启动终端...';

    try {
        const res = await fetch('/api/login/qr', { method: 'POST' });
        const data = await res.json();

        if (!data.success) {
            if (data.noPty) {
                throw new Error(data.error || 'node-pty 不可用');
            }
            if (data.needsRetry) {
                $('#loginModalIcon').textContent = '🔒';
                $('#loginModalMsg').innerHTML = '<span style="color:var(--accent-orange)">数据库被占用</span><br><span style="font-size:0.82rem;color:var(--text-muted)">正在清理残留进程，请 <b id="retryCountdown">3</b> 秒后点击重试</span>';
                startBtn.disabled = true;
                let count = 3;
                const timer = setInterval(() => { count--; const cd = $('#retryCountdown'); if(cd) cd.textContent=count; if(count<=0){ clearInterval(timer); startBtn.disabled=false; startBtn.textContent='📱 获取二维码'; } }, 1000);
                return;
            }
            throw new Error(data.error || '启动登录失败');
        }

        // 流式模式：立即显示终端窗口，通过 SSE 接收实时输出
        if (data.streaming) {
            console.log('[QR] Streaming mode, loginId:', data.loginId);
            showLiveTerminal();
            updateLoginUI({ processing: true });
            $('#loginModalIcon').textContent = '🖥️';
            $('#loginModalMsg').innerHTML = '<span style="color:var(--accent-cyan)">正在连接 Telegram...</span><br><span style="font-size:0.8rem;color:var(--text-muted)">终端已启动，等待二维码显示（需 5-15 秒）</span>';
            
            // 建立 SSE 连接接收 TTY 输出
            connectQrStream(data.loginId);
        } else {
            throw new Error('不支持的登录模式');
        }

    } catch (e) {
        alert('启动扫码登录失败: ' + e.message);
        startBtn.disabled = false;
        startBtn.textContent = '📱 获取二维码';
    }
}

/**
 * 显示实时 TTY 终端窗口
 */
function showLiveTerminal() {
    const qrArea = $('#qrArea');
    qrArea.classList.remove('hidden');

    // 清理旧内容
    const oldTerm = $('#qrTerminal');
    if (oldTerm) oldTerm.remove();
    const canvas = $('#qrCanvas');
    if (canvas) canvas.style.display = 'none';
    const fallback = $('#qrFallback');
    if (fallback) fallback.classList.add('hidden');

    // 创建终端元素
    const termEl = document.createElement('pre');
    termEl.id = 'qrTerminal';
    termEl.className = 'qr-terminal qr-terminal-live';
    termEl.textContent = '';

    const container = $('.qr-container');
    if (container) {
        container.insertBefore(termEl, container.firstChild);
    }

    // 倒计时
    let seconds = 120;
    const timerEl = $('#qrTimer');
    if (timerEl) {
        timerEl.textContent = '二维码有效期: ' + seconds + ' 秒';
        clearInterval(window._qrTimerInterval);
        window._qrTimerInterval = setInterval(() => {
            seconds--;
            if (seconds > 0 && state.loginModalOpen) {
                timerEl.textContent = '二维码有效期: ' + seconds + ' 秒';
            } else {
                clearInterval(window._qrTimerInterval);
                if (!state.loginStatus?.loggedIn) {
                    timerEl.textContent = '⏰ 二维码已过期，请重新获取';
                }
            }
        }, 1000);
    }
}

/**
 * 通过 SSE 连接 TTY 输出流
 */
function connectQrStream(loginId) {
    // 关闭旧连接
    if (qrEventSource) { qrEventSource.close(); }
    
    const termEl = $('#qrTerminal');
    if (!termEl) return;

    qrEventSource = new EventSource('/api/login/qr/stream?loginId=' + loginId);

    qrEventSource.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            
            if (msg.type === 'output') {
                if (msg.full) {
                    // 完整数据替换
                    termEl.textContent = msg.text;
                } else {
                    // 追加新数据
                    termEl.textContent += msg.text;
                }
                
                // 自动滚动到底部
                termEl.scrollTop = termEl.scrollHeight;

                // 检测到 QR 图形后更新提示
                if (/████|▄▄|▀▀/.test(termEl.textContent)) {
                    $('#loginModalIcon').textContent = '📱';
                    $('#loginModalMsg').innerHTML = '<span style="color:var(--accent-green)">二维码已显示 ↑</span><br><span style="font-size:0.8rem;color:var(--text-muted)">打开 Telegram → 设置 → 设备 → 扫描屏幕上的二维码</span>';
                }
            }
            
            if (msg.type === 'exit') {
                console.log('[stream] Exit event, loggedIn:', msg.loggedIn, 'output:', (msg.output||'').slice(0,100));
                qrEventSource.close();
                qrEventSource = null;
                
                // 确保显示最终输出
                if (msg.output && termEl) {
                    termEl.textContent = msg.output;
                }
                
                // 多重判断是否登录成功：
                // 1. 后端明确标记 loggedIn=true
                // 2. 输出文本包含成功关键词（兜底）
                const outputText = msg.output || '';
                const detectedSuccess = /login.*success|authorized|已登录|logged.*in|Login successful/i.test(outputText);
                const isActuallyLoggedIn = msg.loggedIn || detectedSuccess;

                // 检测常见错误
                const hasTokenExpired = /AUTH_TOKEN_EXPIRED|token.*expired|token过期/i.test(outputText);
                const hasDbLock = /database is used by another process/i.test(outputText);
                const hasNetworkError = /connection|timeout|network|ECONNREFUSED/i.test(outputText);

                if (isActuallyLoggedIn) {
                    // 登录成功 —— 立即更新 UI
                    $('#loginModalIcon').textContent = '✅';
                    $('#loginModalMsg').innerHTML = '<span style="color:var(--accent-green);font-weight:600">✅ 登录成功！</span><br><span style="font-size:0.82rem;color:var(--text-muted)">正在跳转...</span>';
                    
                    // 更新头部状态
                    state.loginStatus = { loggedIn: true, info: '已通过扫码登录' };
                    updateHeaderLoginStatus({ loggedIn: true });
                    
                    // 清理终端和倒计时
                    clearInterval(window._qrTimerInterval);
                    const timerEl = $('#qrTimer');
                    if (timerEl) timerEl.textContent = '';
                    
                    // 延迟关闭弹窗并刷新状态
                    setTimeout(() => {
                        checkLoginStatus();
                        closeLoginModal();
                    }, 1500);
                } else if (hasTokenExpired) {
                    // QR Token 过期 - 但 session 可能已部分建立，尝试检查状态
                    $('#loginModalIcon').textContent = '⏳';
                    $('#loginModalMsg').innerHTML = '<span style="color:var(--accent-orange)">扫码确认但授权令牌过期</span><br><span style="font-size:0.8rem;color:var(--text-muted)">正在检查是否已登录...</span>';
                    
                    // 延迟 2 秒后尝试检测（给 tdl 时间写完 session 文件）
                    setTimeout(async () => {
                        try {
                            const res = await fetch('/api/login/status');
                            const status = await res.json();
                            console.log('[stream] Post-token-expire check:', JSON.stringify(status));
                            if (status.loggedIn) {
                                // 实际上已经登录成功了！
                                state.loginStatus = status;
                                updateHeaderLoginStatus(status);
                                $('#loginModalIcon').textContent = '✅';
                                $('#loginModalMsg').innerHTML = '<span style="color:var(--accent-green);font-weight:600">✅ 登录成功！</span><br><span style="font-size:0.82rem;color:var(--text-muted)">Session 已自动恢复</span>';
                                clearInterval(window._qrTimerInterval);
                                setTimeout(() => closeLoginModal(), 2000);
                            } else {
                                // 确实没登录
                                $('#loginModalIcon').textContent = '⏰';
                                $('#loginModalMsg').innerHTML = '<span style="color:var(--accent-orange)">二维码已过期</span><br><span style="font-size:0.8rem;color:var(--text-muted)">请重新获取二维码或切换到验证码登录</span>';
                                const btn = $('#startQrBtn');
                                if (btn) { 
                                    btn.disabled = false; 
                                    btn.textContent = '📱 重新获取二维码'; 
                                }
                            }
                        } catch(e) {
                            // 检查失败，显示重试
                            const btn = $('#startQrBtn');
                            if (btn) { 
                                btn.disabled = false; 
                                btn.textContent = '📱 重新获取二维码'; 
                            }
                            $('#loginModalMsg').innerHTML += '\n<span style="font-size:0.75rem;color:var(--accent-cyan);display:block;margin-top:4px">💡 提示：验证码登录更稳定</span>';
                        }
                    }, 2000);
                } else if (hasDbLock) {
                    $('#loginModalIcon').textContent = '🔒';
                    $('#loginModalMsg').innerHTML = '<span style="color:var(--accent-orange)">数据库被占用</span><br><span style="font-size:0.8rem;color:var(--text-muted)">请等待 3 秒后重试</span>';
                    const btn = $('#startQrBtn');
                    if (btn) { btn.disabled = true; }
                    let count = 3;
                    const timer = setInterval(() => { 
                        count--; 
                        if(count <= 0){ 
                            clearInterval(timer); 
                            const b = $('#startQrBtn');
                            if(b) { b.disabled = false; b.textContent = '📱 获取二维码'; }
                        } 
                    }, 1000);
                } else {
                    $('#loginModalMsg').innerHTML = '<span style="color:var(--accent-orange)">会话已结束</span><br><span style="font-size:0.8rem;color:var(--text-muted)">可能超时或被取消，请重新获取二维码</span>';
                    const btn = $('#startQrBtn');
                    if (btn) { btn.disabled = false; btn.textContent = '📱 获取二维码'; }
                }
            }
        } catch(e) {
            console.error('[stream] Parse error:', e);
        }
    };

    qrEventSource.onerror = (e) => {
        console.error('[stream] SSE error:', e);
        // 不要立即关闭——可能是短暂的网络波动
    };
}

/**
 * 显示二维码（使用 qrcode.js 库）
 */
/**
 * 显示终端渲染的 Unicode 二维码图形（来自 node-pty 的 TTY 输出）
 */
function showTerminalQR(rawOutput) {
    const container = $('#qrArea');
    let terminalEl = $('#qrTerminal');
    
    console.log('[QR] showTerminalQR called, rawOutput length:', rawOutput ? rawOutput.length : 'null/undefined');
    
    // 清理旧内容
    if (terminalEl) terminalEl.remove();
    const canvas = $('#qrCanvas');
    if (canvas) canvas.style.display = 'none';
    const fallback = $('#qrFallback');
    if (fallback) fallback.classList.add('hidden');

    // 创建终端显示元素
    terminalEl = document.createElement('pre');
    terminalEl.id = 'qrTerminal';
    terminalEl.className = 'qr-terminal';
    // 提取 QR 图形部分（包含 █ 和 ▄ 字符的行）
    const lines = rawOutput.split('\n').filter(line => /[█▀▄]/.test(line));
    console.log('[QR] Total lines:', rawOutput.split('\n').length, 'QR lines matched:', lines.length);
    if (lines.length > 0) {
        console.log('[QR] First QR line sample:', JSON.stringify(lines[0].substring(0, 50)));
    }
    terminalEl.textContent = lines.length > 0 ? lines.join('\n') : rawOutput;
    
    // 插入到容器
    const qrContainer = $('.qr-container');
    if (qrContainer) {
        qrContainer.insertBefore(terminalEl, qrContainer.firstChild);
    }

    // 倒计时
    let seconds = 120;
    const timerEl = $('#qrTimer');
    timerEl.textContent = '二维码有效期: ' + seconds + ' 秒';
    const countdown = setInterval(() => {
        seconds--;
        if (seconds > 0 && state.loginModalOpen) {
            timerEl.textContent = '二维码有效期: ' + seconds + ' 秒';
        } else {
            clearInterval(countdown);
            if (!state.loginStatus.loggedIn) {
                timerEl.textContent = '⏰ 二维码已过期，请重新获取';
            }
        }
    }, 1000);
}

function showQRCode(qrLink) {
    const canvas = $('#qrCanvas');
    const fallback = $('#qrFallback');

    if (typeof QRCode !== 'undefined' && canvas) {
        try {
            canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            QRCode.toCanvas(canvas, qrLink, {
                width: 200,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' }
            }, function(err) {
                if (err) {
                    console.warn('[QR] Canvas 渲染失败:', err);
                    if (canvas) canvas.style.display = 'none';
                    fallback.classList.remove('hidden');
                }
            });
        } catch (e) {
            console.warn('[QR] 生成失败:', e);
            if (canvas) canvas.style.display = 'none';
            fallback.classList.remove('hidden');
        }
    }

    // 启动倒计时
    let seconds = 120;
    const timerEl = $('#qrTimer');
    timerEl.textContent = `二维码有效期: ${seconds} 秒`;

    const countdown = setInterval(() => {
        seconds--;
        if (seconds > 0 && state.loginModalOpen) {
            timerEl.textContent = `二维码有效期: ${seconds} 秒`;
        } else {
            clearInterval(countdown);
            if (!state.loginStatus.loggedIn) {
                timerEl.textContent = '⏰ 二维码已过期，请重新获取';
            }
        }
    }, 1000);
}

/**
 * 轮询登录状态
 */
function startQrPolling() {
    stopQrPolling();
    let pollCount = 0;
    state.qrPollInterval = setInterval(async () => {
        pollCount++;
        try {
            const res = await fetch('/api/login/status');
            const status = await res.json();

            if (status.loggedIn || (!status.processing)) {
                stopQrPolling();
                state.loginStatus = status;
                updateLoginUI(status);
                updateHeaderLoginStatus(status);

                if (status.loggedIn) {
                    const msgEl = $('#loginModalMsg');
                    msgEl.innerHTML = '<span style="color:var(--accent-green);font-weight:600">✅ 登录成功！</span><br><span style="font-size:0.82rem;color:var(--text-muted)">现在可以开始下载了</span>';
                    setTimeout(() => closeLoginModal(), 3000);
                }
            }

            if (pollCount > 120) { // 最多轮询5分钟
                stopQrPolling();
            }
        } catch (e) { /* ignore */ }
    }, 2500);
}

function stopQrPolling() {
    if (state.qrPollInterval) {
        clearInterval(state.qrPollInterval);
        state.qrPollInterval = null;
    }
}

/**
 * 取消登录
 */
async function cancelQrLogin() {
    stopQrPolling();
    try {
        await fetch('/api/login/cancel', { method: 'POST' });
    } catch (e) { /* ignore */ }

    // 重置 code 登录 UI
    $('#phoneStep').classList.remove('hidden');
    $('#codeStep').classList.add('hidden');
    $('#twoFaStep').classList.add('hidden');
    $('#phoneInput').value = '';
    $('#codeInput').value = '';
    $('#twoFaInput').value = '';

    checkLoginStatus();
}

/**
 * 退出登录
 */
async function doLogout() {
    if (!confirm('确定要退出 Telegram 登录吗？')) return;

    try {
        await fetch('/api/logout', { method: 'DELETE' });
        state.loginStatus = { loggedIn: false };
        updateHeaderLoginStatus({ loggedIn: false });

        // 重置所有输入和步骤
        $('#phoneStep').classList.remove('hidden');
        $('#codeStep').classList.add('hidden');
        $('#twoFaStep').classList.add('hidden');
        $('#phoneInput').value = '';
        $('#codeInput').value = '';
        $('#twoFaInput').value = '';

        switchLoginMode('code');
        checkLoginStatus();
    } catch (e) {
        alert('退出失败: ' + e.message);
    }
}

/**
 * 输入错误时的抖动动画
 */
function shakeElement(el) {
    el.style.animation = 'none';
    void el.offsetWidth; // 触发 reflow
    el.style.animation = 'shake 0.4s ease';
    el.style.borderColor = 'var(--accent-red)';
    setTimeout(() => { el.style.borderColor = ''; }, 1500);
}

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', async () => {
    renderHistory();

    // 从后端加载代理配置
    await loadProxyFromBackend();

    // 检查登录状态
    try {
        const loginRes = await fetch('/api/login/status');
        const loginData = await loginRes.json();
        state.loginStatus = loginData;
        updateHeaderLoginStatus(loginData);
    } catch (e) { /* ignore */ }

    // 自动聚焦输入框
    setTimeout(() => $('#tgUrl').focus(), 300);
});
