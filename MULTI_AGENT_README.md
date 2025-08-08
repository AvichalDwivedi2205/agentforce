# 🤖 Multi-Agent System with Gmail & Research

A sophisticated multi-agent system built with LangChain and LangGraph that coordinates between specialized agents for Gmail management and deep research tasks.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                Orchestrator Agent                  │
│            (Central Coordinator)                   │
│                                                     │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │   Gmail Agent   │    │   Research Agent        │ │
│  │                 │    │                         │ │
│  │ • Send emails   │    │ • Deep research         │ │
│  │ • Read/search   │    │ • Quick research        │ │
│  │ • Organize      │    │ • Citations             │ │
│  │ • Drafts        │    │ • Multi-source analysis │ │
│  │ • Labels        │    │ • Structured reports    │ │
│  │ • Contacts      │    │                         │ │
│  └─────────────────┘    └─────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
Copy the environment template and configure:
```bash
cp env.template .env
```

Required environment variables:
- `OPENAI_API_KEY`: Your OpenAI API key
- `GMAIL_*`: Gmail OAuth credentials (optional, for email features)

### 3. Start the CLI
```bash
npm run cli
# or
npm run agents
```

## 🎯 Agents Overview

### 🎯 Orchestrator Agent
The master coordinator that:
- Routes tasks to appropriate specialized agents
- Manages multi-step workflows
- Synthesizes results from multiple agents
- Maintains conversation context and memory

**Example tasks:**
- "Research AI trends and email a summary to my team"
- "Find emails about budget planning and research cost optimization strategies"

### 📧 Gmail Agent
Specialized for email management with 8 powerful tools:

1. **send_email**: Send emails with attachments, scheduling, replies
2. **read_emails**: Fetch emails with advanced filtering
3. **search_emails**: Search across all email content
4. **manage_email**: Archive, delete, mark read/unread, labels
5. **draft_email**: Create, update, send drafts
6. **monitor_replies**: Track email responses
7. **manage_labels**: Organize with Gmail labels
8. **get_contacts**: Extract contact information

**Example tasks:**
- "Send a meeting invite to the team for tomorrow at 2 PM"
- "Find all unread emails from this week and summarize them"
- "Archive all newsletters from last month"

### 🔍 Research Agent
Powered by your existing deep research system:

1. **deep_research**: Comprehensive research with citations
2. **quick_research**: Fast information gathering

**Example tasks:**
- "Research the latest developments in quantum computing"
- "Analyze fintech market trends and their business impact"

## 💡 Usage Examples

### Simple Tasks (Single Agent)
```
📧 Gmail: "Send an email to john@company.com about the quarterly meeting"
🔍 Research: "Research renewable energy trends in 2024"
```

### Complex Workflows (Multi-Agent)
```
🎯 Orchestrator: "Research competitor analysis for our product and email findings to the strategy team"

This triggers:
1. Research Agent → Conducts comprehensive competitor research
2. Gmail Agent → Composes professional email with findings
3. Orchestrator → Coordinates and confirms completion
```

## 🧠 Memory & Context

Each agent maintains conversation memory:
- **Buffer Memory**: Recent conversation history
- **Summary Memory**: Compressed long-term context
- **Session Management**: Separate memory per agent type

Memory commands:
- View status: Type `status` in any chat
- Clear memory: Use the main menu option
- Session isolation: Each agent has independent memory

## 🔧 Configuration

### Agent Settings
- **LLM Model**: Default `gpt-4o-mini` (configurable)
- **Temperature**: Optimized per agent type
- **Memory**: Automatic conversation summarization
- **Iterations**: Max 5 tool calls per request

### Gmail Integration
Requires Google OAuth2 setup:
1. Create project in Google Cloud Console
2. Enable Gmail API
3. Create OAuth2 credentials
4. Generate refresh token
5. Add credentials to `.env`

## 📊 CLI Features

### Interactive Menu
- **Agent Chat**: Direct conversation with any agent
- **System Status**: View memory usage and agent status
- **Settings**: Configure options and test connections
- **Memory Management**: Clear conversations when needed

### Special Commands
In any chat:
- `help`: Show examples for current agent
- `status`: View agent-specific status
- `exit`: Return to main menu

## 🛠️ Development

### File Structure
```
agentforce/
├── agents/
│   ├── utils/buildAgent.ts      # Shared agent utilities
│   ├── gmail/                   # Gmail agent implementation
│   ├── research/                # Research agent implementation
│   └── orchestrator/            # Central coordinator
├── tools/
│   ├── gmailTools.ts           # Gmail API tools
│   └── deepResearchTool.ts     # Research tool wrapper
├── cli/
│   └── run.ts                  # Interactive CLI interface
└── lib/                        # Existing research system
```

### Adding New Agents
1. Create agent directory with `prompt.ts` and `index.ts`
2. Use `buildAgent()` utility for consistency
3. Create agent tool with `createAgentTool()`
4. Add to orchestrator's tool list

## 🚀 Advanced Usage

### Programmatic Access
```typescript
import { orchestratorAgent } from './agents/orchestrator';

const agent = orchestratorAgent("your_session_id");
const result = await agent.invoke(
  { input: "Your task here" },
  { gmailConfig, sessionId: "your_session_id" }
);
```

### Custom Workflows
The orchestrator can handle complex multi-step workflows:
1. Email analysis + Research
2. Research + Multiple targeted emails
3. Information gathering + Distribution
4. Automated follow-ups and monitoring

## 🔍 Troubleshooting

### Common Issues
1. **Missing API Keys**: Check `.env` configuration
2. **Gmail Errors**: Verify OAuth2 setup and token validity
3. **Memory Issues**: Clear agent memory if context becomes confused
4. **Tool Errors**: Check individual tool responses in verbose mode

### Debug Mode
- Enable verbose logging in agent configuration
- Use LangSmith for detailed execution traces
- Check individual agent responses

## 🎯 Next Steps

1. **Test the system**: Start with simple tasks and progress to complex workflows
2. **Configure Gmail**: Set up OAuth2 for full email functionality
3. **Explore workflows**: Try multi-agent tasks that combine research and email
4. **Extend functionality**: Add new agents or tools as needed

The system is designed to be modular and extensible - you can add new specialized agents while maintaining the coordinated workflow approach.