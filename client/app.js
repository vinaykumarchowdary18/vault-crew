const $ = (id) => document.getElementById(id);
let ws;
let me = '';
let phase = '';
let currentDigits = 4;
let currentLevel = 1;
let sessionToken = '';
let reconnectSuppressed = false;
let reconnectTimer;
let lastChatCount = 0;
let unreadChatCount = 0;
let chatExpanded = false;
let currentMessages = [];
let lastLobbyMessage = null;
let lastRoundResult = null;
let currentRemainingMs = 150000;
let currentRoundSeconds = 150;
let audioContext;
let soundMuted = localStorage.getItem('vault-crew-muted') === '1';

const roomPath = location.pathname.match(/^\/room\/([A-Za-z0-9]{4})$/);
const linkRoom = roomPath?.[1]?.toUpperCase();
const tokenForRoom = (code) => sessionStorage.getItem(`vault-crew-session-${code}`);
const setTokenForRoom = (code, token) => sessionStorage.setItem(`vault-crew-session-${code}`, token);

function setConnection(state, title) {
  const dot = $('connectionDot');
  dot.className = `connection-dot ${state}`;
  dot.title = title;
}

function setStatus(text = '') {
  $('status').textContent = text;
}

function showOnly(id) {
  ['entry', 'how', 'lobby', 'game'].forEach((name) => $(name).classList.toggle('hidden', name !== id));
}

function showChat(visible) {
  $('chatSection').classList.toggle('hidden', !visible);
}

function roomCode() {
  return $('roomOut').textContent.trim() || sessionStorage.getItem('vault-crew-room') || '';
}

async function copyInvite() {
  const code = roomCode();
  if (!code || code === '----') return;
  const url = `${location.origin}/room/${code}`;
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await navigator.share({ title: 'Vault Crew', text: `Join my Vault Crew room: ${code}`, url });
      setStatus('Invite shared.');
    } else {
      await navigator.clipboard.writeText(url);
      setStatus('Invite link copied.');
    }
  } catch {
    try { await navigator.clipboard.writeText(url); setStatus('Invite link copied.'); }
    catch { setStatus(url); }
  }
}

function ensureAudio() {
  if (soundMuted) return null;
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

function tone(frequency, duration, type = 'sine', gainValue = 0.045, delay = 0) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function soundKey() { tone(540, .055, 'square', .025); }
function soundWrong() { tone(150, .18, 'sawtooth', .04); tone(95, .25, 'square', .035, .08); }
function soundCrack() { tone(330, .16, 'triangle', .045); tone(494, .18, 'triangle', .045, .12); tone(659, .28, 'triangle', .05, .25); }
function soundAlarm() { tone(220, .18, 'sawtooth', .04); tone(160, .18, 'sawtooth', .04, .2); tone(220, .18, 'sawtooth', .04, .4); }

function updateMuteButton() {
  $('muteToggle').textContent = soundMuted ? '🔇' : '🔊';
  $('muteToggle').title = soundMuted ? 'Unmute sound' : 'Mute sound';
  $('muteToggle').setAttribute('aria-label', $('muteToggle').title);
}

function resetRoundUi() {
  $('result')?.replaceChildren();
  $('attemptLog').innerHTML = '';
  $('timer').textContent = '';
  $('timerBar').style.width = '100%';
  $('timerWrap')?.classList.remove('danger');
  $('chat').innerHTML = '';
  $('chatPreview').innerHTML = '';
  $('chatInput').value = '';
  $('unreadBadge').classList.add('hidden');
  unreadChatCount = 0;
  $('roundResult').className = 'round-result hidden';
  currentMessages = [];
  lastChatCount = 0;
}

function clearOldResult() {
  $('lobbyResult').innerHTML = '';
  $('lobbyResult').className = 'result-panel hidden';
  $('roundResult').innerHTML = '';
  $('roundResult').className = 'round-result hidden';
}

function connect() {
  if (reconnectSuppressed || (ws && ws.readyState <= 1)) return;
  setConnection('reconnecting', 'Reconnecting');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    setConnection('connected', 'Connected');
    setStatus('');
    if (linkRoom) {
      fillRoomCode(linkRoom);
      const saved = tokenForRoom(linkRoom);
      const savedName = sessionStorage.getItem('vault-crew-name');
      if (saved && savedName) {
        sessionToken = saved;
        send({ type: 'join', roomCode: linkRoom, nickname: savedName });
      } else {
        showOnly('entry');
        $('name').focus();
      }
    } else {
      autoRejoin();
    }
  };

  ws.onclose = (event) => {
    if (event.code === 4001) {
      reconnectSuppressed = true;
      setConnection('', 'Another tab is using this session');
      setStatus('This game is open in another tab.');
      return;
    }
    setConnection('reconnecting', 'Reconnecting');
    setStatus('Connection lost. Reconnecting…');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  };

  ws.onerror = () => setConnection('reconnecting', 'Reconnecting');
  ws.onmessage = (event) => handle(JSON.parse(event.data));
}

