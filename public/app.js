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
  activeCalls:  new Map(),  // peerId → MediaConnection
  videoTiles:   new Map(),  // peerId → HTMLElement
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const ui = {
  entranceScreen: document.getElementById('entrance-screen'),
  meetingRoom:    document.getElementById('meeting-room'),
  joinForm:       document.getElementById('join-form'),
  displayNameEl:  document.getElementById('display-name'),
  roomIdEl:       document.getElementById('room-id'),
  errorMsg:       document.getElementById('error-msg'),
  videoGrid:      document.getElementById('video-grid'),
  headerRoomId:   document.getElementById('header-room-id'),
  peerCount:      document.getElementById('peer-count'),
  btnMute:        document.getElementById('btn-mute'),
  btnCamera:      document.getElementById('btn-camera'),
  btnLeave:       document.getElementById('btn-leave'),
  iconMicOn:      document.getElementById('icon-mic-on'),
  iconMicOff:     document.getElementById('icon-mic-off'),
  labelMute:      document.getElementById('label-mute'),
  iconCamOn:      document.getElementById('icon-cam-on'),
  iconCamOff:     document.getElementById('icon-cam-off'),
  labelCamera:    document.getElementById('label-camera'),
  toastContainer: document.getElementById('toast-container'),
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
  placeholder.innerHTML = `<div class="avatar-circle">${initial}</div><span style="color:var(--text-muted);font-size:0.85rem;">${label}</span>`;

  tile.appendChild(video);
  tile.appendChild(placeholder);
  tile.appendChild(mutedIcon);
  tile.appendChild(tileLabel);

  video.addEventListener('play', () => {
    placeholder.classList.remove('visible');
  });

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
  showToast(`A participant left the meeting`);
}

// ── Make an outgoing call to a newly joined peer ─────────────────────────
function callPeer(targetPeerId) {
  if (!state.localStream || !state.peer) return;

  const call = state.peer.call(targetPeerId, state.localStream);
  state.activeCalls.set(targetPeerId, call);

  call.on('stream', (remoteStream) => {
    addRemoteVideo(targetPeerId, remoteStream);
  });

  call.on('close', () => removeRemoteVideo(targetPeerId));
  call.on('error', (err) => console.error('Call error:', err));
}

// ── Answer incoming calls ─────────────────────────────────────────────────
function setupIncomingCallHandler() {
  state.peer.on('call', (call) => {
    call.answer(state.localStream);
    state.activeCalls.set(call.peer, call);

    call.on('stream', (remoteStream) => {
      addRemoteVideo(call.peer, remoteStream);
    });

    call.on('close', () => removeRemoteVideo(call.peer));
    call.on('error', (err) => console.error('Incoming call error:', err));
  });
}

// ── Socket signaling ──────────────────────────────────────────────────────
function setupSocket() {
  state.socket = io();

  state.socket.on('user-connected', (peerId) => {
    callPeer(peerId);
  });

  state.socket.on('user-disconnected', (peerId) => {
    removeRemoteVideo(peerId);
  });

  state.socket.on('connect_error', () => {
    showToast('Connection lost — attempting to reconnect…');
  });
}

// ── PeerJS init ───────────────────────────────────────────────────────────
function initPeer() {
  return new Promise((resolve, reject) => {
    const peer = new Peer(undefined, {
      host:   '0.peerjs.com',
      secure: true,
      port:   443,
      path:   '/',
    });

    peer.on('open', (id) => {
      state.peer   = peer;
      state.peerId = id;
      resolve(id);
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      reject(err);
    });
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
    // Camera already in use by another tab/app — join with audio only
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

  ui.iconMicOn.style.display  = state.isMuted ? 'none'  : '';
  ui.iconMicOff.style.display = state.isMuted ? ''      : 'none';
  ui.labelMute.textContent    = state.isMuted ? 'Unmute' : 'Mute';
  ui.btnMute.classList.toggle('muted', state.isMuted);
});

// ── Control: Camera toggle ────────────────────────────────────────────────
ui.btnCamera.addEventListener('click', () => {
  state.isCamOff = !state.isCamOff;
  state.localStream.getVideoTracks().forEach((t) => (t.enabled = !state.isCamOff));

  ui.iconCamOn.style.display  = state.isCamOff ? 'none' : '';
  ui.iconCamOff.style.display = state.isCamOff ? ''     : 'none';
  ui.labelCamera.textContent  = state.isCamOff ? 'Start Video' : 'Stop Video';
  ui.btnCamera.classList.toggle('cam-off', state.isCamOff);

  if (state._localTile) {
    const ph = state._localTile.tile.querySelector('.video-off-placeholder');
    if (ph) ph.classList.toggle('visible', state.isCamOff);
  }
});

// ── Control: Leave meeting ────────────────────────────────────────────────
ui.btnLeave.addEventListener('click', () => {
  leaveMeeting();
});

function leaveMeeting() {
  state.activeCalls.forEach((call) => call.close());
  state.activeCalls.clear();

  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => t.stop());
    state.localStream = null;
  }

  if (state.peer) {
    state.peer.destroy();
    state.peer = null;
  }

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  ui.videoGrid.innerHTML    = '';
  state.videoTiles.clear();

  ui.meetingRoom.style.display   = 'none';
  ui.entranceScreen.style.display = 'flex';

  state.isMuted  = false;
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

    ui.headerRoomId.textContent     = state.roomId;
    ui.entranceScreen.style.display = 'none';
    ui.meetingRoom.style.display    = 'flex';

    renderLocalTile(stream);
    updatePeerCount();

    if (state.isCamOff) {
      ui.iconCamOn.style.display  = 'none';
      ui.iconCamOff.style.display = '';
      ui.labelCamera.textContent  = 'Start Video';
      ui.btnCamera.classList.add('cam-off');
      const ph = state._localTile?.tile.querySelector('.video-off-placeholder');
      if (ph) ph.classList.add('visible');
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
    ui.errorMsg.textContent    = message;
    ui.errorMsg.style.display  = 'block';
  }
});
