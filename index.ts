import minimist from 'minimist';
import { runDeepResearch } from './lib/ai/graphs/research/graph.js';

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
}

main().catch((e) => {
  console.error('Fatal error:', e?.response?.data ?? e);
  process.exit(1);
}); 