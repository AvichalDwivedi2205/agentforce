// Neural Network Animation
const canvas = document.getElementById('neuralNetwork');
const ctx = canvas.getContext('2d');

// Set canvas size
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Particle class
class Particle {
  constructor() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.vx = (Math.random() - 0.5) * 0.5;
    this.vy = (Math.random() - 0.5) * 0.5;
    this.radius = Math.random() * 2 + 1;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;

    if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
    if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
  }

  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 150, 255, 0.9)`;
    ctx.shadowBlur = 15;
    ctx.shadowColor = 'rgba(0, 150, 255, 0.8)';
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// Create particles
const particles = [];
const particleCount = 120;
for (let i = 0; i < particleCount; i++) {
  particles.push(new Particle());
}

// Animation loop
function animate() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  particles.forEach(particle => {
    particle.update();
    particle.draw();
  });

  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 180) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        const opacity = (1 - distance / 180) * 0.6;
        ctx.strokeStyle = `rgba(0, 200, 255, ${opacity})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 5;
        ctx.shadowColor = `rgba(0, 200, 255, ${opacity * 0.5})`;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }

  requestAnimationFrame(animate);
}
animate();

// Get query parameters
const urlParams = new URLSearchParams(window.location.search);
const query = urlParams.get('query');
const deepMode = urlParams.get('deepMode') === 'true';

// WebSocket connection
let ws = null;
let reconnectInterval = null;

// DOM Elements
const connectionStatus = document.getElementById('connectionStatus');
const statusDot = connectionStatus.querySelector('.status-dot');
const statusText = connectionStatus.querySelector('.status-text');
const queryDisplay = document.getElementById('queryDisplay');
const modeBadge = document.getElementById('modeBadge');
const actionsSection = document.getElementById('actionsSection');
const actionsTimeline = document.getElementById('actionsTimeline');
const progressStats = document.getElementById('progressStats');
const resultsSection = document.getElementById('resultsSection');
const reportPreview = document.getElementById('reportPreview');
const copyMarkdownBtn = document.getElementById('copyMarkdownBtn');
const downloadMarkdownBtn = document.getElementById('downloadMarkdownBtn');
const newResearchBtn = document.getElementById('newResearchBtn');

// State
let currentMarkdown = '';
let stats = {
  sources: 0,
  queries: 0,
  apiCalls: 0
};

// Display query
if (query) {
  queryDisplay.textContent = query;
  modeBadge.textContent = deepMode ? 'DEEP MODE' : 'STANDARD MODE';
  modeBadge.className = `mode-badge ${deepMode ? 'deep' : 'standard'}`;
}

// Initialize WebSocket connection
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  ws = new WebSocket(`${protocol}//${host}`);

  ws.onopen = () => {
    console.log('WebSocket connected');
    updateConnectionStatus('connected');
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
    
    // Start research automatically
    if (query) {
      startResearch();
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    updateConnectionStatus('disconnected');
    
    if (!reconnectInterval) {
      reconnectInterval = setInterval(() => {
        console.log('Attempting to reconnect...');
        connectWebSocket();
      }, 5000);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateConnectionStatus('disconnected');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  };
}

// Update connection status
function updateConnectionStatus(status) {
  if (status === 'connected') {
    statusDot.classList.add('connected');
    statusDot.classList.remove('disconnected');
    statusText.textContent = 'Connected';
  } else {
    statusDot.classList.remove('connected');
    statusDot.classList.add('disconnected');
    statusText.textContent = 'Disconnected';
  }
}

// Start research
function startResearch() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket not connected');
    return;
  }
  
  ws.send(JSON.stringify({
    type: 'START_RESEARCH',
    query,
    deepMode,
    skipClarify: true
  }));
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
  console.log('Received message:', data.type);

  switch (data.type) {
    case 'RESEARCH_STARTED':
      onResearchStarted(data);
      break;
    case 'AGENT_ACTION':
      onAgentAction(data);
      break;
    case 'RESEARCH_PROGRESS':
      onResearchProgress(data);
      break;
    case 'RESEARCH_COMPLETE':
      onResearchComplete(data);
      break;
    case 'RESEARCH_ERROR':
      onResearchError(data);
      break;
  }
}

