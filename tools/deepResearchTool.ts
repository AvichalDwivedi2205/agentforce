// deepResearchTool.ts
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { CallbackManagerForToolRun } from '@langchain/core/callbacks/manager';
import { RunnableConfig } from '@langchain/core/runnables';
import { runDeepResearch } from '../lib/ai/graphs/research/graph.js';
import type { ResearchInput } from '../lib/ai/graphs/research/contracts.js';

// Deep Research Tool - Wraps the existing research functionality as a LangChain tool
export const DeepResearchTool = new DynamicStructuredTool({
  name: "deep_research",
  description: "Performs comprehensive deep research on any topic using multiple AI models and sources. Returns detailed analysis with citations and structured findings.",
  schema: z.object({
    query: z.string().describe("The research query or topic to investigate thoroughly"),
    deepMode: z.boolean().optional().default(false).describe("Enable deeper research with advanced models (costs more but provides better quality)"),
    dateFrom: z.string().optional().describe("Start date for research in ISO format (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date for research in ISO format (YYYY-MM-DD)"),
    skipClarify: z.boolean().optional().default(true).describe("Skip clarifying questions and proceed directly to research")
  }),
  
  func: async (
    input: any, 
    runManager?: CallbackManagerForToolRun,
    config?: RunnableConfig
  ): Promise<any> => {
    try {
      console.log('[DeepResearchTool] Starting research for:', input.query);
      
      const researchInput: ResearchInput = {
        query: input.query,
        deepMode: input.deepMode || false,
        from: input.dateFrom,
        to: input.dateTo,
        skipClarify: input.skipClarify ?? true, // Default to true for agent use
        clearCache: false // Don't clear cache unnecessarily
      };

      // Run the research
      const result = await runDeepResearch(researchInput);
      
      console.log('[DeepResearchTool] Research completed successfully');
      console.log('[DeepResearchTool] Report length:', result.markdown.length, 'characters');
      console.log('[DeepResearchTool] API calls:', result.meta);

      // Return structured result for the agent
      return {
        success: true,
        query: result.report.query,
        executive_summary: result.report.executive_summary,
        markdown_report: result.markdown,
        key_findings: result.report.key_findings,
        sections: result.report.sections,
        limitations: result.report.limitations,
        meta: {
          pplx_calls: result.meta.pplxCalls,
          tavily_calls: result.meta.tavilyCalls,
          openrouter_calls: result.meta.openrouterCalls,
          total_sources: result.meta.evidenceCount
        },
        message: `Research completed successfully. Generated ${result.markdown.length} character report with ${result.meta.evidenceCount} sources.`
      };
    } catch (error) {
      console.error('[DeepResearchTool] Research failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: 'Research failed. Please try with a different query or check the error details.'
      };
    }
  }
});

// Quick Research Tool - For faster, lighter research
export const QuickResearchTool = new DynamicStructuredTool({
  name: "quick_research",
  description: "Performs quick research on a topic using basic mode. Faster and cheaper than deep_research but less comprehensive.",
  schema: z.object({
    query: z.string().describe("The research query or topic to investigate"),
    dateFrom: z.string().optional().describe("Start date for research in ISO format (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date for research in ISO format (YYYY-MM-DD)")
  }),
  
  func: async (
    input: any, 
    runManager?: CallbackManagerForToolRun,
    config?: RunnableConfig
  ): Promise<any> => {
    try {
      console.log('[QuickResearchTool] Starting quick research for:', input.query);
      
      const researchInput: ResearchInput = {
        query: input.query,
        deepMode: false, // Always use basic mode for quick research
        from: input.dateFrom,
        to: input.dateTo,
        skipClarify: true, // Always skip clarifying questions for quick mode
        clearCache: false
      };

      const result = await runDeepResearch(researchInput);
      
      console.log('[QuickResearchTool] Quick research completed');

      return {
        success: true,
        query: result.report.query,
        summary: result.report.executive_summary,
        key_points: result.report.key_findings.slice(0, 5), // Limit to top 5 findings
        markdown_report: result.markdown.substring(0, 2000) + '...', // Truncate for quick mode
        limitations: result.report.limitations,
        message: `Quick research completed. Found ${result.report.key_findings.length} key findings.`
      };
    } catch (error) {
      console.error('[QuickResearchTool] Quick research failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: 'Quick research failed. Please try with a different query.'
      };
    }
  }
});

// Export both tools
export const ResearchTools = {
  DeepResearchTool,
  QuickResearchTool
};