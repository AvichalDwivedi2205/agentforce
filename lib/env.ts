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
  // LangSmith / LangChain tracing (support both prefixes)
  LANGCHAIN_TRACING_V2: process.env.LANGSMITH_TRACING_V2 === 'true' || process.env.LANGCHAIN_TRACING_V2 === 'true',
  LANGCHAIN_API_KEY: process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY || '',
  LANGCHAIN_PROJECT: process.env.LANGSMITH_PROJECT || process.env.LANGCHAIN_PROJECT || 'deep-research-mvp',
  // Optional OpenRouter attribution headers (required for some free-tier keys)
  OPENROUTER_REFERER: process.env.OPENROUTER_REFERER || '',
  OPENROUTER_APP_TITLE: process.env.OPENROUTER_APP_TITLE || 'deep-research-agent'
}; 