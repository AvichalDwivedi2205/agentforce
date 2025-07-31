import minimist from 'minimist';
import { runDeepResearch } from './lib/ai/graphs/research/graph.js';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// Helper function to ask user questions
function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  // Filter out the extra -- separator that pnpm adds
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const argv = minimist(args);
  const query = (argv.q || argv.query) as string;
  const ideationTopic = (argv.ideation || argv.i) as string;
  const from = argv.from as string | undefined;
  const to   = argv.to as string | undefined;
  const skipClarify = argv['skip-clarify'] || argv.s;
  const deepMode = argv.deep || argv.d;
  const clarifyModel = argv['clarify-model'] as 'gemini' | 'mistral' | undefined;
  const clearCache = argv['clear-cache'];

  // Handle ideation agent first
  if (ideationTopic) {
    const { runIdeation } = await import('./lib/ai/graphs/ideation/graph.js');
    
    console.log('💡 Starting ideation for:', ideationTopic);
    
    const result = await runIdeation({
      topic: ideationTopic,
      clearCache
    });
    
    console.log('\n=== BRIEF ===');
    console.log(`Topic: ${result.brief.topic}`);
    console.log(`Goal: ${result.brief.goal}`);
    console.log(`Audience: ${result.brief.audience}`);
    console.log(`Time Horizon: ${result.brief.time_horizon}`);
    console.log(`Risk Appetite: ${result.brief.risk_appetite}`);
    
    console.log('\n=== IDEAS ===');
    result.ideas.forEach((idea, i) => {
      const score = result.scores.find(s => s.idea_id === idea.id);
      console.log(`\n${i + 1}. ${idea.title}`);
      console.log(`   ${idea.summary}`);
      console.log(`   Benefits: ${idea.who_benefits.join(', ')}`);
      console.log(`   Why now: ${idea.why_now}`);
      console.log(`   Key test: ${idea.test.design}`);
      console.log(`   ICE Score: ${score?.ICE.score}, RICE Score: ${score?.RICE.score}`);
      if (idea.sources.length > 0) {
        console.log(`   Sources: ${idea.sources.length} references`);
      }
    });
    
    console.log('\n=== TOP IDEA ONE-PAGER ===');
    console.log(result.onePager);
    
    console.log('\n=== DECISION LOG ===');
    console.log(result.decisionLog);
    
    console.log('\n=== META ===');
    console.log(`Runtime: ${result.meta.runtime_ms}ms`);
    console.log(`API Calls:`, result.meta.costs);
    
    // Save to file
    const outDir = path.resolve('generated_files');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `ideation-${timestamp}.md`;
    const filePath = path.join(outDir, fileName);
    
    const markdown = generateIdeationMarkdown(result);
    fs.writeFileSync(filePath, markdown, 'utf8');
    console.log(`\nIdeation report saved to: ${filePath}`);
    
    return; // Exit early, don't run research agent
  }

  if (!query) {
    console.error('Usage:');
    console.error('  Research: pnpm start -- --q "Your question" [--deep] [--skip-clarify] [--clear-cache]');
    console.error('  Ideation: pnpm start -- --ideation "Business topic" [--clear-cache]');
    process.exit(1);
  }

  if (deepMode) {
    console.log('🚀 Deep Research Mode: Using sonar-pro models and advanced search depth');
  }

  let finalQuery = query;
  
  // First run to get exactly 2 clarifying questions (unless skipped)
  if (!skipClarify) {
    console.log('🔍 Generating 2 clarifying questions to improve research quality...\n');
    
    const { clarifyingQuestions } = await runDeepResearch({ 
      query, 
      from, 
      to, 
      deepMode,
      clarifyModel,
      clearCache
    });

    if (clarifyingQuestions && clarifyingQuestions.length > 0) {
      console.log('📋 To provide better research, please help clarify your request:\n');
      
      const answers: string[] = [];
      for (const cq of clarifyingQuestions) {
        console.log(`❓ ${cq.question}`);
        console.log(`   Purpose: ${cq.purpose}`);
        
        if (cq.suggested_answers && cq.suggested_answers.length > 0) {
          console.log(`   Suggested options: ${cq.suggested_answers.join(', ')}`);
        }
        
        const answer = await askQuestion('   Your answer (or press Enter to skip): ');
        if (answer) {
          answers.push(`${cq.question}: ${answer}`);
        }
        console.log('');
      }
      
      // Refine the query with answers
      if (answers.length > 0) {
        finalQuery = `${query}\n\nAdditional context:\n${answers.join('\n')}`;
        console.log('✅ Thank you! Running research with your clarifications...\n');
      } else {
        console.log('📝 Running research with original query...\n');
      }
    }
  }

  // Run the actual research (skip clarifying questions on this call)
  console.log('🚀 Starting comprehensive research...\n');
  const { report, markdown, meta } = await runDeepResearch({ 
    query: finalQuery, 
    from, 
    to, 
    deepMode,
    clarifyModel,
    clearCache,
    skipClarify: true  // Skip clarifying questions on the actual research call
  });

  console.log('=== META ===');
  console.log(meta);
  console.log('\n=== REPORT(JSON) ===');
  console.log(JSON.stringify(report, null, 2));
  console.log('\n=== REPORT(Markdown) ===');
  console.log(markdown);

  // --- Save Markdown to disk ---
  const outDir = path.resolve('generated_files');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `report-${timestamp}.md`;
  const filePath = path.join(outDir, fileName);
  fs.writeFileSync(filePath, markdown, 'utf8');
  console.log(`\nMarkdown report saved to: ${filePath}`);
}

