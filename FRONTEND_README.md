# 🔬 Deep Research Agent - Web Frontend

A minimalistic dark-themed web interface for the Deep Research Agent with real-time action tracking.

## ✨ Features

- **Dark Theme UI** - Modern, sleek interface optimized for readability
- **Real-time Action Tracking** - Watch your agent work in real-time with live updates
- **WebSocket Communication** - Instant bidirectional updates between frontend and backend
- **Progress Statistics** - Track sources, queries, and API calls as research progresses
- **Markdown Report Generation** - View, copy, and download comprehensive research reports
- **Deep Mode Toggle** - Switch between standard and enhanced research modes

## 🚀 Quick Start

### 1. Environment Setup

Make sure you have a `.env` file in the root directory with your API keys:

```bash
# Required API Keys
OPENROUTER_API_KEY=your_openrouter_api_key
TAVILY_API_KEY=your_tavily_api_key
PERPLEXITY_API_KEY=your_perplexity_api_key

# Optional
PORT=3000  # Default is 3000
```

You can copy from `env.template`:
```bash
cp env.template .env
# Then edit .env with your actual API keys
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Start the Server

```bash
# Production mode
pnpm server

# Development mode (auto-restart on changes)
pnpm server:dev
```

The server will start on `http://localhost:3000`

### 4. Open the Frontend

Navigate to `http://localhost:3000` in your browser. You should see the Deep Research Agent interface!

## 🎨 UI Overview

### Header
- **Connection Status** - Shows real-time WebSocket connection status
- **Title and Subtitle** - Branding and description

### Query Section
- **Query Input** - Enter your research question
- **Deep Mode Toggle** - Enable for enhanced research with more sources
- **Start Research Button** - Initiates the research process

### Agent Actions Timeline
- **Real-time Updates** - See each step the agent takes
- **Action Details** - View descriptions, timestamps, and metadata
- **Progress Stats** - Track sources, queries, and API calls

### Results Section
- **Report Preview** - Rendered markdown with proper formatting
- **Copy Button** - Copy markdown to clipboard
- **Download Button** - Save report as `.md` file

## 🔧 Architecture

```
agentforce/
├── server/
│   └── index.ts          # Express + WebSocket server
├── public/
│   ├── index.html        # Frontend HTML
│   ├── styles.css        # Dark theme styles
│   └── app.js            # WebSocket client & UI logic
└── lib/ai/graphs/research/
    ├── graph.ts          # Research agent (emits events)
    └── eventEmitter.ts   # Event emission helper
```

### Data Flow

1. **User Input** → Frontend sends query via WebSocket
2. **Backend Processing** → Research agent processes with event emission
3. **Real-time Updates** → Events streamed to frontend via WebSocket
4. **Report Generation** → Final markdown sent to frontend
5. **Display** → Rendered in UI with copy/download options

## 📡 WebSocket Events

### Client → Server
```typescript
{
  type: 'START_RESEARCH',
  query: string,
  deepMode: boolean,
  skipClarify: boolean
}
```

### Server → Client

**Research Started**
```typescript
{
  type: 'RESEARCH_STARTED',
  query: string
}
```

**Agent Action**
```typescript
{
  type: 'AGENT_ACTION',
  action: 'decompose' | 'search' | 'extract' | 'analyze' | 'synthesize' | 'complete',
  title: string,
  description: string,
  meta?: {
    theme?: string,
    sources?: number,
    model?: string
  }
}
```

**Research Progress**
```typescript
{
  type: 'RESEARCH_PROGRESS',
  step: string,
  sources: number,
  queries: number,
  apiCalls: number
}
```

**Research Complete**
```typescript
{
  type: 'RESEARCH_COMPLETE',
  report: Report,
  markdown: string,
  meta: {
    totalSources: number,
    themes: number,
    runtime: number
  }
}
```

**Research Error**
```typescript
{
  type: 'RESEARCH_ERROR',
  error: string
}
```

## 🎯 Usage Examples

### Basic Research
1. Enter query: "Analyze the rise and fall of Stability AI"
2. Click "Start Research"
3. Watch the agent work in real-time
4. View/download the comprehensive report

