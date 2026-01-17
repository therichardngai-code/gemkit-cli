// === State ===
let state = {
  orchestrator: null,
  agents: {},
  sessionId: null,
  activePlan: null,
  currentNotification: null,
  inbox: [],
  documents: [],
  isActive: false,
};

let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

// === DOM Elements ===
const connectionStatus = document.getElementById('connection-status');
const notificationBanner = document.getElementById('notification-banner');
const notificationText = document.getElementById('notification-text');
const orchestratorDesk = document.getElementById('orchestrator-desk');
const agentsGrid = document.getElementById('agents-grid');
const inboxPanel = document.getElementById('inbox-panel');
const docsPanel = document.getElementById('docs-panel');
const inboxContent = document.getElementById('inbox-content');
const docsContent = document.getElementById('docs-content');
const inboxCount = document.getElementById('inbox-count');
const inboxBadge = document.getElementById('inbox-badge');
const docsCount = document.getElementById('docs-count');
const sessionInfo = document.getElementById('session-info');
const agentCount = document.getElementById('agent-count');

// === WebSocket Connection ===
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    connectionStatus.textContent = 'Connected';
    connectionStatus.className = 'status-badge connected';
    reconnectAttempts = 0;
  };

  ws.onclose = () => {
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.className = 'status-badge disconnected';
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws.close();
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'state') {
      state = msg.data;
      render();
    }

    if (msg.type === 'event') {
      handleEvent(msg.data);
    }
  };
}

function scheduleReconnect() {
  if (reconnectAttempts >= maxReconnectAttempts) return;

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
  reconnectAttempts++;

  setTimeout(connect, delay);
}

// === Event Handling ===
function handleEvent(event) {
  // Update notification
  if (['skill_activated', 'handoff_start', 'handoff_complete', 'task_complete'].includes(event.type)) {
    showNotification(event.message, getNotificationType(event.type));
  }
}

function getNotificationType(eventType) {
  const map = {
    skill_activated: 'skill',
    handoff_start: 'handoff',
    handoff_complete: 'success',
    task_complete: 'success',
  };
  return map[eventType] || 'info';
}

// === Rendering ===
function render() {
  renderOrchestrator();
  renderAgents();
  renderInbox();
  renderDocs();
  updateFooter();
}

function renderOrchestrator() {
  if (!state.orchestrator) {
    orchestratorDesk.innerHTML = '<div class="empty-state">No orchestrator active</div>';
    return;
  }

  const o = state.orchestrator;
  const fireClass = o.hasFireEffect ? 'fire-effect' : '';

  orchestratorDesk.innerHTML = `
    <div class="desk-header">
      <span class="desk-icon">${o.icon}</span>
      <span class="desk-title">ORCHESTRATOR</span>
    </div>
    <div class="desk-surface">
      <span>&#x1F4CB;</span>
      <span>&#x1F3AF;</span>
      <span>&#x2713;</span>
    </div>
    <div class="desk-status ${fireClass}">
      <span class="status-indicator ${o.state}">${o.state}</span>
    </div>
    ${o.state === 'working' ? `
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${o.progress}%"></div>
      </div>
    ` : ''}
    <div class="sub-agent-info">Sub-agents: ${o.completedSubAgents}/${o.totalSubAgents}</div>
    ${o.speechBubble ? `<div class="speech-bubble">${escapeHtml(o.speechBubble)}</div>` : ''}
  `;
}

function renderAgents() {
  const agents = Object.values(state.agents);

  if (agents.length === 0) {
    agentsGrid.innerHTML = '<div class="empty-state">No sub-agents spawned</div>';
    return;
  }

  agentsGrid.innerHTML = agents.map(agent => renderAgentDesk(agent)).join('');
}

