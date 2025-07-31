// Setup verification script
import { ENV } from './lib/env.js';
import { tavilySearch, perplexityAsk, openrouterCall } from './lib/ai/clients.js';
import { runDeepResearch } from './lib/ai/graphs/research/graph.js';
import { ensureCacheDir, clearCache } from './lib/cache/fsCache.js';
// import { tavilySearchCached } from './lib/ai/tavilyCached.js'; // Will be available after compilation
import fs from 'fs';

console.log('🔧 Setting up Enhanced Research Agent...');

// Verify environment variables
try {
  console.log('✅ Environment variables loaded');
  console.log('  - Tavily API:', ENV.TAVILY_API_KEY ? 'configured' : 'missing');
  console.log('  - Perplexity API:', ENV.PERPLEXITY_API_KEY ? 'configured' : 'missing');  
  console.log('  - OpenRouter API:', ENV.OPENROUTER_API_KEY ? 'configured' : 'missing');
} catch (e) {
  console.error('❌ Environment setup failed:', e);
  process.exit(1);
}

// Create cache directories
try {
  ensureCacheDir('tavily');
  ensureCacheDir('extract');
  console.log('✅ Cache directories created');
} catch (e) {
  console.error('❌ Cache setup failed:', e);
}

// Create generated files directory
try {
  if (!fs.existsSync('generated_files')) {
    fs.mkdirSync('generated_files', { recursive: true });
  }
  console.log('✅ Generated files directory ready');
} catch (e) {
  console.error('❌ Generated files setup failed:', e);
}

console.log('\n🚀 Setup complete! Ready to run research agent.');
console.log('\nUsage examples:');
console.log('  npm start -- --q "AI trends 2024" --deep');
console.log('  npm start -- --q "Climate change impact" --extra-deep');
console.log('  npm start -- --q "Quick tech update" --skip-clarify --cache-clear'); 