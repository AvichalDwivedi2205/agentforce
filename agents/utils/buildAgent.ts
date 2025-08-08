// buildAgent.ts - Shared utilities for building agents with memory
import { createOpenAIFunctionsAgent, AgentExecutor } from "langchain/agents";
import { BufferMemory, ConversationSummaryMemory } from "langchain/memory";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { DynamicTool } from "@langchain/core/tools";
import { ChatPromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from "@langchain/core/prompts";
import type { BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { createOpenRouterChat, type OpenRouterConfig } from "./openRouter.js";

export interface BuildAgentOpts {
  tools: DynamicTool[];
  systemPrompt: string;
  memoryKey?: string;
  llmModel?: string;
  temperature?: number;
  useConversationSummary?: boolean;
  maxTokenLimit?: number;
  openRouterConfig?: Partial<OpenRouterConfig>;
}

export interface AgentMemoryStore {
  getMessages(sessionId: string): Promise<BaseMessage[]>;
  addMessage(sessionId: string, message: BaseMessage): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

// In-memory store for development - in production you'd use Redis/PostgreSQL
class InMemoryAgentStore implements AgentMemoryStore {
  private store = new Map<string, BaseMessage[]>();

  async getMessages(sessionId: string): Promise<BaseMessage[]> {
    return this.store.get(sessionId) || [];
  }

  async addMessage(sessionId: string, message: BaseMessage): Promise<void> {
    const messages = this.store.get(sessionId) || [];
    messages.push(message);
    this.store.set(sessionId, messages);
  }

  async clear(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }
}

const memoryStore = new InMemoryAgentStore();

export const buildAgent = ({ 
  tools, 
  systemPrompt, 
  memoryKey = "chat_history", 
  llmModel = "anthropic/claude-3.5-sonnet", 
  temperature = 0.2,
  useConversationSummary = true,
  maxTokenLimit = 4000,
  openRouterConfig = {}
}: BuildAgentOpts) => {
  
  const llm = createOpenRouterChat({
    model: llmModel,
    temperature,
    streaming: false,
    ...openRouterConfig
  });

  // Create the proper prompt template for OpenAI Functions agents
  const prompt = ChatPromptTemplate.fromMessages([
    SystemMessagePromptTemplate.fromTemplate(systemPrompt),
    new MessagesPlaceholder(memoryKey, true), // optional=true for chat history
    HumanMessagePromptTemplate.fromTemplate("{input}"),
    new MessagesPlaceholder("agent_scratchpad")
  ]);

  // Create agent with memory
  const createAgentWithSession = (sessionId: string = "default") => {
    const chatHistory = new ChatMessageHistory();
    
    let memory;
    if (useConversationSummary) {
      memory = new ConversationSummaryMemory({
        llm,
        chatHistory,
        memoryKey,
        maxTokenLimit,
        returnMessages: true
      });
    } else {
      memory = new BufferMemory({
        chatHistory,
        memoryKey,
        returnMessages: true
      });
    }

    const agent = createOpenAIFunctionsAgent({
      llm,
      tools,
      prompt
    });

    return AgentExecutor.fromAgentAndMemory({
      agent,
      memory,
      tools,
      verbose: true,
      maxIterations: 5,
      earlyStoppingMethod: "generate"
    });
  };

  return createAgentWithSession;
};

// Helper to create agent tools that can be called by other agents
export const createAgentTool = (
  name: string,
  description: string,
  agentFactory: (sessionId?: string) => AgentExecutor,
  defaultSessionId: string = "default"
) => {
  return new DynamicTool({
    name,
    description,
    func: async (input: string, runManager?, config?: RunnableConfig) => {
      try {
        // Extract session ID from config or use default
        const sessionId = (config as any)?.sessionId || defaultSessionId;
        const agent = agentFactory(sessionId);
        
        console.log(`[${name}] Processing request:`, input.substring(0, 100) + '...');
        
        const result = await agent.invoke(
          { input },
          { ...config, sessionId }
        );
        
        console.log(`[${name}] Request completed successfully`);
        return result.output || result;
      } catch (error) {
        console.error(`[${name}] Error:`, error);
        return `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`;
      }
    }
  });
};

// Memory management utilities
export const memoryUtils = {
  // Get conversation history for a session
  async getHistory(sessionId: string): Promise<BaseMessage[]> {
    return memoryStore.getMessages(sessionId);
  },

  // Clear memory for a session
  async clearSession(sessionId: string): Promise<void> {
    await memoryStore.clear(sessionId);
    console.log(`Memory cleared for session: ${sessionId}`);
  },

  // Get all active sessions
  getActiveSessions(): string[] {
    return Array.from((memoryStore as any).store.keys());
  },

  // Get memory usage stats
  getStats() {
    const sessions = (memoryStore as any).store;
    const sessionCount = sessions.size;
    let totalMessages = 0;
    
    for (const messages of sessions.values()) {
      totalMessages += messages.length;
    }

    return {
      activeSessions: sessionCount,
      totalMessages,
      averageMessagesPerSession: sessionCount > 0 ? totalMessages / sessionCount : 0
    };
  }
};

export { memoryStore };