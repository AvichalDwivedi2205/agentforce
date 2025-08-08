// Gmail Agent Implementation
import { buildAgent, createAgentTool } from "../utils/buildAgent.js";
import { GmailTools } from "../../tools/gmailTools.js";
import { GMAIL_SYSTEM_PROMPT } from "./prompt.js";

// Create Gmail Agent Factory
export const createGmailAgent = () => {
  return buildAgent({
    tools: Object.values(GmailTools),
    systemPrompt: GMAIL_SYSTEM_PROMPT,
    memoryKey: "gmail_chat_history",
    llmModel: "anthropic/claude-3-haiku", // Fast and reliable for email operations
    temperature: 0.1, // Lower temperature for more reliable email operations
    useConversationSummary: true,
    maxTokenLimit: 3000
  });
};

// Gmail Agent Tool for use by other agents
export const GmailAgentTool = createAgentTool(
  "gmail_agent",
  `Delegates Gmail-related tasks to a specialized Gmail agent. Use this tool for:
  - Sending, reading, searching, and organizing emails
  - Managing drafts, labels, and email monitoring
  - Contact management and email automation
  - Any task involving Gmail functionality
  
  Pass a natural language instruction about what you want to do with Gmail.
  Examples:
  - "Send an email to john@example.com about the meeting tomorrow"
  - "Find all unread emails from last week and summarize them"
  - "Archive all emails labeled 'newsletter' from this month"
  - "Create a draft email for the team update and show me the preview"`,
  createGmailAgent(),
  "gmail_session"
);

// Export the standalone agent for direct use
export const gmailAgent = createGmailAgent();