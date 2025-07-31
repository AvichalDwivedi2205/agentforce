import axios from 'axios';
import { ENV } from '../env.js';
import { Client as LangsmithClient } from 'langsmith';

const ls = ENV.LANGCHAIN_TRACING_V2 && ENV.LANGCHAIN_API_KEY
  ? new LangsmithClient({ apiKey: ENV.LANGCHAIN_API_KEY })
  : null;

// Simple span helper (no LangChain dependency)
async function withSpan<T>(name: string, fn: () => Promise<T>) {
  if (!ls) return fn();
  try {
    const res = await fn();
    return res;
  } catch (err: any) {
    throw err;
  }
}

// --- Tavily ---------------------------------------------------------------
export async function tavilySearch(params: {
  query: string;
  maxResults?: number;
  timeRange?: 'day'|'week'|'month'|'year';
  searchDepth?: 'basic'|'advanced';
  includeDomains?: string[];
  excludeDomains?: string[];
  includeRawContent?: boolean;
}) {
  const {
    query, maxResults = 12, timeRange = 'year',
    searchDepth = 'basic', includeDomains, excludeDomains, includeRawContent = false
  } = params;

  return withSpan('tool:tavily.search', async () => {
    const { data } = await axios.post('https://api.tavily.com/search', {
      api_key: ENV.TAVILY_API_KEY,
      query,
      max_results: maxResults,
      time_range: timeRange,
      search_depth: searchDepth,
      include_domains: includeDomains,
      exclude_domains: excludeDomains,
      include_raw_content: includeRawContent
    }, { timeout: 30000 });

    const items = (data?.results ?? []).map((r: any) => ({
      url: r.url as string,
      title: r.title as string | undefined,
      snippet: r.content as string | undefined,
      published_at: r.published_date as string | undefined,
      raw_content: r.raw_content as string | undefined
    }));
    return { items };
  });
}

// --- Perplexity -----------------------------------------------------------
type PplxMode = 'pro' | 'reasoning' | 'deep-research' | 'default';
export async function perplexityAsk(params: {
  prompt: string;
  mode?: PplxMode;      // 'pro' default
  temperature?: number; // default 0.2
}) {
  const { prompt, mode = 'pro', temperature = 0.2 } = params;
  
  // Map modes to appropriate models and system prompts
  let model: string;
  let systemPrompt: string;
  let timeout: number;
  
  switch (mode) {
    case 'reasoning':
      model = 'sonar-reasoning';
      systemPrompt = 'You are a reasoning assistant. Think step-by-step and provide logical analysis. Cite sources when possible.';
      timeout = 60000;
      break;
    case 'deep-research':
      model = 'sonar-deep-research'; // Use Perplexity's deep research model
      systemPrompt = 'You are a deep research assistant. Conduct thorough analysis with multiple sources. Provide comprehensive insights with detailed citations. Be thorough and analytical. Research deeply and provide nuanced understanding.';
      timeout = 600000; // 4 minutes for deep research as it takes 2-4 minutes per ZDNET
      break;
    case 'default':
    default:
      model = 'sonar';
      systemPrompt = 'Be concise. Cite sources when possible.';
      timeout = 60000;
  }

  return withSpan(`tool:perplexity.${mode}`, async () => {
    const { data } = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature,
        // Perplexity often includes citations in message metadata;
        // we ask explicitly for them to be returned if supported:
        return_citations: true
      },
      {
        headers: {
          Authorization: `Bearer ${ENV.PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout
      }
    );

    const msg = data?.choices?.[0]?.message;
    const text: string = msg?.content ?? '';
    const citations: string[] = msg?.citations ?? data?.citations ?? [];
    return { text, citations };
  });
}

// --- OpenRouter -----------------------------------------------------------
export async function openrouterCall<T = unknown>(params: {
  model: string;
  messages: Array<{ role:'system'|'user'|'assistant'; content: string }>;
  schema?: any;           // JSON Schema for structured output
  temperature?: number;
  timeout?: number;       // Custom timeout
}) {
  const { model, messages, schema, temperature = 0.2, timeout } = params;
  return withSpan(`tool:openrouter.${model}`, async () => {
    const body: any = { model, messages, temperature };
    if (schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          schema,
          strict: true
        }
      };
    }
    const { data } = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      body,
      {
        headers: {
          Authorization: `Bearer ${ENV.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          ...(ENV.OPENROUTER_REFERER ? { 'HTTP-Referer': ENV.OPENROUTER_REFERER } : {}),
          ...(ENV.OPENROUTER_APP_TITLE ? { 'X-Title': ENV.OPENROUTER_APP_TITLE } : {})
        },
        timeout: timeout || (model.startsWith('google/') ? 600000 : 90000)
      }
    );

    const choice = data?.choices?.[0];
    const text: string | undefined = choice?.message?.content;
    let object: T | undefined;
    if (schema && text) {
      try { object = JSON.parse(text); } catch { /* some models return tool data differently */ }
      // Some OpenRouter models return parsed JSON under tool/response_format; fall back:
      if (!object && choice?.message?.parsed) object = choice.message.parsed;
    }
    return { text, object };
  });
} 