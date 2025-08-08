// Central Orchestrator Agent Implementation
import { buildAgent } from "../utils/buildAgent.js";
import { GmailAgentTool } from "../gmail/index.js";
import { ResearchAgentTool } from "../research/index.js";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./prompt.js";

// Create Orchestrator Agent Factory
export const createOrchestratorAgent = () => {
  return buildAgent({
    tools: [GmailAgentTool, ResearchAgentTool],
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    memoryKey: "orchestrator_chat_history",
    llmModel: "anthropic/claude-3.5-sonnet", // Best reasoning for orchestration
    temperature: 0.3, // Balanced for both analytical and creative tasks
    useConversationSummary: true,
    maxTokenLimit: 5000 // Higher limit for complex multi-agent contexts
  });
};

// Main orchestrator instance for CLI use
export const orchestratorAgent = createOrchestratorAgent();

// Agent management utilities
export const agentUtils = {
  // Get agent status and memory information
  getStatus() {
    const { memoryUtils } = require("../utils/buildAgent.js");
    const stats = memoryUtils.getStats();
    
    return {
      orchestrator: {
        activeSessions: stats.activeSessions,
        totalMessages: stats.totalMessages,
        status: "ready"
      },
      subAgents: {
        gmail_agent: { status: "ready", session: "gmail_session" },
        research_agent: { status: "ready", session: "research_session" }
      },
      memoryStats: stats
    };
  },

  // Clear all agent memories
  async clearAllMemory() {
    const { memoryUtils } = require("../utils/buildAgent.js");
    const sessions = ["default", "gmail_session", "research_session"];
    
    for (const session of sessions) {
      await memoryUtils.clearSession(session);
    }
    
    console.log("✅ All agent memories cleared");
    return { cleared: sessions };
  },

  // Get conversation history for a specific agent
  async getAgentHistory(agentType: "orchestrator" | "gmail" | "research") {
    const { memoryUtils } = require("../utils/buildAgent.js");
    const sessionMap = {
      orchestrator: "default",
      gmail: "gmail_session", 
      research: "research_session"
    };
    
    const sessionId = sessionMap[agentType];
    return await memoryUtils.getHistory(sessionId);
  }
};

export { ORCHESTRATOR_SYSTEM_PROMPT };