function send(message) {
  const payload = { ...message };
  if (sessionToken) payload.sessionToken = sessionToken;
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function autoRejoin() {
  const code = sessionStorage.getItem('vault-crew-room');
  const name = sessionStorage.getItem('vault-crew-name');
  if (code && name && tokenForRoom(code)) {
    sessionToken = tokenForRoom(code);
    send({ type: 'join', roomCode: code, nickname: name });
  } else {
    showOnly('entry');
  }
}

function setRoomHeader(code) {
  if (!code) return;
  $('roomChipCode').textContent = code;
  $('roomChip').classList.remove('hidden');
  $('roomOut').textContent = code;
}

function renderPlayers(players, hostId) {
  $('players').innerHTML = '';
  $('crewCount').textContent = `${players.filter((p) => p.connected).length}/8`;
  players.forEach((player, index) => {
    const card = document.createElement('div');
    card.className = `player-card ${player.connected ? '' : 'offline'}`;
    card.style.animationDelay = `${index * 45}ms`;
    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    avatar.textContent = (player.nickname[0] || '?').toUpperCase();
    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = player.nickname;
    card.append(avatar, name);
    if (player.id === hostId) {
      const crown = document.createElement('span');
      crown.className = 'host-crown';
      crown.textContent = '♛';
      crown.title = 'Host';
      card.append(crown);
    }
    $('players').append(card);
  });
}

function renderLobby(message) {
  lastLobbyMessage = message;
  phase = message.phase;
  setRoomHeader(message.roomCode);
  if (phase !== 'lobby') return;
  showOnly('lobby');
  showChat(false);
  const isRunReset = !message.runEnded && message.round === 0 && message.score === 0 && message.vaultsCracked === 0;
  if (isRunReset) {
    lastRoundResult = null;
    clearOldResult();
  }
  renderPlayers(message.players, message.hostId);
  if (lastRoundResult && !isRunReset) renderResultPanel(lastRoundResult);
  const canStart = message.hostId === me && !message.runEnded && message.players.filter((p) => p.connected).length >= 2;
  $('start').disabled = !canStart;
  $('start').classList.toggle('hidden', message.runEnded);
  $('start').textContent = message.round > 0 ? 'NEXT VAULT' : 'START GAME';
  if (message.runEnded) {
    $('wait').textContent = message.hostId === me ? 'The run is sealed. Reset it to brief a new crew.' : 'The run is sealed. Waiting for the host.';
  } else if (message.players.filter((p) => p.connected).length < 2) {
    $('wait').textContent = 'Need 1 more player.';
  } else {
    $('wait').textContent = message.hostId === me ? 'Crew ready. Open the vault.' : 'Waiting for host…';
  }
}

function renderCrewStrip(players, keypadId) {
  $('crewStrip').innerHTML = '';
  players.forEach((player) => {
    const item = document.createElement('div');
    item.className = `crew-mini ${player.id === keypadId ? 'keypad-holder' : ''}`;
    const avatar = document.createElement('span');
    avatar.className = 'mini-avatar';
    avatar.textContent = (player.nickname?.[0] || '?').toUpperCase();
    const name = document.createElement('span');
    name.textContent = player.nickname;
    item.append(avatar, name);
    if (player.id === keypadId) {
      item.title = 'Keypad holder';
      const icon = document.createElement('span');
      icon.className = 'keypad-icon';
      icon.textContent = '▦';
      icon.setAttribute('aria-label', 'Keypad holder');
      item.append(icon);
    }
    $('crewStrip').append(item);
  });
}

function showRound(message) {
  phase = 'round';
  currentDigits = message.digits;
  currentLevel = message.level;
  currentRoundSeconds = message.seconds;
  currentRemainingMs = message.remainingMs;
  resetRoundUi();
  clearOldResult();
  lastRoundResult = null;
  showOnly('game');
  showChat(true);
  setStatus('');
  renderCrewStrip(message.players || [], message.keypadPlayerId || (message.role === 'keypad' ? me : ''));
  $('vaultNumber').textContent = String(message.round || 1).padStart(2, '0');
  $('level').textContent = String(message.level).padStart(2, '0');
  $('role').textContent = message.role === 'keypad' ? 'YOU HOLD THE KEYPAD' : 'YOUR EVIDENCE';
  $('clues').innerHTML = '';
  message.clues.forEach((clue, index) => {
    const card = document.createElement('div');
    card.className = 'clue';
    card.style.animationDelay = `${index * 70}ms`;
    card.textContent = clue.text;
    $('clues').append(card);
  });
  $('keypad').classList.toggle('hidden', message.role !== 'keypad');
  $('attempts').textContent = message.attemptsRemaining;
  $('attemptIcons').querySelectorAll('i').forEach((icon, i) => icon.classList.toggle('spent', i >= message.attemptsRemaining));
  $('slots').textContent = '_'.repeat(message.digits);
  updateTimer(message.remainingMs);
  currentMessages = [];
  lastChatCount = 0;
}

function updateTimer(remainingMs) {
  currentRemainingMs = remainingMs;
  const seconds = remainingMs / 1000;
  $('timer').textContent = seconds.toFixed(1);
  const fraction = Math.max(0, Math.min(1, remainingMs / (currentRoundSeconds * 1000)));
  $('timerBar').style.width = `${fraction * 100}%`;
  const wrap = $('timer').closest('.timer-wrap');
  wrap.classList.toggle('danger', seconds < 20);
}

function renderAttempt(message) {
  const item = document.createElement('div');
  item.className = 'attempt';
  item.textContent = `${message.nickname} tried ${message.code} ${message.correct ? '✓' : '✗'}`;
  $('attemptLog').append(item);
  $('attempts').textContent = message.attemptsRemaining;
  $('attemptIcons').querySelectorAll('i').forEach((icon, i) => icon.classList.toggle('spent', i >= message.attemptsRemaining));
  if (!message.correct) {
    soundWrong();
    document.body.classList.remove('flash-red');
    void document.body.offsetWidth;
    document.body.classList.add('flash-red');
  }
}

function renderChat(messages) {
  const previousCount = currentMessages.length;
  const newMessages = Math.max(0, messages.length - previousCount);
  currentMessages = messages;
  const latest = messages.slice(-3);
  $('chatPreview').innerHTML = '';
  latest.forEach((message) => {
    const line = document.createElement('div');
    line.className = 'chat-line';
    const name = document.createElement('strong');
    name.textContent = `${message.nickname}: `;
    line.append(name, document.createTextNode(message.text));
    $('chatPreview').append(line);
  });
  $('chat').innerHTML = '';
  messages.slice(-50).forEach((message) => {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${message.nickname === sessionStorage.getItem('vault-crew-name') ? 'own' : ''}`;
    const name = document.createElement('strong');
    name.textContent = message.nickname;
    bubble.append(name, document.createTextNode(message.text));
    $('chat').append(bubble);
  });
  $('chat').scrollTop = $('chat').scrollHeight;
  if (newMessages > 0 && !chatExpanded) {
    unreadChatCount += newMessages;
    $('unreadBadge').textContent = unreadChatCount;
    $('unreadBadge').classList.remove('hidden');
  }
}

function toggleChat() {
  chatExpanded = !chatExpanded;
  $('chatFull').classList.toggle('hidden', !chatExpanded);
  if (chatExpanded) {
    unreadChatCount = 0;
    $('unreadBadge').classList.add('hidden');
  }
  $('expandChat').textContent = chatExpanded ? '↙' : '↗';
}

function showRoundResult(message) {
  phase = 'lobby';
  lastRoundResult = message;
  const success = message.won;
  if (success) soundCrack(); else soundAlarm();
  const card = document.createElement('div');
  card.className = `round-result-card ${success ? 'success' : 'failure'}`;
  const vault = document.createElement('div');
  vault.className = `result-vault ${success ? 'open' : 'sealed'}`;
  vault.innerHTML = '<span class=\"result-vault-ring\"></span><span class=\"result-vault-hub\">LOCK</span>';
  const title = document.createElement('h2');
  title.textContent = success ? 'VAULT CRACKED' : 'VAULT SEALED';
  const code = document.createElement('div');
  code.className = 'reveal-code';
  [...message.secret].forEach((digit, i) => {
    const span = document.createElement('span');
    span.textContent = digit;
    span.style.animation = `screenIn .35s ${i * 110}ms both`;
    code.append(span);
  });
  const stats = document.createElement('p');
  stats.className = 'result-stats';
  stats.textContent = success ? `Score ${message.score} · ${message.vaultsCracked} vault${message.vaultsCracked === 1 ? '' : 's'} cracked` : `Final score ${message.score} · ${message.vaultsCracked} vault${message.vaultsCracked === 1 ? '' : 's'} cracked`;
  const targetScore = Number(message.score) || 0;
  stats.innerHTML = `${success ? 'Score' : 'Final score'} <strong class=\"score-value\">0</strong> · ${message.vaultsCracked} vault${message.vaultsCracked === 1 ? '' : 's'} cracked`;
  card.replaceChildren(vault, title, code, stats);
  const scoreValue = stats.querySelector('.score-value');
  const startScore = performance.now();
  const countScore = (now) => {
    const progress = Math.min(1, (now - startScore) / 900);
    scoreValue.textContent = String(Math.round(targetScore * (1 - Math.pow(1 - progress, 3))));
    if (progress < 1) requestAnimationFrame(countScore);
  };
  requestAnimationFrame(countScore);
  $('roundResult').innerHTML = '';
  $('roundResult').append(card);
  $('roundResult').classList.remove('hidden');
  $('roundResult').classList.toggle('alarm', !success);
  setTimeout(() => $('roundResult').classList.remove('alarm'), 1000);
  setTimeout(() => {
    $('roundResult').classList.add('hidden');
    if (lastLobbyMessage) renderLobby(lastLobbyMessage);
  }, 3000);
}

function renderResultPanel(message) {
  const panel = $('lobbyResult');
  panel.className = `result-panel ${message.won ? 'success' : 'failure'}`;
  panel.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'result-title';
  title.textContent = message.won ? 'VAULT CRACKED' : 'VAULT SEALED';
  const code = document.createElement('div');
  code.className = 'result-code';
  code.textContent = message.secret;
  const stats = document.createElement('div');
  stats.className = 'result-stats';
  stats.textContent = message.won ? `Score: ${message.score} · Vaults cracked: ${message.vaultsCracked}` : `Final score: ${message.score} · Vaults cracked: ${message.vaultsCracked}`;
  panel.append(title, code, stats);
  if (message.won) {
    const next = document.createElement('p');
    next.textContent = 'Next vault is ready.';
    next.className = 'result-stats';
    panel.append(next);
  } else if (message.hostId === me) {
    const button = document.createElement('button');
    button.className = 'primary';
    button.textContent = 'PLAY AGAIN';
    button.onclick = () => send({ type: 'playAgain' });
    panel.append(button);
  }
  panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function handle(message) {
  if (message.type === 'connected') return;
  if (message.type === 'error') {
    setStatus(message.message);
    return;
  }
  if (message.type === 'joined') {
    me = message.playerId;
    sessionToken = message.sessionToken || sessionToken;
    if (message.roomCode) {
      sessionStorage.setItem('vault-crew-room', message.roomCode);
      setTokenForRoom(message.roomCode, sessionToken);
      history.replaceState({}, '', `/room/${message.roomCode}`);
      setRoomHeader(message.roomCode);
    }
    setStatus('');
  }
  if (message.type === 'lobby') renderLobby(message);
  if (message.type === 'round') showRound(message);
  if (message.type === 'timer') updateTimer(message.remainingMs);
  if (message.type === 'attempt') renderAttempt(message);
  if (message.type === 'roundResult') {
    renderResultPanel(message);
    $('lobbyResult').classList.remove('hidden');
    // Server immediately broadcasts the lobby state. Keep the result panel until Play again or next vault.
    showRoundResult(message);
  }
  if (message.type === 'chat') renderChat(message.messages);
}

function getRoomCodeFromBoxes() {
  return [0, 1, 2, 3].map((i) => $(`room${i}`).value).join('').toUpperCase();
}

function fillRoomCode(value) {
  const match = String(value).toUpperCase().match(/[A-Z0-9]{4}/);
  if (!match) return;
  [...match[0]].forEach((char, i) => { $(`room${i}`).value = char; });
}

function handleRoomPaste(event) {
  event.preventDefault();
  const pasted = event.clipboardData.getData('text').trim().toUpperCase();
  const match = pasted.match(/\/room\/([A-Z0-9]{4})/i) || pasted.match(/([A-Z0-9]{4})/);
  if (match) {
    fillRoomCode(match[1]);
    $('name').focus();
  }
}

$('create').onclick = () => {
  ensureAudio();
  const nickname = $('createName').value.trim() || 'Player';
  sessionStorage.setItem('vault-crew-name', nickname);
  sessionToken = crypto.randomUUID();
  send({ type: 'create', nickname });
};

$('join').onclick = () => {
  ensureAudio();
  const code = getRoomCodeFromBoxes();
  const nickname = $('name').value.trim() || 'Player';
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    setStatus('Enter a 4-character room code.');
    return;
  }
  sessionStorage.setItem('vault-crew-room', code);
  sessionStorage.setItem('vault-crew-name', nickname);
  sessionToken = tokenForRoom(code) || crypto.randomUUID();
  setTokenForRoom(code, sessionToken);
  send({ type: 'join', roomCode: code, nickname });
};

$('start').onclick = () => { ensureAudio(); send({ type: 'start' }); };
$('copyInvite').onclick = copyInvite;
$('copyHeader').onclick = copyInvite;
$('howBtn').onclick = () => showOnly('how');
$('lobbyHow').onclick = () => showOnly('how');
$('backHow').onclick = () => showOnly(sessionStorage.getItem('vault-crew-room') ? 'lobby' : 'entry');
$('expandChat').onclick = toggleChat;
$('sendChat').onclick = () => {
  const text = $('chatInput').value.trim();
  if (!text) return;
  send({ type: 'chat', text });
  $('chatInput').value = '';
};
$('chatInput').onkeydown = (event) => { if (event.key === 'Enter') $('sendChat').click(); };
document.querySelectorAll('.quick-reactions button').forEach((button) => {
  button.onclick = () => send({ type: 'chat', text: button.dataset.reaction });
});

document.querySelectorAll('.room-code-input input').forEach((input, index) => {
  input.oninput = () => {
    input.value = input.value.replace(/[^a-z0-9]/gi, '').slice(-1).toUpperCase();
    if (input.value && index < 3) $(`room${index + 1}`).focus();
  };
  input.onkeydown = (event) => {
    if (event.key === 'Backspace' && !input.value && index > 0) $(`room${index - 1}`).focus();
    if (event.key === 'ArrowLeft' && index > 0) $(`room${index - 1}`).focus();
    if (event.key === 'ArrowRight' && index < 3) $(`room${index + 1}`).focus();
  };
  input.onpaste = handleRoomPaste;
});

function keypadValue() { return $('slots').textContent.replace(/_/g, ''); }
function updateSlots(value) { $('slots').textContent = value + '_'.repeat(currentDigits - value.length); }
document.querySelectorAll('[data-key]').forEach((button) => {
  button.onclick = () => {
    const value = keypadValue();
    if (value.length >= currentDigits) return;
    updateSlots(value + button.dataset.key);
    soundKey();
  };
});
$('back').onclick = () => updateSlots(keypadValue().slice(0, -1));
$('submit').onclick = () => {
  const code = keypadValue();
  if (code.length !== currentDigits) { setStatus(`Enter exactly ${currentDigits} digits.`); return; }
  send({ type: 'submit', code });
};
$('muteToggle').onclick = () => {
  soundMuted = !soundMuted;
  localStorage.setItem('vault-crew-muted', soundMuted ? '1' : '0');
  updateMuteButton();
};

updateMuteButton();
if (linkRoom) fillRoomCode(linkRoom);
connect();
