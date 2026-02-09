// 建立Socket连接
const socket = io();

// DOM元素
const welcomeScreen = document.getElementById('welcomeScreen');
const waitingScreen = document.getElementById('waitingScreen');
const chatScreen = document.getElementById('chatScreen');
const startMatchingBtn = document.getElementById('startMatchingBtn');
const cancelMatchingBtn = document.getElementById('cancelMatchingBtn');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const skipMatchBtn = document.getElementById('skipMatchBtn');
const rematchBtn = document.getElementById('rematchBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const waitingCountElement = document.getElementById('waitingCount');
const waitingTimeElement = document.getElementById('waitingTime');
const waitingMessageElement = document.getElementById('waitingMessage');
const partnerNameElement = document.getElementById('partnerName');
const usernameElement = document.getElementById('username');
const partnerAvatarElement = document.getElementById('partnerAvatar');
const partnerGenderElement = document.getElementById('partnerGender');
const connectionStatusElement = document.getElementById('connectionStatus');
const globalStatusIndicator = document.getElementById('globalStatusIndicator');
const globalStatusText = document.getElementById('globalStatusText');

// 状态变量
let currentUser = null;
let user = null;
let currentPartner = null;
let waitingStartTime = null;
let waitingTimer = null;
let messageCount = 0;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 设置按钮事件
    startMatchingBtn.addEventListener('click', startMatching);
    cancelMatchingBtn.addEventListener('click', cancelMatching);
    sendMessageBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    skipMatchBtn.addEventListener('click', skipMatch);
    rematchBtn.addEventListener('click', rematch);
    disconnectBtn.addEventListener('click', disconnect);
    
    // 初始状态
    updateGlobalStatus('disconnected', '未连接');
});

// Socket事件监听
socket.on('connect', () => {
    console.log('已连接到服务器');
    updateGlobalStatus('connected', '已连接');
});

socket.on('connected', (data) => {
    console.log('服务器连接确认:', data.message);
});

socket.on('disconnect', () => {
    console.log('与服务器断开连接');
    updateGlobalStatus('disconnected', '已断开');
    showScreen('welcomeScreen');
});

socket.on('error', (data) => {
    console.error('服务器错误:', data.message);
    alert('错误: ' + data.message);
});

socket.on('preferencesSet', (data) => {
    console.log('偏好设置成功:', data.message);
    currentUser = data.userInfo;
    showScreen('waitingScreen');
    startWaitingTimer();
});

socket.on('needPreferences', (data) => {
    alert(data.message);
    showScreen('welcomeScreen');
});

socket.on('waitingForMatch', (data) => {
    console.log('等待匹配:', data.message);
    partnerNameElement.textContent = currentUser.username;
    waitingMessageElement.textContent = data.message;
    waitingCountElement.textContent = data.waitingCount || 0;
});

socket.on('waitingUpdate', (data) => {
    waitingCountElement.textContent = data.waitingCount || 0;
});

socket.on('waitingCount', (data) => {
    waitingCountElement.textContent = data.count || 0;
});

socket.on('matchFound', (data) => {
    console.log('匹配成功:', data.message);
    currentPartner = data.partner;
    stopWaitingTimer();
    
    // 更新界面显示伙伴信息
    partnerNameElement.textContent = currentPartner.username;
    partnerGenderElement.textContent = `性别: ${currentPartner.gender}`;
    partnerAvatarElement.style.background = `linear-gradient(135deg, ${currentPartner.color} 0%, ${adjustColor(currentPartner.color, -20)} 100%)`;
    partnerAvatarElement.innerHTML = `<i class="fas fa-user"></i>`;
    
    // 显示聊天界面
    showScreen('chatScreen');
    
    // 清空消息区域，显示欢迎消息
    chatMessages.innerHTML = '';
    addSystemMessage(data.message);
    addSystemMessage(`您正在与 ${currentPartner.username} 聊天，对方性别: ${currentPartner.gender}`);
    addSystemMessage(`(您的昵称： ${currentUser.username})`);
    
    // 聚焦到消息输入框
    messageInput.focus();
});