### Deep Research Mode
1. Enter complex query
2. ✅ Check "Deep Mode (Enhanced Research)"
3. Click "Start Research"
4. Get more comprehensive analysis with additional sources

## 🛠 Development

### File Structure

**`server/index.ts`**
- Express server setup
- WebSocket server initialization
- Event listener setup
- Request handling

**`public/index.html`**
- Semantic HTML structure
- Accessible form elements
- Section organization

**`public/styles.css`**
- CSS custom properties (dark theme variables)
- Responsive design
- Animation keyframes
- Component styling

**`public/app.js`**
- WebSocket client connection
- Event handling
- DOM manipulation
- Markdown rendering (basic)

**`lib/ai/graphs/research/eventEmitter.ts`**
- Event emission utilities
- Action tracking
- Progress updates

**`lib/ai/graphs/research/graph.ts`**
- Research agent logic (unchanged core logic)
- Event emission at key steps
- Progress tracking

### Customization

**Change Theme Colors**
Edit CSS variables in `public/styles.css`:
```css
:root {
  --bg-primary: #0a0e27;      /* Main background */
  --accent-primary: #6366f1;   /* Primary accent color */
  --text-primary: #e4e4e7;     /* Primary text */
  /* ... more variables */
}
```

**Adjust Server Port**
Set in `.env`:
```bash
PORT=8080
```

**Modify Research Behavior**
The frontend doesn't change research logic - that's all in `lib/ai/graphs/research/graph.ts`

## 🔍 Troubleshooting

### WebSocket Connection Issues
- **Check Server Status**: Ensure server is running on the correct port
- **Firewall**: Make sure port 3000 (or custom port) is not blocked
- **Browser Console**: Check for WebSocket errors in dev tools

### Missing Environment Variables
```
Error: Missing env: OPENROUTER_API_KEY
```
**Solution**: Create/update `.env` file with all required API keys

### UI Not Loading
- **Check Static Files**: Ensure `public/` directory exists
- **Server Logs**: Check terminal for Express errors
- **Browser Cache**: Try hard refresh (Ctrl+Shift+R)

### Research Not Starting
- **API Keys**: Verify all API keys are valid
- **Network**: Check internet connection for API calls
- **Browser Console**: Look for JavaScript errors

## 📝 API Keys Required

1. **OpenRouter** - For LLM calls (GPT, Claude, Mistral, etc.)
   - Get at: https://openrouter.ai/

2. **Tavily** - For web search and content extraction
   - Get at: https://tavily.com/

3. **Perplexity** - For advanced research queries
   - Get at: https://perplexity.ai/

## 🚀 Deployment

### Local Development
```bash
pnpm server:dev
```

### Production
```bash
pnpm server
```

### Docker (Future)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN pnpm install --production
COPY . .
EXPOSE 3000
CMD ["pnpm", "server"]
```

## 🎨 Design Philosophy

- **Minimalistic** - Clean, focused interface without clutter
- **Dark Theme** - Reduces eye strain for long research sessions
- **Real-time Feedback** - Users see exactly what the agent is doing
- **Responsive** - Works on desktop, tablet, and mobile
- **Accessible** - Semantic HTML, keyboard navigation support

## 📊 Performance

- **WebSocket** - Low latency real-time updates
- **Streaming** - Events sent as they happen, no polling
- **Efficient** - Only necessary DOM updates
- **Optimized** - Minimal CSS and JS, no heavy frameworks

## 🔒 Security Notes

- API keys should never be exposed to the frontend
- All API calls go through the backend server
- WebSocket validates message types
- CORS should be configured for production

## 📚 Tech Stack

- **Backend**: Node.js, Express, TypeScript, WebSocket (ws)
- **Frontend**: Vanilla HTML/CSS/JavaScript (no framework)
- **Agent**: LangChain, OpenRouter, Tavily, Perplexity
- **Build Tool**: tsx (TypeScript execution)

## 🤝 Contributing

The frontend is designed to be simple and extensible. Feel free to:
- Add new visualizations
- Improve the timeline UI
- Enhance markdown rendering
- Add more interaction features

## 📄 License

Same as the main project.

---

**Enjoy researching with your AI agent!** 🚀🔬
