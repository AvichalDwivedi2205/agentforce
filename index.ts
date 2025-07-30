import minimist from 'minimist';
import { runDeepResearch } from './lib/ai/graphs/research/graph.js';
import fs from 'fs';
import path from 'path';

async function main() {
  const argv = minimist(process.argv.slice(2));
  const query = (argv.q || argv.query) as string;
  const from = argv.from as string | undefined;
  const to   = argv.to as string | undefined;

  if (!query) {
    console.error('Usage: tsx index.ts --q "Your question" [--from 2024-10-01] [--to 2025-07-30]');
    process.exit(1);
  }

  const { report, markdown, meta } = await runDeepResearch({ query, from, to });

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