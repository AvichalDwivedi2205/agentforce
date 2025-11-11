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
    // Use red color for particles during research
    ctx.fillStyle = `rgba(${neuralNetworkColor.r}, ${neuralNetworkColor.g}, ${neuralNetworkColor.b}, 0.9)`;
    ctx.shadowBlur = 15;
    ctx.shadowColor = `rgba(${neuralNetworkColor.r}, ${neuralNetworkColor.g}, ${neuralNetworkColor.b}, 0.8)`;
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

// Neural network color state - Start with RED for research page
let neuralNetworkColor = {
  r: 255,
  g: 20,
  b: 60,
  isResearching: true
};

// Target blue color for completion
const blueColor = { r: 0, g: 200, b: 255 };

// Transition neural network to blue
function transitionToBlue() {
  const duration = 2000; // 2 seconds
  const startTime = Date.now();
  const startColor = { ...neuralNetworkColor };
  
  function animate() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Ease out cubic
    const easeProgress = 1 - Math.pow(1 - progress, 3);
    
    neuralNetworkColor.r = Math.round(startColor.r + (blueColor.r - startColor.r) * easeProgress);
    neuralNetworkColor.g = Math.round(startColor.g + (blueColor.g - startColor.g) * easeProgress);
    neuralNetworkColor.b = Math.round(startColor.b + (blueColor.b - startColor.b) * easeProgress);
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  }
  
  animate();
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
        // Use red color for connections during research
        ctx.strokeStyle = `rgba(${neuralNetworkColor.r}, ${neuralNetworkColor.g}, ${neuralNetworkColor.b}, ${opacity})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 5;
        ctx.shadowColor = `rgba(${neuralNetworkColor.r}, ${neuralNetworkColor.g}, ${neuralNetworkColor.b}, ${opacity * 0.5})`;
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
const mainLayout = document.getElementById('mainLayout');
const leftPanel = document.getElementById('leftPanel');
const rightPanel = document.getElementById('rightPanel');
const actionsTimeline = document.getElementById('actionsTimeline');
const progressStats = document.getElementById('progressStats');
const reportPreview = document.getElementById('reportPreview');
const copyMarkdownBtn = document.getElementById('copyMarkdownBtn');
const downloadMarkdownBtn = document.getElementById('downloadMarkdownBtn');
const generatePresentationBtn = document.getElementById('generatePresentationBtn');
const viewPresentationsBtn = document.getElementById('viewPresentationsBtn');
const newResearchBtn = document.getElementById('newResearchBtn');
const presentationStatus = document.getElementById('presentationStatus');
const presentationStatusMessage = document.getElementById('presentationStatusMessage');
const viewPresentationBtn = document.getElementById('viewPresentationBtn');

// State
let currentMarkdown = '';
let currentPresentationUrl = '';
let stats = {
  sources: 0,
  queries: 0,
  apiCalls: 0
};

// Activity Graph State
let activityData = [];
let maxActivityPoints = 50;

// Display query
if (query) {
  queryDisplay.textContent = query;
  const modeBadgeElement = document.getElementById('modeBadge');
  if (modeBadgeElement) {
    modeBadgeElement.textContent = deepMode ? 'DEEP MODE' : 'STANDARD MODE';
    modeBadgeElement.className = deepMode ? 'mode-badge-research deep' : 'mode-badge-research standard';
  }
  
  // Update analytics
  setTimeout(() => {
    const complexityEl = document.getElementById('queryComplexity');
    const timeEl = document.getElementById('estimatedTime');
    if (complexityEl) complexityEl.textContent = deepMode ? 'High Complexity' : 'Standard';
    if (timeEl) timeEl.textContent = deepMode ? 'Est. 2-3 min' : 'Est. 1-2 min';
  }, 500);
}

// Initialize Activity Graph
function initActivityGraph() {
  const canvas = document.getElementById('activityGraph');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = 80;
  
  // Initialize with zeros
  for (let i = 0; i < maxActivityPoints; i++) {
    activityData.push(0);
  }
  
  drawActivityGraph();
}

// Draw Activity Graph
function drawActivityGraph() {
  const canvas = document.getElementById('activityGraph');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  
  // Clear canvas
  ctx.clearRect(0, 0, width, height);
  
  // Draw grid
  ctx.strokeStyle = 'rgba(255, 20, 60, 0.1)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  
  // Draw activity line
  const pointWidth = width / maxActivityPoints;
  const maxValue = Math.max(...activityData, 10);
  
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255, 20, 60, 0.8)';
  ctx.lineWidth = 2;
  ctx.shadowBlur = 10;
  ctx.shadowColor = 'rgba(255, 20, 60, 0.6)';
  
  for (let i = 0; i < activityData.length; i++) {
    const x = i * pointWidth;
    const y = height - (activityData[i] / maxValue) * height;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  
  // Fill area under line
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 20, 60, 0.15)';
  ctx.fill();
}

// Update Activity Graph
function updateActivityGraph(value) {
  activityData.shift();
  activityData.push(value);
  drawActivityGraph();
}

// Animate CPU usage
function animateCPU() {
  const cpuFill = document.getElementById('cpuFill');
  if (cpuFill) {
    setInterval(() => {
      const usage = 30 + Math.random() * 55;
      cpuFill.style.width = usage + '%';
    }, 2000);
  }
}

// Initialize on load
setTimeout(() => {
  initActivityGraph();
  animateCPU();
}, 100);

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
  const statusDotResearch = document.querySelector('.status-dot-research');
  const statusTextResearch = document.querySelector('.status-text-research');
  const systemStatus = document.getElementById('systemStatus');
  
  if (status === 'connected') {
    if (statusDot) {
      statusDot.classList.add('connected');
      statusDot.classList.remove('disconnected');
      statusText.textContent = 'Connected';
    }
    if (statusTextResearch) {
      statusTextResearch.textContent = 'SYNC';
      statusTextResearch.style.color = '#00ff88';
    }
    if (statusDotResearch) {
      statusDotResearch.style.background = '#00ff88';
      statusDotResearch.style.boxShadow = '0 0 8px rgba(0, 255, 136, 0.8)';
    }
    if (systemStatus) {
      systemStatus.textContent = 'ACTIVE';
    }
  } else {
    if (statusDot) {
      statusDot.classList.remove('connected');
      statusDot.classList.add('disconnected');
      statusText.textContent = 'Disconnected';
    }
    if (statusTextResearch) {
      statusTextResearch.textContent = 'OFFLINE';
      statusTextResearch.style.color = '#ff143c';
    }
    if (statusDotResearch) {
      statusDotResearch.style.background = '#ff143c';
      statusDotResearch.style.boxShadow = '0 0 8px rgba(255, 20, 60, 0.8)';
    }
    if (systemStatus) {
      systemStatus.textContent = 'ERROR';
      systemStatus.style.color = '#ff143c';
    }
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
  
  // Show right panel with animation
  const layout = mainLayout || document.getElementById('mainLayout');
  if (layout) {
    layout.classList.add('two-panels');
  }
  if (rightPanel) {
    rightPanel.style.display = 'block';
  }
  
  // Transition neural network to blue when research completes
  neuralNetworkColor.isResearching = false;
  transitionToBlue();
  
  // Add completion visual effects
  document.body.classList.add('research-complete');
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
  // Update stat cards
  const sourcesCount = document.getElementById('sourcesCount');
  const queriesCount = document.getElementById('queriesCount');
  const apiCallsCount = document.getElementById('apiCallsCount');
  
  if (sourcesCount) sourcesCount.textContent = stats.sources;
  if (queriesCount) queriesCount.textContent = stats.queries;
  if (apiCallsCount) apiCallsCount.textContent = stats.apiCalls;
  
  // Update activity graph
  const activityValue = stats.queries + stats.apiCalls;
  updateActivityGraph(activityValue);
  
  // Fallback for old layout
  if (progressStats && !sourcesCount) {
    progressStats.innerHTML = `
      <span class="stat">${stats.sources} sources</span>
      <span class="stat">${stats.queries} queries</span>
      <span class="stat">${stats.apiCalls} API calls</span>
    `;
  }
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

generatePresentationBtn.addEventListener('click', async () => {
  if (!currentMarkdown) return;
  
  // Show status
  presentationStatus.style.display = 'block';
  presentationStatusMessage.textContent = 'Generating presentation... This may take a moment.';
  presentationStatusMessage.style.color = '#00c8ff';
  viewPresentationBtn.style.display = 'none';
  generatePresentationBtn.disabled = true;
  generatePresentationBtn.textContent = 'Generating...';
  
  try {
    const response = await fetch('/api/generate-presentation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ markdown: currentMarkdown })
    });
    
    if (!response.ok) {
      throw new Error('Failed to generate presentation');
    }
    
    const data = await response.json();
    
    if (data.success) {
      currentPresentationUrl = data.filename;
      presentationStatusMessage.textContent = 'Presentation generated successfully!';
      presentationStatusMessage.style.color = '#00ff88';
      viewPresentationBtn.style.display = 'inline-block';
      viewPresentationBtn.onclick = () => {
        window.open(`/presentations/${currentPresentationUrl}`, '_blank');
      };
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (error) {
    console.error('Presentation generation error:', error);
    presentationStatusMessage.textContent = `Error: ${error.message}`;
    presentationStatusMessage.style.color = '#ff4444';
  } finally {
    generatePresentationBtn.disabled = false;
    generatePresentationBtn.textContent = 'Generate Presentation';
  }
});

viewPresentationsBtn.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/presentations');
    if (!response.ok) {
      throw new Error('Failed to fetch presentations');
    }
    
    const data = await response.json();
    
    if (data.presentations && data.presentations.length > 0) {
      // Open presentations list in a new modal or window
      showPresentationsList(data.presentations);
    } else {
      alert('No presentations available yet. Generate one first!');
    }
  } catch (error) {
    console.error('Error fetching presentations:', error);
    alert('Failed to load presentations');
  }
});

function showPresentationsList(presentations) {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.className = 'presentation-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>All Presentations</h2>
        <button class="close-modal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="presentations-grid">
          ${presentations.map((p, index) => `
            <div class="presentation-card">
              <div class="card-header">
                <h3>Presentation ${presentations.length - index}</h3>
                <span class="card-date">${new Date(p.timestamp).toLocaleString()}</span>
              </div>
              <button class="view-presentation-card-btn" data-url="${p.url}">
                View Presentation
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add event listeners
  modal.querySelector('.close-modal').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
  
  modal.querySelectorAll('.view-presentation-card-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const url = e.target.getAttribute('data-url');
      window.open(url, '_blank');
    });
  });
}

// Initialize on page load
connectWebSocket();
