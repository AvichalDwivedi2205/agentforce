// Deep Research Agent Implementation
import { buildAgent, createAgentTool } from "../utils/buildAgent.js";
import { ResearchTools } from "../../tools/deepResearchTool.js";
import { RESEARCH_SYSTEM_PROMPT } from "./prompt.js";

// Create Research Agent Factory
export const createResearchAgent = () => {
  return buildAgent({
    tools: Object.values(ResearchTools),
    systemPrompt: RESEARCH_SYSTEM_PROMPT,
    memoryKey: "research_chat_history",
    llmModel: "anthropic/claude-3.5-sonnet", // Better reasoning for research tasks
    temperature: 0.2, // Slightly higher for more creative research approaches
    useConversationSummary: true,
    maxTokenLimit: 4000 // Higher limit for research context
  });
};

// Research Agent Tool for use by other agents
export const ResearchAgentTool = createAgentTool(
  "research_agent",
  `Delegates research tasks to a specialized Deep Research agent. Use this tool for:
  - Comprehensive research on any topic with citations and structured analysis
  - Quick research for basic information gathering
  - Market analysis, trend research, and competitive intelligence
  - Academic research with multiple perspectives and sources
  - Current events and news analysis
  - Technical research and explainers
  
  Pass a natural language research request. Examples:
  - "Research the latest developments in artificial intelligence and their impact on job markets"
  - "Quick research on the current state of electric vehicle adoption globally"
  - "Comprehensive analysis of blockchain technology applications in finance"
  - "Find recent studies on climate change effects and mitigation strategies"`,
  createResearchAgent(),
  "research_session"
);

// Export the standalone agent for direct use
export const researchAgent = createResearchAgent();