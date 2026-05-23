/**
 * script.js — LumaAgent Dashboard
 *
 * What this file does:
 *  1. Polls /api/status every 3 seconds → updates sensor cards with smooth transitions
 *  2. Polls /api/scheduled every 5 seconds → shows pending timed relay actions
 *  3. Handles user chat input → sends to /api/chat → renders agent response
 *  4. Provides quick relay buttons and prompt chips
 *
 * No external dependencies — pure vanilla JavaScript.
 */

// ── Config ───────────────────────────────────────────────────────────────────
const API_BASE         = '';          // Same origin — served by FastAPI
const STATUS_INTERVAL  = 3000;        // ms between sensor polls
const SCHEDULE_INTERVAL = 5000;       // ms between scheduled-action polls

// ── State ────────────────────────────────────────────────────────────────────
let isAgentThinking  = false;
let lastStatus       = {};

// ── DOM refs ─────────────────────────────────────────────────────────────────
const elStatusDot    = document.getElementById('status-dot');
const elStatusLabel  = document.getElementById('status-label');
const elLastRefresh  = document.getElementById('last-refresh');
const elValTemp      = document.getElementById('val-temp');
const elValHum       = document.getElementById('val-hum');
const elValLdr       = document.getElementById('val-ldr');
const elValPir       = document.getElementById('val-pir');
const elValRelay     = document.getElementById('val-relay');
const elRelayCard    = document.getElementById('relay-card');
const elBarLdr       = document.getElementById('bar-ldr');
const elPirRing      = document.getElementById('pir-ring');
const elMessages     = document.getElementById('chat-messages');
const elInput        = document.getElementById('chat-input');
const elBtnSend      = document.getElementById('btn-send');
const elToolStatus   = document.getElementById('tool-status');
const elScheduled    = document.getElementById('scheduled-list');


// ════════════════════════════════════════════════════════════════════════════
// SECTION 1: SENSOR STATUS POLLING
// ════════════════════════════════════════════════════════════════════════════

async function fetchStatus() {
  try {
    const res  = await fetch(`${API_BASE}/api/status`);
    const data = await res.json();

    updateMqttIndicator(data.mqtt_connected);
    updateSensorCards(data);
    lastStatus = data;

    // Show last refresh time
    const now = new Date();
    elLastRefresh.textContent = now.toLocaleTimeString('en-IN', { hour12: false });

  } catch (err) {
    // Network error — mark as disconnected but don't crash
    updateMqttIndicator(false);
    console.warn('Status fetch failed:', err);
  }
}

function updateMqttIndicator(connected) {
  if (connected) {
    elStatusDot.className  = 'status-dot connected';
    elStatusLabel.textContent = 'MQTT Live';
  } else {
    elStatusDot.className  = 'status-dot disconnected';
    elStatusLabel.textContent = 'Offline';
  }
}

function updateSensorCards(data) {
  // Helper: update a value element with flash animation on change
  function setVal(el, newVal, formatter) {
    const formatted = (newVal !== null && newVal !== undefined)
      ? formatter(newVal)
      : '--';

    if (el.textContent !== formatted) {
      el.textContent = formatted;
      el.classList.remove('updated');
      // Force reflow to restart animation
      void el.offsetWidth;
      el.classList.add('updated');
    }
  }

  setVal(elValTemp, data.temp,     v => v.toFixed(1));
  setVal(elValHum,  data.humidity, v => v.toFixed(1));
  setVal(elValLdr,  data.ldr,      v => v.toFixed(1));

  // Motion / PIR
  if (data.pir !== null && data.pir !== undefined) {
    const motionDetected = Boolean(data.pir);
    elValPir.textContent = motionDetected ? 'DETECTED' : 'CLEAR';
    elValPir.style.color = motionDetected ? 'var(--purple)' : 'var(--text-secondary)';
    elPirRing.className  = motionDetected ? 'pir-ring active' : 'pir-ring';
  }

  // LDR progress bar
  if (data.ldr !== null && data.ldr !== undefined) {
    elBarLdr.style.width = Math.min(100, data.ldr) + '%';
  }

  // Relay
  if (data.relay) {
    const relay = data.relay.toUpperCase();
    elValRelay.textContent = relay;
    elValRelay.className   = 'relay-value ' + relay.toLowerCase();
    elRelayCard.className  = 'relay-card relay-' + relay.toLowerCase();
  }
}


// ════════════════════════════════════════════════════════════════════════════
// SECTION 2: SCHEDULED ACTIONS POLLING
// ════════════════════════════════════════════════════════════════════════════

