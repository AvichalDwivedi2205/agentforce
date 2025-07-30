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
  const argv = minimist(process.argv.slice(2));
  const query = (argv.q || argv.query) as string;
  const from = argv.from as string | undefined;
  const to   = argv.to as string | undefined;
  const skipClarify = argv['skip-clarify'] || argv.s;
  const deepMode = argv.deep || argv.d;
  const clarifyModel = argv['clarify-model'] as 'gemini' | 'mistral' | undefined;
  const extraDeep = argv['extra-deep'];
  const noExtraDeep = argv['no-extra-deep'];
  const clearCache = argv['cache-clear'];

  if (!query) {
    console.error('Usage: tsx index.ts --q "Your question" [--from 2024-10-01] [--to 2025-07-30] [--skip-clarify] [--deep] [--extra-deep] [--no-extra-deep] [--cache-clear] [--clarify-model gemini|mistral]');
    process.exit(1);
  }

  if (deepMode) {
    console.log('🚀 Deep Research Mode: Using Gemini models and enhanced budgets');
  }

  let finalQuery = query;
  
  // First run to get clarifying questions (unless skipped)
  if (!skipClarify) {
    console.log('🔍 Generating clarifying questions to improve research quality...\n');
    
    const { clarifyingQuestions } = await runDeepResearch({ 
      query, 
      from, 
      to, 
      interactive: true,
      deepMode,
      clarifyModel,
      extraDeep,
      noExtraDeep,
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

  // Run the actual research
  const { report, markdown, meta } = await runDeepResearch({ 
    query: finalQuery, 
    from, 
    to, 
    interactive: false,
    deepMode,
    clarifyModel,
    extraDeep,
    noExtraDeep,
    clearCache
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

main().catch((e) => {
  console.error('Fatal error:', e?.response?.data ?? e);
  process.exit(1);
}); 