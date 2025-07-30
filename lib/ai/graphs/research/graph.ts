import { openrouterCall, perplexityAsk, tavilySearch } from '../../clients.js';
import {
  ResearchInput, ResearchState, SubQuestion, Evidence, Report,
  PROMPT_DECOMPOSE, PROMPT_GAPFILL, PROMPT_SYNTH,
  dedupeEvidence, withinWindow
} from './contracts.js';

// HARD CAPS (call-count budgets)
const PPLX_CAP = 6;     // by the 6th Perplexity run, we must produce
const TAVILY_CAP = 16;
const OPENROUTER_CAP = 4;

function pickType(q: any): 'factual'|'knowledge'|'reasoning' {
  const t = (q.type || '').toLowerCase();
  if (t === 'factual' || t === 'knowledge' || t === 'reasoning') return t;
  return 'knowledge';
}

async function decompose(input: ResearchInput, state: ResearchState): Promise<SubQuestion[]> {
  if (state.openrouterCalls >= OPENROUTER_CAP) return state.subqs;
  
  // Add schema for better reliability
  const decomposeSchema = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        type: { type: 'string', enum: ['factual', 'knowledge', 'reasoning'] },
        rationale: { type: 'string' }
      },
      required: ['question', 'type']
    }
  };

  const { object } = await openrouterCall<SubQuestion[]>({
    model: 'google/gemini-2.5-flash',
    messages: [
      { role: 'system', content: 'Return only JSON array. No prose.' },
      { role: 'user', content: PROMPT_DECOMPOSE(input.query) }
    ],
    schema: decomposeSchema,
    temperature: 0.1
  });
  
  state.openrouterCalls++;
  
  // Use structured output if available, fallback to text parsing
  let subqs: SubQuestion[] = [];
  if (object && Array.isArray(object)) {
    subqs = object.slice(0, 8).map((x, i) => ({
      id: `sq${i+1}`,
      question: String(x.question || '').trim(),
      rationale: String(x.rationale || '').trim(),
      type: pickType(x)
    })).filter(s => s.question.length > 0);
  }
  
  return subqs.length ? subqs : [{
    id: 'sq1', question: input.query, type: 'knowledge', rationale: 'fallback'
  }];
}

async function assignAndGather(input: ResearchInput, subqs: SubQuestion[], state: ResearchState) {
  const evidence: Evidence[] = [];

  // Simple routing: factual -> Tavily; knowledge -> Perplexity(pro); reasoning -> Perplexity(reasoning)
  const tasks = subqs.map(async (sq) => {
    if (sq.type === 'factual' && state.tavilyCalls < TAVILY_CAP) {
      state.tavilyCalls++;
      const res = await tavilySearch({
        query: sq.question, maxResults: 8,
        timeRange: input.from || input.to ? 'y' : 'all',
        searchDepth: 'basic'
      });
      for (const it of res.items) {
        if (withinWindow(it.published_at, input.from, input.to)) {
          evidence.push({ ...it, source_tool: 'tavily' });
        }
      }
    } else {
      if (state.pplxCalls >= PPLX_CAP) return;
      state.pplxCalls++;
      const mode = sq.type === 'reasoning' ? 'reasoning' : 'pro';
      const a = await perplexityAsk({ prompt: sq.question, mode });
      // Treat model text as a hint; main value is citations
      const cites = (a.citations || []).slice(0, 6);
      if (cites.length && state.tavilyCalls < TAVILY_CAP) {
        // fetch Tavily metadata for those URLs (batch not offered; do single calls via query string)
        state.tavilyCalls++;
        const res = await tavilySearch({ query: sq.question, maxResults: 8, timeRange: 'all', searchDepth: 'basic' });
        // Merge: prefer tavily items that match cited domains, otherwise keep cites as raw Evidence
        const byDomain = new Map<string, Evidence>();
        for (const it of res.items) {
          try { byDomain.set(new URL(it.url).hostname.replace(/^m\./,'').replace(/^www\./,''), { ...it, source_tool: 'tavily' }); } catch {}
        }
        for (const url of cites) {
          let added = false;
          try {
            const host = new URL(url).hostname.replace(/^m\./,'').replace(/^www\./,'');
            const hit = byDomain.get(host);
            if (hit && withinWindow(hit.published_at, input.from, input.to)) {
              evidence.push(hit);
              added = true;
            }
          } catch {}
          if (!added) evidence.push({ url, source_tool: 'perplexity' });
        }
      } else {
        for (const url of cites) evidence.push({ url, source_tool: 'perplexity' });
      }
    }
  });

  await Promise.allSettled(tasks);
  return dedupeEvidence(evidence);
}

function findContradictions(evd: Evidence[]): Array<{ topic: string; urls: string[] }> {
  // Minimal: if multiple sources from same domain family disagree we won't detect without body parsing.
  // Here, we only mark contradiction when multiple sources exist for the same query (heuristic placeholder).
  // Keep it lean: if we have 8+ diverse URLs, assume potential conflicts to trigger 1 gap-fill pass.
  if (evd.length >= 8) {
    const urls = evd.slice(0, 5).map(e => e.url);
    return [{ topic: 'Key facts appear to vary across sources', urls }];
  }
  return [];
}

