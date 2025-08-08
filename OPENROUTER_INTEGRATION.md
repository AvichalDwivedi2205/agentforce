# 🚀 OpenRouter Integration

This multi-agent system now uses **OpenRouter** instead of direct OpenAI, giving you access to multiple AI providers through a single API.

## 🔗 References
- [OpenRouter LangChain Documentation](https://openrouter.ai/docs/community/lang-chain)
- [JavaScript Integration Guide](https://medium.com/@maxiperezc/openrouter-langchain-in-javascript-408592b4c488)

## ⚙️ Configuration

### Environment Variables (Required)
```bash
# Get your key from: https://openrouter.ai/keys
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Optional: For OpenRouter rankings
SITE_URL=https://localhost:3000
SITE_NAME=Multi-Agent System
```

### Model Selection
The system now uses optimized models for each agent:

- **Gmail Agent**: `anthropic/claude-3-haiku` - Fast and reliable for email operations
- **Research Agent**: `anthropic/claude-3.5-sonnet` - Better reasoning for research tasks  
- **Orchestrator**: `anthropic/claude-3.5-sonnet` - Best reasoning for coordination

## 🛠️ OpenRouter Wrapper

Located in `agents/utils/openRouter.ts`, provides:

```typescript
import { createOpenRouterChat, OpenRouterModels } from './agents/utils/openRouter.js';

// Quick setup
const chat = createOpenRouterChat({
  model: OpenRouterModels.CLAUDE_SONNET,
  temperature: 0.2
});

// With custom configuration
const chat = createOpenRouterChat({
  model: 'anthropic/claude-3.5-sonnet',
  temperature: 0.8,
  streaming: true,
  apiKey: process.env.OPENROUTER_API_KEY,
  siteUrl: 'https://mysite.com',
  siteName: 'My AI App'
});
```

## 🎯 Available Models

### Fast & Cost-Effective
- `anthropic/claude-3-haiku`
- `google/gemini-2.0-flash-exp:free`

### Balanced Performance  
- `anthropic/claude-3.5-sonnet` ⭐ (Default)
- `openai/gpt-4o-mini`

### High Performance
- `anthropic/claude-3-opus`
- `openai/gpt-4o`

### Specialized
- `google/gemini-pro`
- `mistralai/mixtral-8x7b-instruct`

## 🔧 Technical Implementation

### LangChain Integration
```typescript
import { ChatOpenAI } from "@langchain/openai";

const chat = new ChatOpenAI(
  {
    model: 'anthropic/claude-3.5-sonnet',
    temperature: 0.8,
    streaming: true,
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': process.env.SITE_URL || 'https://localhost:3000',
      'X-Title': process.env.SITE_NAME || 'Multi-Agent System',
    },
  },
);
```

### Agent Creation
All agents automatically use OpenRouter through the `buildAgent()` utility:

```typescript
const agent = buildAgent({
  tools: myTools,
  systemPrompt: "You are a helpful assistant",
  llmModel: "anthropic/claude-3.5-sonnet", // OpenRouter model
  temperature: 0.2
});
```

## 🚦 Getting Started

1. **Get OpenRouter API Key**: Visit [openrouter.ai/keys](https://openrouter.ai/keys)
2. **Copy Environment Template**: `cp env.template .env`
3. **Add Your Key**: Edit `.env` and set `OPENROUTER_API_KEY`
4. **Install Dependencies**: `pnpm install`
5. **Start CLI**: `pnpm run cli`

## 💡 Benefits

- **Multi-Provider Access**: Use models from OpenAI, Anthropic, Google, and more
- **Cost Optimization**: Choose models based on task complexity
- **Reliability**: Fallback options if one provider has issues  
- **Performance**: Access to latest models as they're released
- **Unified API**: Single integration for all providers

## 🔒 Cursor Rules

The system enforces OpenRouter usage through `.cursorrules`:
- Always use OpenRouter, never direct OpenAI
- Use `OPENROUTER_API_KEY` environment variable
- Reference official documentation and examples
- Never modify `.env` files directly

Perfect for building production AI applications with flexibility and reliability! 🎉