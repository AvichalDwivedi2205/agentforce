import 'dotenv/config';
import express, { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { runDeepResearch } from '../lib/ai/graphs/research/graph.js';
import { setResearchEmitter } from '../lib/ai/graphs/research/eventEmitter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Global event emitter for research progress
export const researchEmitter = new EventEmitter();

// Connect the event emitter to the research graph
setResearchEmitter(researchEmitter);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Store active WebSocket connections
const clients = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');
  clients.add(ws);

  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'START_RESEARCH') {
        const { query, deepMode = false, skipClarify = true } = data;
        
        // Send acknowledgment
        ws.send(JSON.stringify({
          type: 'RESEARCH_STARTED',
          query
        }));

        // Listen to research events and broadcast to this client
        const actionHandler = (action: any) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'AGENT_ACTION',
              ...action
            }));
          }
        };

        const progressHandler = (progress: any) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'RESEARCH_PROGRESS',
              ...progress
            }));
          }
        };

        researchEmitter.on('action', actionHandler);
        researchEmitter.on('progress', progressHandler);

        try {
          // Run research
          const result = await runDeepResearch({
            query,
            deepMode,
            skipClarify
          });

          // Send completion
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'RESEARCH_COMPLETE',
              report: result.report,
              markdown: result.markdown,
              meta: result.meta
            }));
          }
        } catch (error: any) {
          console.error('Research error:', error);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'RESEARCH_ERROR',
              error: error.message || 'Research failed'
            }));
          }
        } finally {
          // Clean up listeners
          researchEmitter.off('action', actionHandler);
          researchEmitter.off('progress', progressHandler);
        }
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });
});

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', connections: clients.size });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready`);
});