function renderAgentDesk(agent) {
  const fireClass = agent.hasFireEffect ? 'fire-effect' : '';

  return `
    <div class="desk" id="desk-${agent.id}">
      <div class="desk-header">
        <span class="desk-icon">${agent.icon}</span>
        <span class="desk-title">${formatDisplayName(agent.role)}</span>
      </div>
      <div class="desk-surface">
        <span>&#x1F4BB;</span>
      </div>
      <div class="desk-status ${fireClass}">
        <span class="status-indicator ${agent.state}">${agent.state}</span>
      </div>
      ${agent.state === 'working' ? `
        <div class="progress-bar">
                  <div class="progress-fill" style="width: ${agent.progress}%"></div>
                </div>
              ` : ''}
              ${agent.speechBubble ? `<div class="speech-bubble">${escapeHtml(agent.speechBubble)}</div>` : ''}
            </div>
            `;
          }
          function renderInbox() {
  const items = state.inbox || [];

  inboxCount.textContent = items.length;
  inboxBadge.textContent = items.length;

  if (items.length === 0) {
    inboxContent.innerHTML = '<div class="empty-state">No messages yet</div>';
    return;
  }

  inboxContent.innerHTML = items.map(item => `
    <div class="inbox-item ${item.status}">
      <div class="inbox-item-header">
        <span class="inbox-item-icon">${item.agentIcon}</span>
        <span class="inbox-item-role">${escapeHtml(item.agentRole)}</span>
        <span class="inbox-item-time">${formatRelativeTime(item.timestamp)}</span>
      </div>
      <div class="inbox-item-title">${escapeHtml(item.title)}</div>
      <div class="inbox-item-preview">${escapeHtml(item.preview)}</div>
      <div class="inbox-item-meta">
        <span>&#x23F1;&#xFE0F; ${formatDuration(item.duration)}</span>
        ${item.tokenUsage ? `<span>&#x1F4CA; ${item.tokenUsage.input + item.tokenUsage.output} tokens</span>` : ''}
      </div>
    </div>
  `).join('');
}

function renderDocs() {
  const docs = state.documents || [];
  docsCount.textContent = docs.length;

  if (!state.activePlan) {
    docsContent.innerHTML = '<div class="empty-state">No active plan</div>';
    return;
  }

  const grouped = groupByType(docs);
  const sections = ['plan', 'phase', 'report', 'research', 'artifact', 'other'];
  const titles = {
    plan: '&#x1F4CB; Main Plan',
    phase: '&#x1F4D1; Phases',
    research: '&#x1F50D; Research',
    artifact: '&#x1F4E6; Artifacts',
    report: '&#x1F4CA; Reports',
    other: '&#x1F4C4; Other',
  };

  docsContent.innerHTML = sections
    .filter(type => grouped[type] && grouped[type].length > 0)
    .map(type => `
      <div class="doc-section">
        <div class="doc-section-header">
          ${titles[type]} (${grouped[type].length})
        </div>
        ${grouped[type].map(doc => {
          const recent = Date.now() - doc.modifiedAt < 3600000;
          return `
            <div class="doc-item" onclick="openDocument('${escapeHtml(doc.path)}')">
              <span class="doc-item-icon">${doc.icon}</span>
              <span class="doc-item-name">${escapeHtml(doc.displayName)}</span>
              <span class="doc-item-time ${recent ? 'recent' : ''}">${formatRelativeTime(doc.modifiedAt)}</span>
            </div>
          `;
        }).join('')}
      </div>
    `).join('');
}

function updateFooter() {
  const agents = Object.values(state.agents);
  const activeCount = agents.filter(a => a.state === 'working').length;

  sessionInfo.textContent = state.sessionId
    ? `Session: ${state.sessionId.slice(0, 8)}...`
    : 'No active session';

  agentCount.textContent = `Agents: ${activeCount}/${agents.length}`;
}

// === Notification ===
function showNotification(message, type) {
  notificationText.textContent = message;
  notificationBanner.className = type;
  notificationBanner.classList.remove('hidden');

  setTimeout(() => {
    notificationBanner.classList.add('hidden');
  }, 3000);
}

// === Panel Toggles ===
window.toggleInbox = function() {
  inboxPanel.classList.toggle('open');
  inboxPanel.classList.toggle('hidden');
  docsPanel.classList.remove('open');
  docsPanel.classList.add('hidden');
};

window.toggleDocs = function() {
  docsPanel.classList.toggle('open');
  docsPanel.classList.toggle('hidden');
  inboxPanel.classList.remove('open');
  inboxPanel.classList.add('hidden');
};

// === Utilities ===
function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDisplayName(role) {
  return escapeHtml(role)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function groupByType(docs) {
  return docs.reduce((acc, doc) => {
    acc[doc.type] = acc[doc.type] || [];
    acc[doc.type].push(doc);
    return acc;
  }, {});
}

window.openDocument = function(path) {
  // In web context, we can't open files directly
  // Could add API endpoint to trigger file open
  console.log('Open document:', path);
};

// === Initialize ===
connect();
