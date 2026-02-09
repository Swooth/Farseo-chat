const express = require('express');
const socketio = require('socket.io');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// 设置静态文件目录
app.use(express.static(path.join(__dirname, 'public')));

// 存储等待匹配的用户
let waitingUsers = new Map();
// 存储活跃的聊天房间
let activeRooms = new Map();
// 存储用户信息
let userSessions = new Map();

// 生成随机用户名
const generateUsername = () => {
  const adjectives = ['匿名', '神秘', '快乐', '安静', '好奇', '活泼', '温柔', '勇敢', '聪明', '幽默'];
  const nouns = ['熊猫', '猫咪', '狐狸', '鲸鱼', '兔子', '海豚', '老虎', '狮子', '企鹅', '考拉'];
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${randomAdjective}的${randomNoun}`;
};

// 生成随机颜色
const generateColor = () => {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', 
    '#118AB2', '#EF476F', '#073B4C', '#7209B7',
    '#3A86FF', '#FB5607'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

// 匹配算法
const findMatch = (userInfo) => {
  for (let [socketId, waitingUser] of waitingUsers.entries()) {
    // 检查双方是否满足对方的匹配条件
    const user1 = userInfo;
    const user2 = waitingUser;
    
    // 用户1的性别是否符合用户2的偏好
    const user2PrefMet = user2.matchPreference === '随机' || user2.matchPreference === user1.gender;
    
    // 用户2的性别是否符合用户1的偏好
    const user1PrefMet = user1.matchPreference === '随机' || user1.matchPreference === user2.gender;
    
    // 如果双方都满足对方的条件，则匹配成功
    if (user1PrefMet && user2PrefMet && socketId !== userInfo.id) {
      return { matchedUser: user2, matchedSocketId: socketId };
    }
  }
  return null;
};

// 创建聊天房间
const createChatRoom = (user1, user2, socketId1, socketId2) => {
  const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // 存储房间信息
  activeRooms.set(roomId, {
    users: [
      { id: socketId1, ...user1 },
      { id: socketId2, ...user2 }
    ],
    createdAt: new Date(),
    messages: []
  });
  
  // 更新用户会话信息
  userSessions.set(socketId1, { ...userSessions.get(socketId1), roomId, partner: user2 });
  userSessions.set(socketId2, { ...userSessions.get(socketId2), roomId, partner: user1 });
  
  // 将两个用户加入房间
  io.sockets.sockets.get(socketId1)?.join(roomId);
  io.sockets.sockets.get(socketId2)?.join(roomId);
  
  // 从等待队列中移除
  waitingUsers.delete(socketId1);
  waitingUsers.delete(socketId2);
  
  return roomId;
};

// Socket.io 连接处理
io.on('connection', (socket) => {
  console.log('新用户连接:', socket.id);
  
  // 初始化用户会话
  userSessions.set(socket.id, {
    id: socket.id,
    isMatched: false,
    roomId: null,
    partner: null
  });
  
  // 发送连接确认
  socket.emit('connected', { message: '已连接到匹配服务器', socketId: socket.id });
  
  // 处理用户设置（性别和匹配偏好）
  socket.on('setPreferences', (data) => {
    const { gender, matchPreference } = data;
    
    // 验证数据
    if (!['男', '女', '其他'].includes(gender) || !['男', '女', '不限'].includes(matchPreference)) {
      socket.emit('error', { message: '无效的性别或匹配偏好设置' });
      return;
    }
    
    // 创建用户信息
    const userInfo = {
      id: socket.id,
      username: generateUsername(),
      color: generateColor(),
      gender,
      matchPreference,
      joinedAt: new Date()
    };
    
    // 更新用户会话
    userSessions.set(socket.id, { 
      ...userSessions.get(socket.id), 
      ...userInfo,
      isMatched: false
    });
    
    // 检查是否已经有匹配
    const existingRoom = userSessions.get(socket.id)?.roomId;
    if (existingRoom) {
      // 如果已经在房间中，通知用户
      const room = activeRooms.get(existingRoom);
      if (room) {
        const partner = room.users.find(u => u.id !== socket.id);
        socket.emit('alreadyMatched', { 
          partner: partner,
          roomId: existingRoom
        });
        return;
      }
    }
    
    // 发送确认
    socket.emit('preferencesSet', { 
      message: '偏好设置成功，正在寻找匹配...',
      userInfo: userInfo
    });
    
    // 将用户加入等待队列
    waitingUsers.set(socket.id, userInfo);
    
    // 尝试匹配
    const match = findMatch(userInfo);
    
    if (match) {
      // 找到匹配，创建房间
      const roomId = createChatRoom(userInfo, match.matchedUser, socket.id, match.matchedSocketId);
      
      // 通知双方匹配成功
      io.to(socket.id).emit('matchFound', {
        message: '匹配成功！开始聊天吧！',
        partner: match.matchedUser,
        roomId: roomId
      });
      
      io.to(match.matchedSocketId).emit('matchFound', {
        message: '匹配成功！开始聊天吧！',
        partner: userInfo,
        roomId: roomId
      });
      
      console.log(`匹配成功: ${socket.id} 和 ${match.matchedSocketId} 在房间 ${roomId}`);
    } else {
      // 没有找到匹配，等待
      const waitingCount = waitingUsers.size;
      socket.emit('waitingForMatch', {
        message: `正在寻找匹配... (当前等待人数: ${waitingCount})`,
        waitingCount: waitingCount
      });
    }
  });
  
  // 处理重新匹配请求
  socket.on('rematch', () => {
    const userSession = userSessions.get(socket.id);
    
    // 如果已经在房间中，先离开
    if (userSession?.roomId) {
      // 通知对方用户已离开
      const room = activeRooms.get(userSession.roomId);
      if (room) {
        const partner = room.users.find(u => u.id !== socket.id);
        if (partner) {
          io.to(partner.id).emit('partnerLeft', { 
            message: '对方已断开连接，正在寻找新匹配...' 
          });
          // 将对方移出房间，放回等待队列
          if (userSessions.has(partner.id)) {
            const partnerSession = userSessions.get(partner.id);
            waitingUsers.set(partner.id, {
              id: partner.id,
              username: partnerSession.username || generateUsername(),
              color: partnerSession.color || generateColor(),
              gender: partnerSession.gender,
              matchPreference: partnerSession.matchPreference
            });
            io.to(partner.id).emit('waitingForMatch', {
              message: '正在寻找新的匹配...',
              waitingCount: waitingUsers.size
            });
          }
        }
      }
      
      // 清理房间
      activeRooms.delete(userSession.roomId);
    }
    
    // 更新用户状态
    userSessions.set(socket.id, {
      ...userSession,
      isMatched: false,
      roomId: null,
      partner: null
    });
    
    // 如果用户有设置，重新加入等待队列
    if (userSession?.gender && userSession?.matchPreference) {
      const userInfo = {
        id: socket.id,
        username: userSession.username || generateUsername(),
        color: userSession.color || generateColor(),
        gender: userSession.gender,
        matchPreference: userSession.matchPreference
      };
      
      waitingUsers.set(socket.id, userInfo);
      
      // 尝试匹配
      const match = findMatch(userInfo);
      
      if (match) {
        const roomId = createChatRoom(userInfo, match.matchedUser, socket.id, match.matchedSocketId);
        
        io.to(socket.id).emit('matchFound', {
          message: '重新匹配成功！',
          partner: match.matchedUser,
          roomId: roomId
        });
        
        io.to(match.matchedSocketId).emit('matchFound', {
          message: '重新匹配成功！',
          partner: userInfo,
          roomId: roomId
        });
      } else {
        socket.emit('waitingForMatch', {
          message: `正在寻找新的匹配... (当前等待人数: ${waitingUsers.size})`,
          waitingCount: waitingUsers.size
        });
      }
    } else {
      // 如果用户没有设置，要求设置
      socket.emit('needPreferences', { 
        message: '请先设置性别和匹配偏好' 
      });
    }
  });
  
  // 处理聊天消息
  socket.on('sendMessage', (data) => {
    const userSession = userSessions.get(socket.id);
    
    if (!userSession || !userSession.roomId) {
      socket.emit('error', { message: '您不在聊天室中' });
      return;
    }
    
    const room = activeRooms.get(userSession.roomId);
    if (!room) {
      socket.emit('error', { message: '聊天室不存在' });
      return;
    }
    
    if (data.message.trim()) {
      const messageData = {
        senderId: socket.id,
        senderName: userSession.username,
        senderColor: userSession.color,
        message: data.message.trim(),
        timestamp: new Date().toLocaleTimeString(),
        isOwnMessage: false // 对接收者来说是 false
      };
      
      // 保存消息到房间记录
      room.messages.push(messageData);
      
      // 发送给房间内的另一个用户
      socket.to(userSession.roomId).emit('newMessage', messageData);
      
      // 发送给自己（用于确认发送成功）
      socket.emit('messageSent', {
        ...messageData,
        isOwnMessage: true
      });
    }
  });
  
  // 处理用户断开连接
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
    
    const userSession = userSessions.get(socket.id);
    
    // 如果用户在等待队列中，移除
    waitingUsers.delete(socket.id);
    
    // 如果用户在聊天室中，通知对方
    if (userSession?.roomId) {
      const room = activeRooms.get(userSession.roomId);
      if (room) {
        const partner = room.users.find(u => u.id !== socket.id);
        if (partner) {
          io.to(partner.id).emit('partnerDisconnected', { 
            message: '对方已断开连接',
            partner: userSession
          });
          
          // 将对方放回等待队列
          if (userSessions.has(partner.id)) {
            const partnerSession = userSessions.get(partner.id);
            waitingUsers.set(partner.id, {
              id: partner.id,
              username: partnerSession.username || generateUsername(),
              color: partnerSession.color || generateColor(),
              gender: partnerSession.gender,
              matchPreference: partnerSession.matchPreference
            });
            io.to(partner.id).emit('waitingForMatch', {
              message: '对方已断开连接，正在寻找新的匹配...',
              waitingCount: waitingUsers.size
            });
            
            // 更新对方状态
            userSessions.set(partner.id, {
              ...partnerSession,
              isMatched: false,
              roomId: null,
              partner: null
            });
          }
        }
      }
      
      // 清理房间
      activeRooms.delete(userSession.roomId);
    }
    
    // 清理用户会话
    userSessions.delete(socket.id);
    
    // 更新所有等待用户的计数
    waitingUsers.forEach((user, userId) => {
      io.to(userId).emit('waitingUpdate', {
        waitingCount: waitingUsers.size
      });
    });
  });
  
  // 获取等待人数
  socket.on('getWaitingCount', () => {
    socket.emit('waitingCount', {
      count: waitingUsers.size
    });
  });
  
  // 跳过当前匹配
  socket.on('skipMatch', () => {
    const userSession = userSessions.get(socket.id);
    
    if (userSession?.roomId) {
      // 如果在聊天中，通知对方
      const room = activeRooms.get(userSession.roomId);
      if (room) {
        const partner = room.users.find(u => u.id !== socket.id);
        if (partner) {
          io.to(partner.id).emit('partnerSkipped', { 
            message: '对方跳过了本次匹配',
            partner: userSession
          });
          
          // 将对方放回等待队列
          if (userSessions.has(partner.id)) {
            const partnerSession = userSessions.get(partner.id);
            waitingUsers.set(partner.id, {
              id: partner.id,
              username: partnerSession.username || generateUsername(),
              color: partnerSession.color || generateColor(),
              gender: partnerSession.gender,
              matchPreference: partnerSession.matchPreference
            });
            io.to(partner.id).emit('waitingForMatch', {
              message: '对方跳过了匹配，正在寻找新的匹配...',
              waitingCount: waitingUsers.size
            });
            
            userSessions.set(partner.id, {
              ...partnerSession,
              isMatched: false,
              roomId: null,
              partner: null
            });
          }
        }
      }
      
      // 清理房间
      activeRooms.delete(userSession.roomId);
    }
    
    // 更新用户状态
    userSessions.set(socket.id, {
      ...userSession,
      isMatched: false,
      roomId: null,
      partner: null
    });
    
    // 如果用户有设置，重新加入等待队列
    if (userSession?.gender && userSession?.matchPreference) {
      const userInfo = {
        id: socket.id,
        username: userSession.username || generateUsername(),
        color: userSession.color || generateColor(),
        gender: userSession.gender,
        matchPreference: userSession.matchPreference
      };
      
      waitingUsers.set(socket.id, userInfo);
      
      socket.emit('matchSkipped', {
        message: '已跳过当前匹配，正在寻找新的匹配...',
        waitingCount: waitingUsers.size
      });
    }
  });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`一对一匹配聊天服务器运行在 http://localhost:${PORT}`);
  console.log(`等待匹配算法: 基于性别偏好`);
});