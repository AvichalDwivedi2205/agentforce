import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

export const ENV = {
  OPENROUTER_API_KEY: req('OPENROUTER_API_KEY'),
  PERPLEXITY_API_KEY: req('PERPLEXITY_API_KEY'),
  TAVILY_API_KEY: req('TAVILY_API_KEY'),
  LANGCHAIN_TRACING_V2: process.env.LANGCHAIN_TRACING_V2 === 'true',
  LANGCHAIN_API_KEY: process.env.LANGCHAIN_API_KEY || '',
  LANGCHAIN_PROJECT: process.env.LANGCHAIN_PROJECT || 'deep-research-mvp'
}; 