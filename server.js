const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for dev/production flexibility
    methods: ['GET', 'POST']
  }
});

// Store active users in rooms
// Structure: { [roomId]: { [socketId]: { username, audioMuted, videoDisabled } } }
const rooms = {};

// Serve static assets in production
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback for single-page app routing (React Router or simple views)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join Room
  socket.on('join-room', ({ roomId, username, audioMuted = false, videoDisabled = false }) => {
    socket.roomId = roomId;
    socket.username = username;
    socket.join(roomId);

    // Initialize room structure if not exists
    if (!rooms[roomId]) {
      rooms[roomId] = {};
    }

    // Add current user metadata to the room
    rooms[roomId][socket.id] = {
      username,
      audioMuted,
      videoDisabled
    };

    console.log(`User ${username} (${socket.id}) joined room: ${roomId}`);

    // Get list of all other users in this room
    const otherUsers = [];
    for (const [id, user] of Object.entries(rooms[roomId])) {
      if (id !== socket.id) {
        otherUsers.push({
          userId: id,
          username: user.username,
          audioMuted: user.audioMuted,
          videoDisabled: user.videoDisabled
        });
      }
    }

    // Send list of other users to the client that just joined
    socket.emit('all-users', otherUsers);

    // Notify other users in the room that this user has joined
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      username,
      audioMuted,
      videoDisabled
    });
  });

  // WebRTC signaling: Relay Offers
  socket.on('offer', ({ offer, to }) => {
    io.to(to).emit('offer', {
      offer,
      from: socket.id
    });
  });

  // WebRTC signaling: Relay Answers
  socket.on('answer', ({ answer, to }) => {
    io.to(to).emit('answer', {
      answer,
      from: socket.id
    });
  });

  // WebRTC signaling: Relay ICE Candidates
  socket.on('ice-candidate', ({ candidate, to }) => {
    io.to(to).emit('ice-candidate', {
      candidate,
      from: socket.id
    });
  });

  // Relay Camera/Mic Toggle events
  socket.on('toggle-audio', ({ muted }) => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId] && rooms[roomId][socket.id]) {
      rooms[roomId][socket.id].audioMuted = muted;
      socket.to(roomId).emit('user-toggle-audio', {
        userId: socket.id,
        muted
      });
    }
  });

  socket.on('toggle-video', ({ disabled }) => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId] && rooms[roomId][socket.id]) {
      rooms[roomId][socket.id].videoDisabled = disabled;
      socket.to(roomId).emit('user-toggle-video', {
        userId: socket.id,
        disabled
      });
    }
  });

  // Chat messaging
  socket.on('send-message', ({ messageText }) => {
    const roomId = socket.roomId;
    if (roomId) {
      const msgPayload = {
        senderId: socket.id,
        username: socket.username || 'Anonymous',
        text: messageText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      
      // Broadcast message to all users in the room (including sender for simplicity)
      io.to(roomId).emit('receive-message', msgPayload);
    }
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    const roomId = socket.roomId;
    
    if (roomId && rooms[roomId]) {
      // Remove from room list
      delete rooms[roomId][socket.id];
      
      // If room is empty, delete it
      if (Object.keys(rooms[roomId]).length === 0) {
        delete rooms[roomId];
      } else {
        // Notify others
        socket.to(roomId).emit('user-left', {
          userId: socket.id,
          username: socket.username
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
