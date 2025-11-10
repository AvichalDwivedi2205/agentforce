# Presentation Feature Architecture

## System Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│                     (research.html/research.js)                 │
└───────────────┬─────────────────────────────────┬───────────────┘
                │                                 │
                │ 1. Complete Research           │ 2. View All
                │    Click "Generate"            │    Presentations
                ▼                                 ▼
┌───────────────────────────────┐   ┌─────────────────────────────┐
│  POST /api/generate-          │   │  GET /api/presentations     │
│       presentation            │   │                             │
│                               │   │  Returns list of all        │
│  Body: { markdown: "..." }    │   │  generated presentations    │
└───────────────┬───────────────┘   └─────────────────────────────┘
                │
                │ 3. Server receives request
                ▼
┌───────────────────────────────────────────────────────────────┐
│                       SERVER (server/index.ts)                │
│                                                               │
│  • Receives markdown content                                 │
│  • Calls generatePresentation()                              │
│  • Saves HTML to generated_files/                            │
│  • Returns filename and HTML                                 │
└───────────────┬───────────────────────────────────────────────┘
                │
                │ 4. Calls Presentation Agent
                ▼
┌───────────────────────────────────────────────────────────────┐
│              PRESENTATION AGENT                               │
│         (agents/presentation/index.ts)                        │
│                                                               │
│  generatePresentation(markdown) {                            │
│    1. Create agent instance                                  │
│    2. Build prompt with research content                     │
│    3. Invoke LLM (Claude 3.5 Sonnet)                        │
│    4. Clean and validate HTML output                         │
│    5. Return complete HTML document                          │
│  }                                                            │
└───────────────┬───────────────────────────────────────────────┘
                │
                │ 5. LLM Processing
                ▼
┌───────────────────────────────────────────────────────────────┐
│                    CLAUDE 3.5 SONNET                          │
│              (via OpenRouter API)                             │
│                                                               │
│  System Prompt: "Create professional HTML/CSS presentation"  │
│  Input: Research markdown content                            │
│  Output: Complete HTML with:                                 │
│    - <!DOCTYPE html>                                         │
│    - <style> with modern CSS                                 │
│    - <script> with navigation                                │
│    - Responsive design                                       │
│    - Animations and transitions                              │
└───────────────┬───────────────────────────────────────────────┘
                │
                │ 6. HTML returned
                ▼
┌───────────────────────────────────────────────────────────────┐
│                    FILE SYSTEM                                │
│               (generated_files/)                              │
│                                                               │
│  presentation-2025-11-11T12-00-00-000Z.html                  │
│  presentation-2025-11-11T13-30-15-123Z.html                  │
│  ...                                                          │
└───────────────┬───────────────────────────────────────────────┘
                │
                │ 7. File saved, response sent
                ▼
┌───────────────────────────────────────────────────────────────┐
│                      USER INTERFACE                           │
│                                                               │
│  • Shows success message                                      │
│  • Displays "View Presentation" button                        │
│  • User clicks → Opens in new tab                            │
│  • GET /presentations/:filename                              │
└───────────────────────────────────────────────────────────────┘
```

## Component Interaction

```
┌─────────────────────────────────────────────────────────────────┐
│                      AGENT ECOSYSTEM                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐                                           │
│  │  Orchestrator   │  ← Coordinates all agents                 │
│  │     Agent       │                                            │
│  └────────┬────────┘                                           │
│           │                                                     │
│           │ Delegates to:                                       │
│           │                                                     │
│  ┌────────┼────────────────────────────────────┐               │
│  │        │                                    │               │
│  ▼        ▼                                    ▼               │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐             │
│  │  Gmail   │  │ Research │  │  Presentation    │  ← NEW!     │
│  │  Agent   │  │  Agent   │  │     Agent        │             │
│  └──────────┘  └──────────┘  └──────────────────┘             │
│                      │               │                          │
│                      │               │                          │
│                      ▼               ▼                          │
│                Generates      Converts to                       │
│                Reports    →   Presentations                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
USER ACTION                    FRONTEND                 BACKEND                   AI
    │                             │                        │                     │
    │ 1. Click "Generate"         │                        │                     │
    ├────────────────────────────▶│                        │                     │
    │                             │                        │                     │
    │                             │ 2. POST /api/generate  │                     │
    │                             ├───────────────────────▶│                     │
    │                             │   { markdown }         │                     │
    │                             │                        │                     │
    │                             │                        │ 3. generatePres()   │
    │                             │                        ├────────────────────▶│
    │                             │                        │   (markdown)        │
    │                             │                        │                     │
    │                             │                        │  4. Process         │
    │                             │                        │     Create slides   │
    │                             │                        │     Design layout   │
    │                             │                        │     Add navigation  │
    │                             │                        │     Apply CSS       │
    │                             │                        │                     │
    │                             │                        │ 5. HTML ◀───────────┤
    │                             │                        │                     │
    │                             │                        │ 6. Save to file     │
    │                             │                        │    ↓                │
    │                             │                        │ generated_files/    │
    │                             │                        │                     │
    │                             │ 7. { success, filename }│                    │
    │                             │◀───────────────────────┤                     │
    │                             │                        │                     │
    │ 8. Show "View" button       │                        │                     │
    │◀────────────────────────────┤                        │                     │
    │                             │                        │                     │
    │ 9. Click "View"             │                        │                     │
    ├────────────────────────────▶│                        │                     │
    │                             │                        │                     │
    │                             │ 10. GET /presentations/:filename             │
    │                             ├───────────────────────▶│                     │
    │                             │                        │                     │
    │                             │ 11. HTML content       │                     │
    │ 12. Open in new tab         │◀───────────────────────┤                     │
    │◀────────────────────────────┤                        │                     │
    │                             │                        │                     │
