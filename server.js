const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const roomPeers = new Map();

io.on('connection', (socket) => {
  socket.on('join-room', (roomId, peerId) => {
    socket.join(roomId);
    socket.to(roomId).emit('user-connected', peerId);

    if (!roomPeers.has(roomId)) {
      roomPeers.set(roomId, new Set());
    }
    roomPeers.get(roomId).add(peerId);

    socket.data.roomId = roomId;
    socket.data.peerId = peerId;
  });

  socket.on('disconnect', () => {
    const { roomId, peerId } = socket.data;
    if (roomId && peerId) {
      socket.to(roomId).emit('user-disconnected', peerId);
      const peers = roomPeers.get(roomId);
      if (peers) {
        peers.delete(peerId);
        if (peers.size === 0) roomPeers.delete(roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
