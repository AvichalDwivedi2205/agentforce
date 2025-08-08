// OpenRouter utility for LangChain integration
// Reference: https://openrouter.ai/docs/community/lang-chain
// Based on: https://medium.com/@maxiperezc/openrouter-langchain-in-javascript-408592b4c488

import { ChatOpenAI } from "@langchain/openai";

export interface OpenRouterConfig {
  model: string;
  apiKey?: string;
  temperature?: number;
  streaming?: boolean;
  siteUrl?: string;
  siteName?: string;
  maxTokens?: number;
}

export const createOpenRouterChat = ({
  model,
  apiKey,
  temperature = 0.2,
  streaming = false,
  siteUrl,
  siteName,
  maxTokens
}: OpenRouterConfig) => {
  const openrouterApiKey = apiKey || process.env.OPENROUTER_API_KEY;
  
  if (!openrouterApiKey) {
    throw new Error('OpenRouter API key is required. Set OPENROUTER_API_KEY environment variable.');
  }

  return new ChatOpenAI(
    {
      model,
      temperature,
      streaming,
      apiKey: openrouterApiKey,
      maxTokens,
    },
    {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': siteUrl || process.env.SITE_URL || 'https://localhost:3000',
        'X-Title': siteName || process.env.SITE_NAME || 'Multi-Agent System',
      },
    },
  );
};

// Predefined model configurations for common use cases
export const OpenRouterModels = {
  // Fast and cost-effective
  CLAUDE_HAIKU: 'anthropic/claude-3-haiku',
  GEMINI_FLASH: 'google/gemini-2.0-flash-exp:free',
  
  // Balanced performance
  CLAUDE_SONNET: 'anthropic/claude-3.5-sonnet',
  GPT_4O_MINI: 'openai/gpt-4o-mini',
  
  // High performance
  CLAUDE_OPUS: 'anthropic/claude-3-opus',
  GPT_4O: 'openai/gpt-4o',
  
  // Specialized models
  GEMINI_PRO: 'google/gemini-pro',
  MIXTRAL: 'mistralai/mixtral-8x7b-instruct',
} as const;

// Helper function to create agents with different performance tiers
export const createAgentChat = (
  tier: 'fast' | 'balanced' | 'premium' = 'balanced',
  customConfig?: Partial<OpenRouterConfig>
) => {
  const modelMap = {
    fast: OpenRouterModels.CLAUDE_HAIKU,
    balanced: OpenRouterModels.CLAUDE_SONNET,
    premium: OpenRouterModels.CLAUDE_OPUS,
  };

  const temperatureMap = {
    fast: 0.1,
    balanced: 0.2,
    premium: 0.3,
  };

  return createOpenRouterChat({
    model: modelMap[tier],
    temperature: temperatureMap[tier],
    streaming: false,
    ...customConfig,
  });
};