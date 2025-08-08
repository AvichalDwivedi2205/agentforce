#!/usr/bin/env tsx
// Interactive CLI for Multi-Agent System
import inquirer from "inquirer";
import { orchestratorAgent, agentUtils } from "../agents/orchestrator/index.js";
import { gmailAgent } from "../agents/gmail/index.js";
import { researchAgent } from "../agents/research/index.js";
import { config } from "dotenv";

// Load environment variables
config();

// Gmail configuration - in production, load from secure storage
const gmailConfig = {
  credentials: {
    client_id: process.env.GMAIL_CLIENT_ID!,
    client_secret: process.env.GMAIL_CLIENT_SECRET!,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
    access_token: process.env.GMAIL_ACCESS_TOKEN
  },
  scopes: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.send'
  ]
};

interface CliOptions {
  agent: "orchestrator" | "gmail" | "research";
  sessionId: string;
  verbose: boolean;
}

class MultiAgentCLI {
  private options: CliOptions;

  constructor() {
    this.options = {
      agent: "orchestrator",
      sessionId: "default",
      verbose: false
    };
  }

  async start() {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    🤖 Multi-Agent System CLI                     ║
║                                                                  ║
║  Orchestrator: Coordinates Gmail + Research agents              ║
║  Gmail Agent: Full email management capabilities                 ║
║  Research Agent: Deep research with citations                    ║
╚══════════════════════════════════════════════════════════════════╝
`);

    await this.showMainMenu();
  }

  async showMainMenu() {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "💬 Chat with Orchestrator (recommended)", value: "chat_orchestrator" },
          { name: "📧 Chat with Gmail Agent", value: "chat_gmail" },
          { name: "🔍 Chat with Research Agent", value: "chat_research" },
          { name: "⚙️  System Settings", value: "settings" },
          { name: "📊 Agent Status", value: "status" },
          { name: "🧹 Clear All Memory", value: "clear_memory" },
          { name: "❌ Exit", value: "exit" }
        ]
      }
    ]);

    switch (action) {
      case "chat_orchestrator":
        await this.startChat("orchestrator");
        break;
      case "chat_gmail":
        await this.startChat("gmail");
        break;
      case "chat_research":
        await this.startChat("research");
        break;
      case "settings":
        await this.showSettings();
        break;
      case "status":
        await this.showStatus();
        break;
      case "clear_memory":
        await this.clearMemory();
        break;
      case "exit":
        console.log("\n👋 Goodbye!");
        process.exit(0);
        break;
    }
  }

  async startChat(agentType: "orchestrator" | "gmail" | "research") {
    const agentNames = {
      orchestrator: "🎯 Orchestrator",
      gmail: "📧 Gmail Agent", 
      research: "🔍 Research Agent"
    };

    console.log(`\n${agentNames[agentType]} Chat Started`);
    console.log("Type 'exit' to return to main menu, 'help' for examples\n");

    let agent;
    let sessionId;

    switch (agentType) {
      case "orchestrator":
        agent = orchestratorAgent("default");
        sessionId = "default";
        break;
      case "gmail":
        agent = gmailAgent("gmail_session");
        sessionId = "gmail_session";
        break;
      case "research":
        agent = researchAgent("research_session");
        sessionId = "research_session";
        break;
    }

    while (true) {
      const { userInput } = await inquirer.prompt([
        {
          type: "input",
          name: "userInput",
          message: `${agentNames[agentType]} >>>`,
          prefix: ""
        }
      ]);

      if (!userInput.trim()) continue;

      const input = userInput.trim().toLowerCase();
      
      if (input === "exit") {
        console.log(`\n📝 Returning to main menu...\n`);
        break;
      }

      if (input === "help") {
        this.showChatHelp(agentType);
        continue;
      }

      if (input === "status") {
        await this.showAgentStatus(agentType);
        continue;
      }

      try {
        console.log(`\n🤔 Processing your request...`);
        
        const config = agentType === "gmail" || agentType === "orchestrator" 
          ? { gmailConfig, sessionId }
          : { sessionId };

        const result = await agent.invoke(
          { input: userInput },
          config
        );

        console.log(`\n✅ ${agentNames[agentType]} Response:`);
        console.log("─".repeat(60));
        console.log(result.output || result);
        console.log("─".repeat(60));
        
      } catch (error) {
        console.error(`\n❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.log("Please try rephrasing your request or check the error details.\n");
      }
    }

    await this.showMainMenu();
  }

  showChatHelp(agentType: "orchestrator" | "gmail" | "research") {
    const examples = {
      orchestrator: [
        "Research AI trends and email a summary to john@company.com",
        "Find emails about 'budget' from last week and research cost optimization strategies",
        "Research competitor analysis and draft an email to the strategy team",
        "Look up recent emails from Sarah and research the topics she mentioned"
      ],
      gmail: [
        "Send an email to team@company.com about tomorrow's meeting",
        "Find all unread emails from this week and summarize them",
        "Archive all newsletters from last month",
        "Create a draft email for the quarterly report and show me the preview"
      ],
      research: [
        "Research the latest developments in quantum computing",
        "Find recent studies on climate change and renewable energy",
        "Research fintech trends and their market impact",
        "Analyze the current state of artificial intelligence in healthcare"
      ]
    };

    console.log(`\n📚 Example commands for ${agentType}:`);
    examples[agentType].forEach((example, i) => {
      console.log(`   ${i + 1}. ${example}`);
    });
    console.log("\n💡 Special commands: 'status', 'help', 'exit'\n");
  }

  async showStatus() {
    const status = agentUtils.getStatus();
    
    console.log("\n📊 System Status:");
    console.log("─".repeat(40));
    console.log(`Active Sessions: ${status.orchestrator.activeSessions}`);
    console.log(`Total Messages: ${status.orchestrator.totalMessages}`);
    console.log(`Average per Session: ${status.memoryStats.averageMessagesPerSession.toFixed(1)}`);
    
    console.log("\n🤖 Agent Status:");
    Object.entries(status.subAgents).forEach(([name, info]) => {
      console.log(`  ${name}: ${info.status} (session: ${info.session})`);
    });
    
    console.log("\n");
    await this.showMainMenu();
  }

  async showAgentStatus(agentType: "orchestrator" | "gmail" | "research") {
    try {
      const history = await agentUtils.getAgentHistory(agentType);
      console.log(`\n📋 ${agentType} Agent Status:`);
      console.log(`Messages in memory: ${history.length}`);
      if (history.length > 0) {
        console.log(`Latest message: ${history[history.length - 1].content?.substring(0, 100)}...`);
      }
    } catch (error) {
      console.log(`Status unavailable: ${error}`);
    }
  }

  async clearMemory() {
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: "Clear all agent memories? This cannot be undone.",
        default: false
      }
    ]);

    if (confirm) {
      await agentUtils.clearAllMemory();
      console.log("✅ All memories cleared successfully!\n");
    } else {
      console.log("❌ Memory clear cancelled.\n");
    }

    await this.showMainMenu();
  }

  async showSettings() {
    const { setting } = await inquirer.prompt([
      {
        type: "list",
        name: "setting",
        message: "Settings:",
        choices: [
          { name: "📋 View Current Configuration", value: "view_config" },
          { name: "🔄 Toggle Verbose Mode", value: "toggle_verbose" },
          { name: "🔧 Test Gmail Connection", value: "test_gmail" },
          { name: "↩️  Back to Main Menu", value: "back" }
        ]
      }
    ]);

    switch (setting) {
      case "view_config":
        console.log("\n⚙️ Current Configuration:");
        console.log(`Agent: ${this.options.agent}`);
        console.log(`Session ID: ${this.options.sessionId}`);
        console.log(`Verbose: ${this.options.verbose}`);
        console.log(`OpenRouter API Key: ${!!process.env.OPENROUTER_API_KEY}`);
        console.log(`Gmail Configured: ${!!process.env.GMAIL_CLIENT_ID}`);
        console.log("");
        break;
      case "toggle_verbose":
        this.options.verbose = !this.options.verbose;
        console.log(`\n✅ Verbose mode ${this.options.verbose ? 'enabled' : 'disabled'}\n`);
        break;
      case "test_gmail":
        await this.testGmailConnection();
        break;
      case "back":
        break;
    }

    if (setting !== "back") {
      await this.showSettings();
    } else {
      await this.showMainMenu();
    }
  }

  async testGmailConnection() {
    console.log("\n🔧 Testing Gmail connection...");
    try {
      // Test by checking if env vars are present
      const required = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'];
      const missing = required.filter(key => !process.env[key]);
      
      if (missing.length > 0) {
        console.log(`❌ Missing environment variables: ${missing.join(', ')}`);
      } else {
        console.log("✅ Gmail environment variables are configured");
        console.log("   To fully test, try sending an email through the Gmail agent");
      }
    } catch (error) {
      console.log(`❌ Gmail test failed: ${error}`);
    }
    console.log("");
  }
}

// Start the CLI
async function main() {
  // Check for required environment variables
  const required = ['OPENROUTER_API_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please set OPENROUTER_API_KEY in your .env file');
    console.error('Get your key from: https://openrouter.ai/keys');
    process.exit(1);
  }

  const cli = new MultiAgentCLI();
  await cli.start();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Goodbye!');
  process.exit(0);
});

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { MultiAgentCLI };