async function fetchScheduled() {
  try {
    const res  = await fetch(`${API_BASE}/api/scheduled`);
    const data = await res.json();
    renderScheduled(data.scheduled || []);
  } catch (err) {
    // Silent fail — not critical
  }
}

function renderScheduled(items) {
  if (!items.length) {
    elScheduled.innerHTML = '<div class="no-scheduled">No pending scheduled actions</div>';
    return;
  }

  elScheduled.innerHTML = items.map(item => `
    <div class="scheduled-item">
      <span>⏰ Relay → <span class="s-mode">${item.mode}</span></span>
      <span class="s-time">at ${item.fires_at}</span>
    </div>
  `).join('');
}


// ════════════════════════════════════════════════════════════════════════════
// SECTION 3: CHAT INTERFACE
// ════════════════════════════════════════════════════════════════════════════

async function sendMessage() {
  const text = elInput.value.trim();
  if (!text || isAgentThinking) return;

  // Render user bubble
  appendMessage('user', text);
  elInput.value   = '';
  elInput.style.height = 'auto';

  // Show thinking state
  setThinking(true);
  const typingId = appendTypingIndicator();

  try {
    const res  = await fetch(`${API_BASE}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text }),
    });

    const data = await res.json();
    removeElement(typingId);
    appendMessage('agent', data.response || 'No response received.');

    // Refresh scheduled actions after every chat (agent may have scheduled something)
    fetchScheduled();

  } catch (err) {
    removeElement(typingId);
    appendMessage('agent', '❌ Could not reach the backend server. Please check if it is running.');
    console.error('Chat error:', err);
  } finally {
    setThinking(false);
  }
}

function appendMessage(role, text) {
  const id       = 'msg-' + Date.now();
  const isUser   = role === 'user';
  const avatar   = isUser ? 'You' : 'AI';

  // Convert basic markdown to HTML
  const html = markdownToHtml(text);

  const el = document.createElement('div');
  el.id        = id;
  el.className = `msg msg-${role}`;
  el.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-bubble">${html}</div>
  `;

  elMessages.appendChild(el);
  scrollToBottom();
  return id;
}

function appendTypingIndicator() {
  const id = 'typing-' + Date.now();
  const el = document.createElement('div');
  el.id        = id;
  el.className = 'msg msg-agent';
  el.innerHTML = `
    <div class="msg-avatar">AI</div>
    <div class="msg-bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  elMessages.appendChild(el);
  scrollToBottom();
  return id;
}

function removeElement(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function setThinking(thinking) {
  isAgentThinking    = thinking;
  elBtnSend.disabled = thinking;

  if (thinking) {
    elToolStatus.textContent  = 'Agent is reasoning & calling tools...';
    elToolStatus.classList.add('visible');
  } else {
    elToolStatus.classList.remove('visible');
    elToolStatus.textContent  = '';
  }
}

function scrollToBottom() {
  elMessages.scrollTo({ top: elMessages.scrollHeight, behavior: 'smooth' });
}

function clearChat() {
  elMessages.innerHTML = '';
}

// Quick relay buttons from the dashboard panel
function quickRelay(prompt) {
  elInput.value = prompt;
  sendMessage();
}

// ── Keyboard shortcut: Enter sends, Shift+Enter adds newline ───────────────
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── Auto-resize textarea as user types ────────────────────────────────────
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}


// ════════════════════════════════════════════════════════════════════════════
// SECTION 4: MARKDOWN RENDERER (lightweight, no external lib)
// ════════════════════════════════════════════════════════════════════════════

function markdownToHtml(text) {
  // Escape HTML entities first to prevent XSS
  text = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return text
    // Code blocks (```) — must come before inline code
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre style="background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.15);border-radius:8px;padding:0.75rem;overflow-x:auto;font-family:\'JetBrains Mono\',monospace;font-size:0.78rem;margin:0.5rem 0"><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold **text**
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic *text*
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Bullet lists
    .replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul style="padding-left:1.2rem;margin:0.4rem 0">$1</ul>')
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Line breaks
    .replace(/\n\n/g, '</p><p style="margin-top:0.5rem">')
    .replace(/\n/g, '<br>');
}


// ════════════════════════════════════════════════════════════════════════════
// INIT: Start polling loops on page load
// ════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Immediate first fetch
  fetchStatus();
  fetchScheduled();

  // Recurring polls
  setInterval(fetchStatus,   STATUS_INTERVAL);
  setInterval(fetchScheduled, SCHEDULE_INTERVAL);

  // Focus input
  elInput.focus();
});
