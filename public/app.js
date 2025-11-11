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
    // Use dynamic color based on state
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

// Neural network color state
let neuralNetworkColor = {
  r: 0,
  g: 150,
  b: 255,
  isRed: false
};

// Animation loop
function animate() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Update and draw particles
  particles.forEach(particle => {
    particle.update();
    particle.draw();
  });

  // Draw connections with vibrant colors
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
        // Use dynamic color for connections
        const connectionR = neuralNetworkColor.isRed ? 255 : Math.min(neuralNetworkColor.r + 50, 255);
        const connectionG = neuralNetworkColor.isRed ? 0 : Math.min(neuralNetworkColor.g + 50, 255);
        const connectionB = neuralNetworkColor.isRed ? 50 : 255;
        ctx.strokeStyle = `rgba(${connectionR}, ${connectionG}, ${connectionB}, ${opacity})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 5;
        ctx.shadowColor = `rgba(${connectionR}, ${connectionG}, ${connectionB}, ${opacity * 0.5})`;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }

  requestAnimationFrame(animate);
}
animate();

// DOM Elements
const queryInput = document.getElementById('queryInput');
const deepModeToggle = document.getElementById('deepModeToggle');
const startResearchBtn = document.getElementById('startResearchBtn');
const connectionStatus = document.getElementById('connectionStatus');
const statusDot = connectionStatus?.querySelector('.status-dot');
const statusText = connectionStatus?.querySelector('.status-text');
const heroContainer = document.querySelector('.hero-container');

// WebSocket for connection status
let ws = null;

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  ws = new WebSocket(`${protocol}//${host}`);

  ws.onopen = () => {
    if (statusDot && statusText) {
      statusDot.classList.add('connected');
      statusText.textContent = 'CONNECTED';
    }
  };

  ws.onclose = () => {
    if (statusDot && statusText) {
      statusDot.classList.remove('connected');
      statusText.textContent = 'DISCONNECTED';
    }
    setTimeout(connectWebSocket, 5000);
  };
}

connectWebSocket();

// Function to transition neural network to red
function transitionToRed() {
  neuralNetworkColor.isRed = true;
  const startColor = { r: 0, g: 150, b: 255 };
  const endColor = { r: 255, g: 20, b: 60 }; // Vibrant red
  const duration = 800; // milliseconds
  const startTime = Date.now();

  function updateColor() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Smooth easing function
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    neuralNetworkColor.r = Math.round(startColor.r + (endColor.r - startColor.r) * eased);
    neuralNetworkColor.g = Math.round(startColor.g + (endColor.g - startColor.g) * eased);
    neuralNetworkColor.b = Math.round(startColor.b + (endColor.b - startColor.b) * eased);

    if (progress < 1) {
      requestAnimationFrame(updateColor);
    }
  }

  updateColor();
}

// Handle Enter key in search input
queryInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    transitionToRed();
    startResearchBtn.click();
  }
});

// Button Event Listeners
startResearchBtn.addEventListener('click', () => {
  const query = queryInput.value.trim();
  
  if (!query) {
    return;
  }
  
  // Transition to red if not already triggered
  if (!neuralNetworkColor.isRed) {
    transitionToRed();
  }
  
  // Add collapsing animation
  if (heroContainer) {
    heroContainer.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
    heroContainer.style.opacity = '0';
    heroContainer.style.transform = 'translateY(-30px)';
  }
  
  // Wait for animation to complete before navigating
  setTimeout(() => {
    // Navigate to research page with query parameters
    const params = new URLSearchParams({
      query: query,
      deepMode: deepModeToggle.checked,
      redMode: 'true' // Signal that neural network should be red
    });
    
    window.location.href = `/research.html?${params.toString()}`;
  }, 500);
});
