import 'dotenv/config';
import express, { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { runDeepResearch } from '../lib/ai/graphs/research/graph.js';
import { setResearchEmitter } from '../lib/ai/graphs/research/eventEmitter.js';
import { generatePresentation } from '../agents/presentation/index.js';
import { promises as fs } from 'fs';

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

// Generate presentation endpoint
app.post('/api/generate-presentation', async (req: Request, res: Response) => {
  try {
    const { markdown } = req.body;
    
    if (!markdown) {
      return res.status(400).json({ error: 'Markdown content is required' });
    }

    console.log('Generating presentation from markdown...');
    
    const html = await generatePresentation(markdown);
    
    // Save presentation to generated_files directory
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `presentation-${timestamp}.html`;
    const filePath = path.join(__dirname, '../generated_files', filename);
    
    await fs.writeFile(filePath, html, 'utf-8');
    
    console.log(`Presentation saved: ${filename}`);
    
    res.json({ 
      success: true, 
      filename,
      html
    });
  } catch (error: any) {
    console.error('Presentation generation error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to generate presentation' 
    });
  }
});

// Serve presentation files
app.get('/presentations/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../generated_files', filename);
    
    const html = await fs.readFile(filePath, 'utf-8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error serving presentation:', error);
    res.status(404).send('Presentation not found');
  }
});

// List all presentations
app.get('/api/presentations', async (_req: Request, res: Response) => {
  try {
    const generatedFilesPath = path.join(__dirname, '../generated_files');
    const files = await fs.readdir(generatedFilesPath);
    
    const presentations = files
      .filter(file => file.startsWith('presentation-') && file.endsWith('.html'))
      .map(file => ({
        filename: file,
        url: `/presentations/${file}`,
        timestamp: file.replace('presentation-', '').replace('.html', '')
      }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    
    res.json({ presentations });
  } catch (error) {
    console.error('Error listing presentations:', error);
    res.status(500).json({ error: 'Failed to list presentations' });
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready`);
});