socket.on('alreadyMatched', (data) => {
    console.log('已在聊天室中');
    currentPartner = data.partner;
    
    
    // 更新界面显示伙伴信息
    
    partnerGenderElement.textContent = `性别: ${currentPartner.gender}`;
    partnerAvatarElement.style.background = `linear-gradient(135deg, ${currentPartner.color} 0%, ${adjustColor(currentPartner.color, -20)} 100%)`;
    partnerAvatarElement.innerHTML = `<i class="fas fa-user"></i>`;
    
    // 显示聊天界面
    showScreen('chatScreen');
    addSystemMessage('重新连接到聊天室');
    addSystemMessage(`您正在与 ${currentPartner.username} 聊天`);
    
    messageInput.focus();
});

socket.on('newMessage', (data) => {
    console.log('收到新消息:', data);
    addMessage(data, false);
    messageCount++;
});

socket.on('messageSent', (data) => {
    console.log('消息发送成功:', data);
    addMessage(data, true);
    messageCount++;
});

socket.on('partnerLeft', (data) => {
    console.log('对方离开:', data.message);
    addSystemMessage(data.message);
    connectionStatusElement.textContent = '对方已离开';
});

socket.on('partnerDisconnected', (data) => {
    console.log('对方断开连接:', data.message);
    addSystemMessage(data.message);
    connectionStatusElement.textContent = '对方已断开';
    
    // 显示重新匹配按钮
    setTimeout(() => {
        addSystemMessage('对方已断开连接，您可以点击"重新匹配"寻找新伙伴');
    }, 1000);
});

socket.on('partnerSkipped', (data) => {
    console.log('对方跳过匹配:', data.message);
    addSystemMessage(data.message);
    connectionStatusElement.textContent = '对方已跳过';
    
    setTimeout(() => {
        addSystemMessage('对方跳过了本次匹配，您可以点击"重新匹配"寻找新伙伴');
    }, 1000);
});

socket.on('matchSkipped', (data) => {
    console.log('跳过匹配:', data.message);
    showScreen('waitingScreen');
    waitingMessageElement.textContent = data.message;
    waitingCountElement.textContent = data.waitingCount || 0;
    startWaitingTimer();
});

// 开始匹配
function startMatching() {
    // 获取用户选择的性别和匹配偏好
    const gender = document.querySelector('input[name="gender"]:checked').value;
    const matchPreference = document.querySelector('input[name="matchPreference"]:checked').value;
    
    console.log('用户选择:', { gender, matchPreference });
    
    // 发送设置到服务器
    socket.emit('setPreferences', { gender, matchPreference });
}

// 取消匹配
function cancelMatching() {
    // 断开socket连接（会自动触发重连）
    socket.disconnect();
    socket.connect();
    
    showScreen('welcomeScreen');
    stopWaitingTimer();
}

// 发送消息
function sendMessage() {
    const message = messageInput.value.trim();
    
    if (message) {
        socket.emit('sendMessage', { message });
        messageInput.value = '';
        messageInput.focus();
    }
}

// 跳过当前匹配
function skipMatch() {
    if (confirm('确定要跳过当前匹配并寻找新的伙伴吗？')) {
        socket.emit('skipMatch');
    }
}

// 重新匹配
function rematch() {
    if (confirm('确定要断开当前连接并重新匹配吗？')) {
        socket.emit('rematch');
        showScreen('waitingScreen');
        startWaitingTimer();
    }
}

// 断开连接
function disconnect() {
    if (confirm('确定要断开连接并退出聊天吗？')) {
        socket.disconnect();
        location.reload(); // 重新加载页面
    }
}

