require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

if (!supabase) {
  console.warn('[chat] Supabase not configured — messages will relay in-memory only. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env to enable persistence.');
}

app.use(express.static(path.join(__dirname, 'public')));

const roomPeers = new Map();

io.on('connection', (socket) => {
  socket.on('join-room', (roomId, peerId) => {
    socket.join(roomId);
    socket.to(roomId).emit('user-connected', peerId);

    if (!roomPeers.has(roomId)) roomPeers.set(roomId, new Set());
    roomPeers.get(roomId).add(peerId);

    socket.data.roomId = roomId;
    socket.data.peerId = peerId;
  });

  socket.on('fetch-chat-history', async (roomId) => {
    if (!supabase) {
      socket.emit('chat-history', []);
      return;
    }
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(100);

    socket.emit('chat-history', (!error && data) ? data : []);
  });

  socket.on('chat-message', async ({ roomId, senderName, content }) => {
    if (!content?.trim() || !roomId || !senderName) return;

    const trimmed = content.trim().slice(0, 500);

    if (supabase) {
      const { data, error } = await supabase
        .from('messages')
        .insert({ room_id: roomId, sender_name: senderName, content: trimmed })
        .select()
        .single();

      if (!error && data) {
        io.to(roomId).emit('chat-message', data);
        return;
      }
      console.error('[chat] Supabase insert error:', error);
    }

    // fallback: relay without persistence
    io.to(roomId).emit('chat-message', {
      id: `${Date.now()}-${Math.random()}`,
      room_id: roomId,
      sender_name: senderName,
      content: trimmed,
      created_at: new Date().toISOString(),
    });
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