// Generate markdown for ideation reports
function generateIdeationMarkdown(result: any): string {
  const { brief, ideas, scores, onePager, decisionLog, meta } = result;
  
  let md = `# Ideation Report\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n`;
  md += `**Topic:** ${brief.topic}\n`;
  md += `**Runtime:** ${meta.runtime_ms}ms\n`;
  md += `**API Calls:** OpenRouter: ${meta.costs.openrouter}, Tavily: ${meta.costs.tavily}, Perplexity: ${meta.costs.perplexity}\n\n`;
  
  md += `## Brief\n\n`;
  md += `**Goal:** ${brief.goal}\n\n`;
  md += `**Audience:** ${brief.audience}\n\n`;
  md += `**Constraints:** ${brief.constraints.join(', ')}\n\n`;
  md += `**Time Horizon:** ${brief.time_horizon}\n\n`;
  md += `**Risk Appetite:** ${brief.risk_appetite}\n\n`;
  md += `**Success Metric:** ${brief.success_metric}\n\n`;
  
  md += `## Ideas (${ideas.length})\n\n`;
  
  ideas.forEach((idea: any, i: number) => {
    const score = scores.find((s: any) => s.idea_id === idea.id);
    md += `### ${i + 1}. ${idea.title}\n\n`;
    md += `**Summary:** ${idea.summary}\n\n`;
    md += `**Who Benefits:** ${idea.who_benefits.join(', ')}\n\n`;
    md += `**Why Now:** ${idea.why_now}\n\n`;
    md += `**Key Assumptions:**\n${idea.assumptions.map((a: string) => `- ${a}`).join('\n')}\n\n`;
    md += `**Risks/Harms:**\n${idea.risks_harms.map((r: string) => `- ${r}`).join('\n')}\n\n`;
    md += `**Validation Test:**\n- **Design:** ${idea.test.design}\n- **Success:** ${idea.test.success}\n- **Timeline:** ${idea.test.timebox}\n- **Budget:** ${idea.test.budget}\n\n`;
    md += `**Effort:** ${idea.effort.dev_weeks} weeks, ${idea.effort.complexity} complexity\n\n`;
    md += `**Dependencies:** ${idea.effort.deps.join(', ')}\n\n`;
    md += `**Scores:** ICE=${score?.ICE.score}, RICE=${score?.RICE.score}\n\n`;
    
    if (idea.sources.length > 0) {
      md += `**Sources:**\n${idea.sources.map((s: any) => `- [${s.title}](${s.url})`).join('\n')}\n\n`;
    }
    
    md += `---\n\n`;
  });
  
  md += `## Top Idea Analysis\n\n${onePager}\n\n`;
  md += `## Decision Log\n\n${decisionLog}\n`;
  
  return md;
}

main().catch((e) => {
  console.error('Fatal error:', e?.response?.data ?? e);
  process.exit(1);
}); 