// Event handlers
function onResearchStarted(data) {
  console.log('Research started:', data.query);
  
  addTimelineItem({
    title: 'RESEARCH STARTED',
    description: `Starting comprehensive research on: "${data.query}"`,
    time: new Date().toLocaleTimeString(),
    status: 'searching'
  });
}

function onAgentAction(data) {
  console.log('Agent action:', data);
  
  if (data.action === 'search') {
    stats.queries++;
    stats.apiCalls++;
  } else if (data.action === 'analyze' || data.action === 'synthesize') {
    stats.apiCalls++;
  }
  
  updateStats();
  
  addTimelineItem({
    title: `${data.title || capitalizeFirst(data.action)}`.toUpperCase(),
    description: data.description || 'Processing...',
    time: new Date().toLocaleTimeString(),
    status: data.action === 'complete' ? 'complete' : 'searching',
    meta: data.meta
  });
}

function onResearchProgress(data) {
  console.log('Research progress:', data);
  
  if (data.sources) stats.sources = data.sources;
  if (data.queries) stats.queries = data.queries;
  if (data.apiCalls) stats.apiCalls = data.apiCalls;
  
  updateStats();
}

function onResearchComplete(data) {
  console.log('Research complete');
  
  addTimelineItem({
    title: 'RESEARCH COMPLETE',
    description: `Generated comprehensive report with ${data.meta.totalSources || 0} sources`,
    time: new Date().toLocaleTimeString(),
    status: 'complete'
  });
  
  currentMarkdown = data.markdown;
  renderMarkdown(data.markdown);
  
  resultsSection.style.display = 'block';
  resultsSection.scrollIntoView({ behavior: 'smooth' });
}

function onResearchError(data) {
  console.error('Research error:', data.error);
  
  addTimelineItem({
    title: 'RESEARCH ERROR',
    description: data.error || 'An error occurred during research',
    time: new Date().toLocaleTimeString(),
    status: 'complete'
  });
}

// UI Helper Functions
function addTimelineItem({ title, description, time, status = 'searching', meta }) {
  const item = document.createElement('div');
  item.className = `timeline-item ${status}`;
  
  let metaHtml = '';
  if (meta) {
    const metaItems = [];
    if (meta.theme) metaItems.push(`<span class="meta-item">Theme: ${meta.theme}</span>`);
    if (meta.sources) metaItems.push(`<span class="meta-item">${meta.sources} sources</span>`);
    if (meta.model) metaItems.push(`<span class="meta-item">Model: ${meta.model}</span>`);
    
    if (metaItems.length > 0) {
      metaHtml = `<div class="action-meta">${metaItems.join('')}</div>`;
    }
  }
  
  item.innerHTML = `
    <div class="action-header">
      <div class="action-title">${title}</div>
      <div class="action-time">${time}</div>
    </div>
    <div class="action-description">${description}</div>
    ${metaHtml}
  `;
  
  actionsTimeline.appendChild(item);
  actionsTimeline.scrollTop = actionsTimeline.scrollHeight;
}

function updateStats() {
  progressStats.innerHTML = `
    <span class="stat">${stats.sources} sources</span>
    <span class="stat">${stats.queries} queries</span>
    <span class="stat">${stats.apiCalls} API calls</span>
  `;
}

function renderMarkdown(markdown) {
  let html = markdown
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n\n/gim, '</p><p>')
    .replace(/\n/gim, '<br>');
  
  reportPreview.innerHTML = `<p>${html}</p>`;
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Button Event Listeners
copyMarkdownBtn.addEventListener('click', () => {
  if (!currentMarkdown) return;
  
  navigator.clipboard.writeText(currentMarkdown).then(() => {
    const originalText = copyMarkdownBtn.innerHTML;
    copyMarkdownBtn.innerHTML = 'Copied!';
    setTimeout(() => {
      copyMarkdownBtn.innerHTML = originalText;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy:', err);
    alert('Failed to copy to clipboard');
  });
});

downloadMarkdownBtn.addEventListener('click', () => {
  if (!currentMarkdown) return;
  
  const blob = new Blob([currentMarkdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `research-report-${Date.now()}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

newResearchBtn.addEventListener('click', () => {
  window.location.href = '/';
});

// Initialize on page load
connectWebSocket();
