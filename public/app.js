'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  socket:       null,
  peer:         null,
  localStream:  null,
  peerId:       null,
  roomId:       null,
  displayName:  null,
  isMuted:      false,
  isCamOff:     false,
  activeCalls:  new Map(),
  videoTiles:   new Map(),
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const ui = {
  entranceScreen:   document.getElementById('entrance-screen'),
  meetingRoom:      document.getElementById('meeting-room'),
  joinForm:         document.getElementById('join-form'),
  displayNameEl:    document.getElementById('display-name'),
  roomIdEl:         document.getElementById('room-id'),
  errorMsg:         document.getElementById('error-msg'),
  videoGrid:        document.getElementById('video-grid'),
  headerRoomId:     document.getElementById('header-room-id'),
  peerCount:        document.getElementById('peer-count'),
  btnMute:          document.getElementById('btn-mute'),
  btnCamera:        document.getElementById('btn-camera'),
  btnLeave:         document.getElementById('btn-leave'),
  iconMicOn:        document.getElementById('icon-mic-on'),
  iconMicOff:       document.getElementById('icon-mic-off'),
  labelMute:        document.getElementById('label-mute'),
  iconCamOn:        document.getElementById('icon-cam-on'),
  iconCamOff:       document.getElementById('icon-cam-off'),
  labelCamera:      document.getElementById('label-camera'),
  toastContainer:   document.getElementById('toast-container'),
  // New meeting / share link (entrance)
  btnNewMeeting:    document.getElementById('btn-new-meeting'),
  shareLinkBox:     document.getElementById('share-link-box'),
  shareLinkUrl:     document.getElementById('share-link-url'),
  btnCopyLink:      document.getElementById('btn-copy-link'),
  // Share link popover (in-meeting)
  btnShareMeeting:  document.getElementById('btn-share-meeting'),
  sharePopover:     document.getElementById('share-popover'),
  sharePopoverUrl:  document.getElementById('share-popover-url'),
  btnCopyPopover:   document.getElementById('btn-copy-popover'),
  // Chat
  btnChat:          document.getElementById('btn-chat'),
  chatPanel:        document.getElementById('chat-panel'),
  chatMessages:     document.getElementById('chat-messages'),
  chatInput:        document.getElementById('chat-input'),
  btnChatSend:      document.getElementById('btn-chat-send'),
  chatUnreadBadge:  document.getElementById('chat-unread-badge'),
  btnCloseChat:     document.getElementById('btn-close-chat'),
};

// ── Toast notification ────────────────────────────────────────────────────
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  ui.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3100);
}

// ── Peer count badge ─────────────────────────────────────────────────────
function updatePeerCount() {
  ui.peerCount.textContent = 1 + state.videoTiles.size;
}