// 添加消息到聊天区域
function addMessage(data, isOwn) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isOwn ? 'own-message' : 'other-message'}`;
    
    const senderName = isOwn ? '您' : data.senderName;
    
    messageElement.innerHTML = `
        <div class="message-header">
            <div class="message-sender" style="color: ${isOwn ? '#ffffff' : data.senderColor}">
                <i class="fas fa-user-circle"></i> ${senderName}
            </div>
            <div class="message-time">${data.timestamp}</div>
        </div>
        <div class="message-content">${formatMessage(data.message)}</div>
    `;
    
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 添加系统消息
function addSystemMessage(text) {
    const systemMessage = document.createElement('div');
    systemMessage.className = 'message system-message';
    systemMessage.textContent = text;
    
    chatMessages.appendChild(systemMessage);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 显示特定屏幕
function showScreen(screenName) {
    // 隐藏所有屏幕
    welcomeScreen.classList.remove('active');
    waitingScreen.classList.remove('active');
    chatScreen.classList.remove('active');
    
    // 显示目标屏幕
    document.getElementById(screenName).classList.add('active');
}

// 开始等待计时器
function startWaitingTimer() {
    waitingStartTime = Date.now();
    updateWaitingTime();
    
    if (waitingTimer) {
        clearInterval(waitingTimer);
    }
    
    waitingTimer = setInterval(updateWaitingTime, 1000);
    
    // 获取当前等待人数
    socket.emit('getWaitingCount');
}

// 更新等待时间
function updateWaitingTime() {
    if (!waitingStartTime) return;
    
    const elapsedSeconds = Math.floor((Date.now() - waitingStartTime) / 1000);
    waitingTimeElement.textContent = elapsedSeconds;
    
    // 每10秒更新一次等待人数
    if (elapsedSeconds % 10 === 0) {
        socket.emit('getWaitingCount');
    }
}

// 停止等待计时器
function stopWaitingTimer() {
    if (waitingTimer) {
        clearInterval(waitingTimer);
        waitingTimer = null;
    }
    waitingStartTime = null;
}

// 更新全局连接状态
function updateGlobalStatus(status, text) {
    globalStatusIndicator.className = 'status-indicator';
    globalStatusText.textContent = text;
    
    switch(status) {
        case 'connected':
            globalStatusIndicator.classList.add('active');
            globalStatusIndicator.style.backgroundColor = '#4CAF50';
            break;
        case 'connecting':
            globalStatusIndicator.style.backgroundColor = '#FFC107';
            break;
        case 'disconnected':
            globalStatusIndicator.style.backgroundColor = '#F44336';
            break;
    }
}

// 格式化消息内容
function formatMessage(text) {
    // 处理 @提及
    let formattedText = text.replace(/@(\w+[\u4e00-\u9fa5\w\s]*)/g, '<span class="mention">@$1</span>');
    
    // 处理链接
    formattedText = formattedText.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    
    // 换行处理
    formattedText = formattedText.replace(/\n/g, '<br>');
    
    return formattedText;
}

// 调整颜色亮度
function adjustColor(color, amount) {
    let usePound = false;
    
    if (color[0] === "#") {
        color = color.slice(1);
        usePound = true;
    }
    
    const num = parseInt(color, 16);
    let r = (num >> 16) + amount;
    let g = ((num >> 8) & 0x00FF) + amount;
    let b = (num & 0x0000FF) + amount;
    
    r = Math.min(Math.max(0, r), 255);
    g = Math.min(Math.max(0, g), 255);
    b = Math.min(Math.max(0, b), 255);
    
    return (usePound ? "#" : "") + (b | (g << 8) | (r << 16)).toString(16).padStart(6, '0');
}

// 添加CSS样式
const style = document.createElement('style');
style.textContent = `
    .mention {
        background-color: rgba(0, 173, 181, 0.3);
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: bold;
    }
    
    .message-content a {
        color: #00adb5;
        text-decoration: underline;
    }
    
    .message-content a:hover {
        color: #0099a1;
    }
`;
document.head.appendChild(style);