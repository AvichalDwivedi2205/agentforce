// Presentation Agent Implementation
import { buildAgent, createAgentTool } from "../utils/buildAgent.js";
import { PRESENTATION_SYSTEM_PROMPT } from "./prompt.js";

// Create Presentation Agent Factory
export const createPresentationAgent = () => {
  return buildAgent({
    tools: [], // No external tools needed - pure LLM generation
    systemPrompt: PRESENTATION_SYSTEM_PROMPT,
    memoryKey: "presentation_chat_history",
    llmModel: "anthropic/claude-3.5-sonnet", // Best for creative HTML/CSS generation
    temperature: 0.7, // Higher creativity for design
    useConversationSummary: false, // No need for history in presentation generation
    maxTokenLimit: 8000 // Higher limit for complete HTML/CSS output
  });
};

// Presentation Agent Tool for use by other agents
export const PresentationAgentTool = createAgentTool(
  "presentation_agent",
  `Delegates presentation creation tasks to a specialized Presentation agent. Use this tool to:
  - Convert research reports into HTML/CSS presentation slides
  - Transform documents into visual slide decks
  - Create professional, interactive presentations with modern styling
  - Generate self-contained HTML presentations with navigation
  
  Pass the research content or document text. The agent will return complete HTML code.
  
  Examples:
  - "Create a presentation from this research report on climate change"
  - "Transform this market analysis into a slide deck"
  - "Generate slides from this technical documentation"`,
  createPresentationAgent(),
  "presentation_session"
);

// Export the standalone agent for direct use
export const presentationAgent = createPresentationAgent();

// Helper function to generate presentation from research markdown
export async function generatePresentation(researchContent: string): Promise<string> {
  const agentFactory = createPresentationAgent();
  const agentExecutor = agentFactory("presentation_session");
  
  const prompt = `Create a professional, visually appealing HTML/CSS presentation from the following research content. 
  
Include:
- A compelling title slide
- Multiple content slides breaking down the key points
- Visual design with modern CSS
- Navigation controls (arrow keys and buttons)
- Smooth transitions
- Responsive design

Research Content:
${researchContent}

Generate ONLY the complete HTML code. Do not include markdown code blocks or explanations.`;

  const response = await agentExecutor.invoke({
    input: prompt
  });

  // Extract the HTML from the response
  let html = response.output;
  
  // Clean up any markdown code blocks if present
  html = html.replace(/```html\n?/g, '').replace(/```\n?/g, '');
  
  // Ensure we have a complete HTML document
  if (!html.includes('<!DOCTYPE html>')) {
    throw new Error('Generated content is not a valid HTML document');
  }
  
  return html;
}