async function gapFill(input: ResearchInput, state: ResearchState, conflictTopic: string) {
  if (state.pplxCalls >= PPLX_CAP && state.tavilyCalls >= TAVILY_CAP) return [] as Evidence[];

  // Use Perplexity reasoning + Tavily advanced
  const results: Evidence[] = [];

  if (state.pplxCalls < PPLX_CAP) {
    state.pplxCalls++;
    const a = await perplexityAsk({
      prompt: PROMPT_GAPFILL(input.query, conflictTopic),
      mode: 'reasoning'
    });
    // Extract URLs from last line if present (JSON array), otherwise from citations
    const lines = a.text.trim().split('\n');
    const last = lines[lines.length - 1];
    let urls: string[] = [];
    try { urls = JSON.parse(last); } catch { urls = a.citations || []; }
    for (const u of urls.slice(0, 5)) results.push({ url: u, source_tool: 'perplexity' });
  }

  if (state.tavilyCalls < TAVILY_CAP) {
    state.tavilyCalls++;
    const t = await tavilySearch({
      query: conflictTopic,
      searchDepth: 'advanced',
      maxResults: 8,
      timeRange: input.from || input.to ? 'y' : 'all'
    });
    for (const it of t.items) {
      if (withinWindow(it.published_at, input.from, input.to)) {
        results.push({ ...it, source_tool: 'tavily' });
      }
    }
  }

  return dedupeEvidence(results);
}

function buildMarkdown(report: Report): string {
  const cite = (c: Evidence) => `[[source]](${c.url})`;
  const sectionMd = report.sections.map(s =>
`### ${s.heading}
${s.content}

${s.citations.map(cite).join(' ')}
`).join('\n');

  const findings = report.key_findings.map(k =>
`- **${k.claim}** — _${k.confidence}_  
  ${k.citations.map(cite).join(' ')}
`).join('\n');

  return `# Research Brief

**Query:** ${report.query}

## Executive Summary
${report.executive_summary}

## Key Findings
${findings}

## Details
${sectionMd}

## Limitations
${report.limitations.map(l => `- ${l}`).join('\n')}
`;
}

export async function runDeepResearch(input: ResearchInput): Promise<{ report: Report; markdown: string; meta: any }> {
  const state: ResearchState = {
    input,
    subqs: [],
    evidence: [],
    contradictions: [],
    pplxCalls: 0,
    tavilyCalls: 0,
    openrouterCalls: 0
  };

  // 1) Decompose
  state.subqs = await decompose(input, state);

  // 2–3) Assign + Parallel gather
  const gathered = await assignAndGather(input, state.subqs, state);

  // Filter by time window
  state.evidence = gathered.filter(e => withinWindow(e.published_at, input.from, input.to));

  // 4) Validate/Cross-check (lean)
  state.contradictions = findContradictions(state.evidence);

  // 5) One gap-fill pass if we still have Perplexity or Tavily budget left
  if (state.contradictions.length) {
    const extra = await gapFill(input, state, state.contradictions[0].topic);
    // Merge and dedupe again
    state.evidence = dedupeEvidence([...state.evidence, ...extra]);
  }

  // 6) Synthesize (structured)
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string' },
      executive_summary: { type: 'string' },
      key_findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            claim: { type: 'string' },
            citations: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' },
                  snippet: { type: 'string' },
                  published_at: { type: 'string' }
                },
                required: ['url']
              }
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
          },
          required: ['claim', 'citations', 'confidence']
        }
      },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            heading: { type: 'string' },
            content: { type: 'string' },
            citations: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' },
                  snippet: { type: 'string' },
                  published_at: { type: 'string' }
                },
                required: ['url']
              }
            }
          },
          required: ['heading', 'content', 'citations']
        }
      },
      limitations: { type: 'array', items: { type: 'string' } }
    },
    required: ['query','executive_summary','key_findings','sections','limitations']
  };

  // Only pass evidence the model can cite
  const citeable = state.evidence.slice(0, 30); // keep prompt compact
  const evidenceBlock = JSON.stringify(citeable, null, 2);

  const { object } = await openrouterCall<Report>({
    model: 'google/gemini-2.5-flash',
    messages: [
      { role: 'system', content: 'Return ONLY JSON strictly matching the provided schema.' },
      { role: 'user', content: `Evidence:\n${evidenceBlock}\n\n${PROMPT_SYNTH(input.query)}` }
    ],
    schema,
    temperature: 0.2
  });

  const report: Report = object ?? {
    query: input.query,
    executive_summary: 'Unable to synthesize a full report with current budgets.',
    key_findings: [],
    sections: [],
    limitations: ['Synthesis failed to return structured output.']
  };

  // Ensure every finding has at least one citation; otherwise downgrade to limitations
  const sanitizedFindings = report.key_findings.filter(k => (k.citations || []).length > 0);
  const missing = report.key_findings.length - sanitizedFindings.length;
  if (missing > 0) {
    report.limitations = report.limitations || [];
    report.limitations.push(`${missing} key finding(s) removed due to missing citations.`);
    report.key_findings = sanitizedFindings;
  }

  const markdown = buildMarkdown(report);

  return {
    report,
    markdown,
    meta: {
      pplxCalls: state.pplxCalls,
      tavilyCalls: state.tavilyCalls,
      openrouterCalls: state.openrouterCalls,
      subqCount: state.subqs.length,
      evidenceCount: state.evidence.length
    }
  };
} 