```

## File Structure

```
agentforce/
├── agents/
│   ├── presentation/           ← NEW AGENT
│   │   ├── index.ts            ← Agent implementation
│   │   └── prompt.ts           ← System prompt
│   │
│   ├── orchestrator/           ← UPDATED
│   │   ├── index.ts            ← Added PresentationAgentTool
│   │   └── prompt.ts           ← Added agent description
│   │
│   ├── research/
│   │   ├── index.ts
│   │   └── prompt.ts
│   │
│   └── gmail/
│       ├── index.ts
│       └── prompt.ts
│
├── server/
│   └── index.ts                ← UPDATED: Added 3 new endpoints
│
├── public/
│   ├── research.html           ← UPDATED: Added buttons
│   ├── research.js             ← UPDATED: Added functionality
│   └── styles.css              ← UPDATED: Added styles
│
├── generated_files/            ← PRESENTATION STORAGE
│   ├── presentation-*.html     ← Generated presentations
│   ├── report-*.md
│   └── ideation-*.md
│
├── PRESENTATION_FEATURE.md     ← NEW: Feature documentation
├── IMPLEMENTATION_SUMMARY.md   ← NEW: Implementation details
├── QUICKSTART_PRESENTATIONS.md ← NEW: Quick start guide
└── ARCHITECTURE.md             ← NEW: This file
```

## Key Technologies

```
┌────────────────────────────────────────────────────────┐
│                    TECH STACK                          │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Frontend:                                             │
│  • Vanilla JavaScript                                  │
│  • WebSocket for real-time updates                    │
│  • Fetch API for REST calls                           │
│  • CSS3 animations                                     │
│                                                        │
│  Backend:                                              │
│  • Express.js server                                   │
│  • TypeScript                                          │
│  • Node.js file system (fs)                           │
│  • WebSocket Server (ws)                              │
│                                                        │
│  AI/Agents:                                            │
│  • LangChain framework                                 │
│  • Claude 3.5 Sonnet (via OpenRouter)                │
│  • Agent architecture with tools                       │
│  • Memory management                                   │
│                                                        │
│  Generated Presentations:                              │
│  • HTML5                                               │
│  • CSS3 (Flexbox, Grid, Animations)                  │
│  • Vanilla JavaScript (Navigation)                     │
│  • No external dependencies                            │
│                                                        │
└────────────────────────────────────────────────────────┘
```

## API Endpoints Summary

```
┌─────────────────────────────────────────────────────────────┐
│                      API ROUTES                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  POST   /api/generate-presentation                          │
│         Generate HTML presentation from markdown            │
│         Body: { markdown: string }                          │
│         Returns: { success, filename, html }               │
│                                                             │
│  GET    /api/presentations                                  │
│         List all generated presentations                    │
│         Returns: { presentations: [...] }                  │
│                                                             │
│  GET    /presentations/:filename                            │
│         Serve a specific presentation                       │
│         Returns: HTML content                              │
│                                                             │
│  GET    /api/health                                         │
│         Health check                                        │
│         Returns: { status, connections }                   │
│                                                             │
│  WebSocket Connection                                       │
│         Real-time research updates                          │
│         Messages: START_RESEARCH, RESEARCH_PROGRESS, etc.  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Security & Best Practices

```
✅ Input Validation
   • Markdown content sanitized
   • File paths validated
   • Filenames follow strict pattern

✅ Error Handling
   • Try-catch blocks in all async functions
   • User-friendly error messages
   • Detailed logging for debugging

✅ File Management
   • Controlled file storage location
   • Timestamp-based unique filenames
   • No arbitrary file writes

✅ AI Safety
   • System prompts prevent harmful content
   • Output validation (HTML structure check)
   • Rate limiting (implicit via LLM API)

✅ Frontend Security
   • No eval() or innerHTML with user input
   • XSS prevention in modal creation
   • CORS handled appropriately
```

## Performance Considerations

```
⚡ Optimization Strategies:

1. Background Processing
   • Presentation generation is async
   • User gets immediate feedback
   • Non-blocking UI

2. Caching
   • Generated presentations stored on disk
   • No regeneration needed for viewing
   • Fast file serving

3. Lazy Loading
   • Presentations list loaded on demand
   • Modal content rendered dynamically

4. Efficient AI Usage
   • Single LLM call per presentation
   • No memory/history overhead
   • Optimized prompt length

5. Client-Side
   • Minimal JavaScript
   • CSS animations (GPU accelerated)
   • No heavy libraries
```

This architecture provides a robust, scalable, and maintainable presentation generation system!