// ── Video tile factory ────────────────────────────────────────────────────
function createVideoTile(stream, label, isLocal = false) {
  const tile = document.createElement('div');
  tile.className = 'video-tile' + (isLocal ? ' local-tile' : '');

  const video = document.createElement('video');
  video.autoplay    = true;
  video.playsInline = true;
  video.muted       = isLocal;
  video.srcObject   = stream;

  const tileLabel = document.createElement('div');
  tileLabel.className = 'tile-label';
  tileLabel.textContent = label;

  const mutedIcon = document.createElement('div');
  mutedIcon.className = 'tile-muted-icon';
  mutedIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>`;

  const placeholder = document.createElement('div');
  placeholder.className = 'video-off-placeholder';
  const initial = label.charAt(0).toUpperCase();
  placeholder.innerHTML = `<div class="avatar-circle">${initial}</div><span style="color:var(--muted-lt);font-size:0.85rem;">${label}</span>`;

  tile.appendChild(video);
  tile.appendChild(placeholder);
  tile.appendChild(mutedIcon);
  tile.appendChild(tileLabel);

  video.addEventListener('play', () => placeholder.classList.remove('visible'));

  return { tile, video, mutedIcon, placeholder };
}

// ── Attach remote stream to grid ──────────────────────────────────────────
function addRemoteVideo(peerId, stream) {
  if (state.videoTiles.has(peerId)) return;

  const label = `Participant (${peerId.slice(-4)})`;
  const { tile, video } = createVideoTile(stream, label, false);

  ui.videoGrid.appendChild(tile);
  state.videoTiles.set(peerId, tile);
  updatePeerCount();
  showToast(`${label} joined the meeting`);

  video.srcObject = stream;
}

// ── Remove remote video from grid ─────────────────────────────────────────
function removeRemoteVideo(peerId) {
  const tile = state.videoTiles.get(peerId);
  if (tile) {
    tile.remove();
    state.videoTiles.delete(peerId);
    updatePeerCount();
  }
  const call = state.activeCalls.get(peerId);
  if (call) {
    call.close();
    state.activeCalls.delete(peerId);
  }
  showToast('A participant left the meeting');
}

// ── Outgoing call ─────────────────────────────────────────────────────────
function callPeer(targetPeerId) {
  if (!state.localStream || !state.peer) return;

  const call = state.peer.call(targetPeerId, state.localStream);
  state.activeCalls.set(targetPeerId, call);

  call.on('stream', (remoteStream) => addRemoteVideo(targetPeerId, remoteStream));
  call.on('close', () => removeRemoteVideo(targetPeerId));
  call.on('error', (err) => console.error('Call error:', err));
}

// ── Incoming calls ────────────────────────────────────────────────────────
function setupIncomingCallHandler() {
  state.peer.on('call', (call) => {
    call.answer(state.localStream);
    state.activeCalls.set(call.peer, call);

    call.on('stream', (remoteStream) => addRemoteVideo(call.peer, remoteStream));
    call.on('close', () => removeRemoteVideo(call.peer));
    call.on('error', (err) => console.error('Incoming call error:', err));
  });
}

// ── Socket signaling + chat ───────────────────────────────────────────────
function setupSocket() {
  state.socket = io();

  state.socket.on('user-connected', (peerId) => callPeer(peerId));
  state.socket.on('user-disconnected', (peerId) => removeRemoteVideo(peerId));
  state.socket.on('connect_error', () => showToast('Connection lost — attempting to reconnect…'));

  state.socket.on('chat-history', (messages) => {
    ui.chatMessages.innerHTML = '';
    if (messages.length === 0) {
      ui.chatMessages.innerHTML = '<p class="chat-empty">No messages yet. Say hello!</p>';
      return;
    }
    messages.forEach(renderChatMessage);
  });

  state.socket.on('chat-message', (msg) => renderChatMessage(msg));
}

// ── PeerJS init ───────────────────────────────────────────────────────────
function initPeer() {
  return new Promise((resolve, reject) => {
    const peer = new Peer(undefined, {
      host: '0.peerjs.com', secure: true, port: 443, path: '/',
    });

    peer.on('open', (id) => { state.peer = peer; state.peerId = id; resolve(id); });
    peer.on('error', (err) => { console.error('PeerJS error:', err); reject(err); });
  });
}

// ── Media capture ─────────────────────────────────────────────────────────
async function captureLocalStream() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    state.localStream = stream;
    return stream;
  } catch (err) {
    if (err.name === 'NotReadableError' || err.name === 'OverconstrainedError') {
      const audioStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      state.localStream = audioStream;
      state.isCamOff = true;
      return audioStream;
    }
    throw err;
  }
}

// ── Render local tile ─────────────────────────────────────────────────────
function renderLocalTile(stream) {
  const { tile, video } = createVideoTile(stream, `${state.displayName} (You)`, true);
  tile.dataset.local = 'true';
  ui.videoGrid.appendChild(tile);
  video.srcObject = stream;
  state._localTile = { tile, video };
}

// ── Control: Mute toggle ─────────────────────────────────────────────────
ui.btnMute.addEventListener('click', () => {
  state.isMuted = !state.isMuted;
  state.localStream.getAudioTracks().forEach((t) => (t.enabled = !state.isMuted));
  ui.iconMicOn.style.display  = state.isMuted ? 'none' : '';
  ui.iconMicOff.style.display = state.isMuted ? '' : 'none';
  ui.labelMute.textContent    = state.isMuted ? 'Unmute' : 'Mute';
  ui.btnMute.classList.toggle('muted', state.isMuted);
});

// ── Control: Camera toggle ────────────────────────────────────────────────
ui.btnCamera.addEventListener('click', () => {
  state.isCamOff = !state.isCamOff;
  state.localStream.getVideoTracks().forEach((t) => (t.enabled = !state.isCamOff));
  ui.iconCamOn.style.display  = state.isCamOff ? 'none' : '';
  ui.iconCamOff.style.display = state.isCamOff ? '' : 'none';
  ui.labelCamera.textContent  = state.isCamOff ? 'Start Video' : 'Stop Video';
  ui.btnCamera.classList.toggle('cam-off', state.isCamOff);
  if (state._localTile) {
    state._localTile.tile.querySelector('.video-off-placeholder')
      ?.classList.toggle('visible', state.isCamOff);
  }
});

// ── Control: Leave meeting ────────────────────────────────────────────────
ui.btnLeave.addEventListener('click', leaveMeeting);

function leaveMeeting() {
  state.activeCalls.forEach((call) => call.close());
  state.activeCalls.clear();

  state.localStream?.getTracks().forEach((t) => t.stop());
  state.localStream = null;

  state.peer?.destroy();
  state.peer = null;

  state.socket?.disconnect();
  state.socket = null;

  ui.videoGrid.innerHTML = '';
  state.videoTiles.clear();

  // Reset chat
  resetChat();

  // Reset share popover
  ui.sharePopover.classList.add('hidden');

  ui.meetingRoom.style.display    = 'none';
  ui.entranceScreen.style.display = 'grid';

  state.isMuted = false;
  state.isCamOff = false;
  ui.iconMicOn.style.display  = '';
  ui.iconMicOff.style.display = 'none';
  ui.labelMute.textContent    = 'Mute';
  ui.iconCamOn.style.display  = '';
  ui.iconCamOff.style.display = 'none';
  ui.labelCamera.textContent  = 'Stop Video';
  ui.btnMute.classList.remove('muted');
  ui.btnCamera.classList.remove('cam-off');
}

// ── Generate room ID (Google Meet style) ─────────────────────────────────
function generateRoomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const rand = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * 26)]).join('');
  return `${rand(3)}-${rand(4)}-${rand(3)}`;
}

function buildShareUrl(roomId) {
  const base = window.location.origin + window.location.pathname;
  return `${base}?room=${encodeURIComponent(roomId)}`;
}

// ── New Meeting button ────────────────────────────────────────────────────
ui.btnNewMeeting.addEventListener('click', () => {
  const roomId = generateRoomId();
  ui.roomIdEl.value = roomId;
  ui.shareLinkUrl.textContent = buildShareUrl(roomId);
  ui.shareLinkBox.style.display = 'block';
  ui.displayNameEl.focus();
});

// ── Copy link (entrance) ──────────────────────────────────────────────────
ui.btnCopyLink.addEventListener('click', () => copyText(ui.shareLinkUrl.textContent, ui.btnCopyLink));

// ── Share link popover (in-meeting) ──────────────────────────────────────
ui.btnShareMeeting.addEventListener('click', (e) => {
  e.stopPropagation();
  const isHidden = ui.sharePopover.classList.contains('hidden');
  if (isHidden) {
    ui.sharePopoverUrl.textContent = buildShareUrl(state.roomId);
    ui.sharePopover.classList.remove('hidden');
  } else {
    ui.sharePopover.classList.add('hidden');
  }
});

ui.btnCopyPopover.addEventListener('click', () => copyText(ui.sharePopoverUrl.textContent, ui.btnCopyPopover));

document.addEventListener('click', (e) => {
  if (!ui.sharePopover.contains(e.target) && e.target !== ui.btnShareMeeting) {
    ui.sharePopover.classList.add('hidden');
  }
});

async function copyText(text, btn) {
  const orig = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = orig; }, 2200);
}

// ── Pre-fill room ID from URL param ──────────────────────────────────────
(function parseUrlRoom() {
  const room = new URLSearchParams(window.location.search).get('room');
  if (room) ui.roomIdEl.value = room;
})();

// ── Chat ──────────────────────────────────────────────────────────────────
const chatState = { open: false, unread: 0 };

function resetChat() {
  ui.chatMessages.innerHTML = '';
  chatState.open = false;
  chatState.unread = 0;
  ui.chatUnreadBadge.textContent = '';
  ui.chatUnreadBadge.classList.remove('visible');
  ui.chatPanel.classList.add('hidden');
  ui.btnChat.classList.remove('chat-active');
}

function openChat() {
  chatState.open = true;
  chatState.unread = 0;
  ui.chatUnreadBadge.textContent = '';
  ui.chatUnreadBadge.classList.remove('visible');
  ui.chatPanel.classList.remove('hidden');
  ui.btnChat.classList.add('chat-active');
  scrollChatToBottom();
  ui.chatInput.focus();
}

function closeChat() {
  chatState.open = false;
  ui.chatPanel.classList.add('hidden');
  ui.btnChat.classList.remove('chat-active');
}

function scrollChatToBottom() {
  ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderChatMessage(msg) {
  const emptyEl = ui.chatMessages.querySelector('.chat-empty');
  if (emptyEl) emptyEl.remove();

  const isOwn = msg.sender_name === state.displayName;
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg' + (isOwn ? ' own' : '');
  msgEl.innerHTML = `
    <div class="chat-msg-meta">
      <span class="chat-msg-sender">${escapeHtml(msg.sender_name)}</span>
      <span class="chat-msg-time">${time}</span>
    </div>
    <div class="chat-msg-content">${escapeHtml(msg.content)}</div>
  `;

  ui.chatMessages.appendChild(msgEl);
  scrollChatToBottom();

  if (!chatState.open) {
    chatState.unread++;
    ui.chatUnreadBadge.textContent = chatState.unread > 9 ? '9+' : chatState.unread;
    ui.chatUnreadBadge.classList.add('visible');
  }
}

function sendChatMessage() {
  const content = ui.chatInput.value.trim();
  if (!content || !state.socket) return;
  state.socket.emit('chat-message', {
    roomId: state.roomId,
    senderName: state.displayName,
    content,
  });
  ui.chatInput.value = '';
}

ui.btnChat.addEventListener('click', () => chatState.open ? closeChat() : openChat());
ui.btnCloseChat.addEventListener('click', closeChat);
ui.btnChatSend.addEventListener('click', sendChatMessage);
ui.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

// ── Join form submission ──────────────────────────────────────────────────
ui.joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const displayName = ui.displayNameEl.value.trim();
  const roomId      = ui.roomIdEl.value.trim().toLowerCase().replace(/\s+/g, '-');

  if (!displayName || !roomId) return;

  ui.errorMsg.style.display = 'none';

  try {
    state.displayName = displayName;
    state.roomId      = roomId;

    const stream = await captureLocalStream();
    await initPeer();

    setupSocket();
    setupIncomingCallHandler();

    state.socket.emit('join-room', state.roomId, state.peerId);
    state.socket.emit('fetch-chat-history', state.roomId);

    ui.headerRoomId.textContent      = state.roomId;
    ui.entranceScreen.style.display  = 'none';
    ui.meetingRoom.style.display     = 'flex';

    // Reset chat for the new session (history arrives via socket event)
    resetChat();
    ui.chatMessages.innerHTML = '<p class="chat-empty">No messages yet. Say hello!</p>';

    renderLocalTile(stream);
    updatePeerCount();

    if (state.isCamOff) {
      ui.iconCamOn.style.display  = 'none';
      ui.iconCamOff.style.display = '';
      ui.labelCamera.textContent  = 'Start Video';
      ui.btnCamera.classList.add('cam-off');
      state._localTile?.tile.querySelector('.video-off-placeholder')?.classList.add('visible');
      showToast('Camera in use elsewhere — joined with audio only');
    }

  } catch (err) {
    console.error('Join error:', err);
    let message = 'Unable to start the meeting.';
    if (err.name === 'NotAllowedError') {
      message = 'Camera/microphone access was denied. Please allow permissions and try again.';
    } else if (err.name === 'NotFoundError') {
      message = 'No camera or microphone device found.';
    } else if (err.name === 'NotReadableError') {
      message = 'Camera and microphone are both in use by another app or browser tab. Free them up and try again.';
    }
    ui.errorMsg.textContent   = message;
    ui.errorMsg.style.display = 'block';
  }
});
