import { openrouterCall, perplexityAsk, tavilySearch } from '../../clients.js';
import {
  ResearchInput, ResearchState, SubQuestion, Evidence, Report, ClarifyingQuestion,
  PROMPT_DECOMPOSE, PROMPT_GAPFILL, PROMPT_SYNTH, PROMPT_CLARIFY, PROMPT_CLARIFY_GEMINI,
  dedupeEvidence, withinWindow
} from './contracts.js';

// QUICK logger helper
const log = (...args: any[]) => console.log('[research]', ...args);

// HARD CAPS (call-count budgets)
const PPLX_CAP = 6;     // normal mode
const PPLX_CAP_DEEP = 10; // deep mode - more perplexity calls
const PPLX_DEEP_CAP = 3; // max 3 deep-research calls (knowledge + gap-fill)
const TAVILY_CAP = 16;   // normal mode
const TAVILY_CAP_DEEP = 24; // deep mode - more tavily calls
const OPENROUTER_CAP = 4;
const RUNTIME_CAP_MS = 12 * 60 * 1000; // 12 minutes max runtime

const DEFAULT_OR_MODEL = 'mistralai/mistral-7b-instruct:free';
const GEMINI_MODEL = 'google/gemini-2.5-flash';

function pickType(q: any): 'factual'|'knowledge'|'reasoning' {
  const t = (q.type || '').toLowerCase();
  if (t === 'factual' || t === 'knowledge' || t === 'reasoning') return t;
  return 'knowledge';
}

// Helper to truncate query for Tavily (400 char limit)
function truncateForTavily(query: string): string {
  if (query.length <= 400) return query;
  // Take first 380 chars and add ellipsis
  return query.substring(0, 380) + '...';
}

async function generateClarifyingQuestions(input: ResearchInput, state: ResearchState): Promise<ClarifyingQuestion[]> {
  if (state.openrouterCalls >= OPENROUTER_CAP) return [];
  
  // Choose model and prompt based on deep mode or explicit override
  const useGemini = input.clarifyModel === 'gemini' || (input.deepMode && input.clarifyModel !== 'mistral');
  const model = useGemini ? GEMINI_MODEL : DEFAULT_OR_MODEL;
  const prompt = useGemini ? PROMPT_CLARIFY_GEMINI(input.query) : PROMPT_CLARIFY(input.query);
  
  log('clarify> using model:', model);
  
  const { text } = await openrouterCall({
    model,
    messages: [
      { role: 'system', content: 'Return only JSON array. No prose.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3
  });

  let object: any[] = [];
  try { object = JSON.parse(text || '[]'); } catch { object = []; }
  
  state.openrouterCalls++;
  
  if (object && Array.isArray(object)) {
    log('clarify> generated', object.length, 'questions');
    return object.slice(0, 7).map((q, i) => ({
      id: `cq${i+1}`,
      question: String(q.question || '').trim(),
      purpose: String(q.purpose || '').trim(),
      suggested_answers: q.suggested_answers || []
    })).filter(q => q.question.length > 0);
  }
  
  return [];
}

async function decompose(input: ResearchInput, state: ResearchState): Promise<SubQuestion[]> {
  if (state.openrouterCalls >= OPENROUTER_CAP) return state.subqs;
  
  // Use Gemini for decomposition in deep mode
  const model = input.deepMode ? GEMINI_MODEL : DEFAULT_OR_MODEL;
  log('decompose> using model:', model);
  
  const { text: decompText } = await openrouterCall({
    model,
    messages: [
      { role: 'system', content: 'Return only JSON array. No prose.' },
      { role: 'user', content: PROMPT_DECOMPOSE(input.query) }
    ],
    temperature: 0.1
  });

  let arr: any[] = [];
  try { arr = JSON.parse(decompText || '[]'); } catch { arr = []; }
  
  state.openrouterCalls++;
  
  const subqs: SubQuestion[] = (arr || []).slice(0,8).map((x,i)=>({
      id: `sq${i+1}`,
      question: String(x.question || '').trim(),
      rationale: String(x.rationale || '').trim(),
      type: pickType(x)
    })).filter(s=>s.question.length>0);

  log('decompose> subqs', subqs.length);

  return subqs.length ? subqs : [{
    id: 'sq1', question: input.query, type: 'knowledge', rationale: 'fallback'
  }];
}

async function assignAndGather(input: ResearchInput, subqs: SubQuestion[], state: ResearchState) {
  const evidence: Evidence[] = [];
  
  // Dynamic budgets based on deep mode
  const pplxCap = input.deepMode ? PPLX_CAP_DEEP : PPLX_CAP;
  const tavilyCap = input.deepMode ? TAVILY_CAP_DEEP : TAVILY_CAP;
  const maxResults = input.deepMode ? 20 : 8;
  const searchDepth = input.deepMode ? 'advanced' : 'basic';
  
  log('gather> starting for', subqs.length, 'subqs (deep mode:', !!input.deepMode, ')');
  log('gather> budgets - pplx:', pplxCap, 'tavily:', tavilyCap, 'maxResults:', maxResults);

  // Enhanced routing: factual -> Tavily (advanced in deep mode); knowledge -> Deep-Research; reasoning -> Reasoning
  const tasks = subqs.map(async (sq) => {
    log('gather> processing subq:', sq.id, sq.type, sq.question.substring(0, 100) + '...');
    
    if (sq.type === 'factual' && state.tavilyCalls < tavilyCap) {
      state.tavilyCalls++;
      log('gather> tavily call for', sq.id, 'depth:', searchDepth);
      try {
        const res = await tavilySearch({
          query: truncateForTavily(sq.question),
          maxResults,
          timeRange: 'year',
          searchDepth
        });
        log('gather> tavily returned', res.items.length, 'items for', sq.id);
        for (const it of res.items) {
          if (withinWindow(it.published_at, input.from, input.to)) {
            evidence.push({ ...it, source_tool: 'tavily' });
          }
        }
      } catch (err: any) {
        log('gather> tavily error for', sq.id, ':', err?.message || err);
      }
    } else {
      if (state.pplxCalls >= pplxCap) {
        log('gather> skipping', sq.id, '- perplexity budget exhausted');
        return;
      }
      state.pplxCalls++;
      
      // Use deep-research for knowledge questions (if budget allows), reasoning for reasoning questions
      let mode: 'pro' | 'reasoning' | 'deep-research';
      if (sq.type === 'reasoning') {
        mode = 'reasoning';
      } else if (sq.type === 'knowledge' && state.pplxDeepCalls < PPLX_DEEP_CAP) {
        mode = 'deep-research';
        state.pplxDeepCalls++;
        log('gather> using deep-research for knowledge question, deep calls:', state.pplxDeepCalls);
      } else {
        mode = 'pro';
      }
      log('gather> perplexity call for', sq.id, 'mode:', mode);
      try {
        const a = await perplexityAsk({ prompt: sq.question, mode });
        log('gather> perplexity returned', a.citations?.length || 0, 'citations for', sq.id);
        
        // Treat model text as a hint; main value is citations
        const cites = (a.citations || []).slice(0, input.deepMode ? 10 : 6);
        if (cites.length && state.tavilyCalls < tavilyCap) {
          // fetch Tavily metadata for those URLs (batch not offered; do single calls via query string)
          state.tavilyCalls++;
          log('gather> tavily follow-up for citations from', sq.id);
          try {
            const res = await tavilySearch({
              query: truncateForTavily(sq.question),
              maxResults,
              timeRange: 'year',
              searchDepth
            });
            log('gather> tavily follow-up returned', res.items.length, 'items');
            
            // Merge: prefer tavily items that match cited domains, otherwise keep cites as raw Evidence
            const byDomain = new Map<string, Evidence>();
            for (const it of res.items) {
              try {
                byDomain.set(new URL(it.url).hostname.replace(/^m\./, '').replace(/^www\./, ''), {
                  ...it,
                  source_tool: 'tavily'
                });
              } catch {}
            }
            for (const url of cites) {
              let added = false;
              try {
                const host = new URL(url).hostname.replace(/^m\./, '').replace(/^www\./, '');
                const hit = byDomain.get(host);
                if (hit && withinWindow(hit.published_at, input.from, input.to)) {
                  evidence.push(hit);
                  added = true;
                }
              } catch {}
              if (!added) evidence.push({ url, source_tool: 'perplexity' });
            }
          } catch (err: any) {
            log('gather> tavily follow-up error for', sq.id, ':', err?.message || err);
            // Still add raw citations if Tavily fails
            for (const url of cites) evidence.push({ url, source_tool: 'perplexity' });
          }
        } else {
          for (const url of cites) evidence.push({ url, source_tool: 'perplexity' });
        }
      } catch (err: any) {
        log('gather> perplexity error for', sq.id, ':', err?.message || err);
      }
    }
  });

  await Promise.allSettled(tasks);
  log('gather> collected', evidence.length, 'raw evidence items');
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
  // Dynamic budgets based on deep mode
  const pplxCap = input.deepMode ? PPLX_CAP_DEEP : PPLX_CAP;
  const tavilyCap = input.deepMode ? TAVILY_CAP_DEEP : TAVILY_CAP;
  
  if (state.pplxCalls >= pplxCap && state.tavilyCalls >= tavilyCap) return [] as Evidence[];

  // Use Perplexity deep-research for comprehensive gap-filling + Tavily advanced
  const results: Evidence[] = [];

  if (state.pplxCalls < pplxCap) {
    state.pplxCalls++;
    
    // Use deep-research if budget allows, otherwise fallback to reasoning
    const mode = state.pplxDeepCalls < PPLX_DEEP_CAP ? 'deep-research' : 'reasoning';
    if (mode === 'deep-research') {
      state.pplxDeepCalls++;
      log('gapfill> using perplexity deep-research, deep calls:', state.pplxDeepCalls);
    } else {
      log('gapfill> deep-research budget exhausted, using reasoning mode');
    }
    
    const a = await perplexityAsk({
      prompt: PROMPT_GAPFILL(input.query, conflictTopic),
      mode
    });
    // Extract URLs from last line if present (JSON array), otherwise from citations
    const lines = a.text.trim().split('\n');
    const last = lines[lines.length - 1];
    let urls: string[] = [];
    try { urls = JSON.parse(last); } catch { urls = a.citations || []; }
    for (const u of urls.slice(0, 5)) results.push({ url: u, source_tool: 'perplexity' });
  }

  if (state.tavilyCalls < tavilyCap) {
    state.tavilyCalls++;
    const t = await tavilySearch({
      query: truncateForTavily(conflictTopic),
      searchDepth: 'advanced',
      maxResults: input.deepMode ? 20 : 8,
      timeRange: 'year',
      includeDomains: state.contradictions[0].urls.map(u => new URL(u).hostname)
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

export async function runDeepResearch(input: ResearchInput): Promise<{ report: Report; markdown: string; meta: any; clarifyingQuestions?: ClarifyingQuestion[] }> {
  const startTime = Date.now();
  log('research> starting deep research, mode:', input.deepMode ? 'DEEP' : 'NORMAL');
  
  const state: ResearchState = {
    input,
    clarifyingQuestions: [],
    refinedQuery: input.query,
    subqs: [],
    evidence: [],
    contradictions: [],
    pplxCalls: 0,
    pplxDeepCalls: 0,
    tavilyCalls: 0,
    openrouterCalls: 0
  };

  // 0) Generate clarifying questions (if interactive mode)
  if (input.interactive !== false) {
    state.clarifyingQuestions = await generateClarifyingQuestions(input, state);
    
    // If clarifying questions were generated, return them for user input
    if (state.clarifyingQuestions.length > 0) {
      return {
        report: {
          query: input.query,
          executive_summary: '',
          key_findings: [],
          sections: [],
          limitations: []
        },
        markdown: '',
        meta: {
          pplxCalls: state.pplxCalls,
          pplxDeepCalls: state.pplxDeepCalls,
          tavilyCalls: state.tavilyCalls,
          openrouterCalls: state.openrouterCalls,
          subqCount: 0,
          evidenceCount: 0,
          clarifyingQuestionsGenerated: true
        },
        clarifyingQuestions: state.clarifyingQuestions
      };
    }
  }

  // 1) Decompose
  state.subqs = await decompose({ ...input, query: state.refinedQuery }, state);

  // 2–3) Assign + Parallel gather
  const gathered = await assignAndGather(input, state.subqs, state);
  
  // Filter by time window
  state.evidence = gathered.filter(e => withinWindow(e.published_at, input.from, input.to));
  log('evidence> after initial gather:', state.evidence.length);
  
  // 4) Validate/Cross-check (lean)
  state.contradictions = findContradictions(state.evidence);
  log('contradictions>', state.contradictions.length);
  
  // 5) One gap-fill pass if we still have Perplexity or Tavily budget left
  if (state.contradictions.length) {
    const extra = await gapFill(input, state, state.contradictions[0].topic);
    // Merge and dedupe again
    state.evidence = dedupeEvidence([...state.evidence, ...extra]);
    log('gapfill> added', extra.length, 'items. evidence now', state.evidence.length);
  }

  // Runtime check before expensive operations
  if (Date.now() - startTime > RUNTIME_CAP_MS) {
    log('research> runtime cap exceeded, stopping early');
    return {
      report: {
        query: input.query,
        executive_summary: 'Research stopped due to time limit exceeded.',
        key_findings: [],
        sections: [],
        limitations: ['Research terminated early due to runtime cap.']
      },
      markdown: '# Research Brief\n\n**Query:** ' + input.query + '\n\n## Limitations\n- Research terminated early due to runtime cap.',
      meta: {
        pplxCalls: state.pplxCalls,
        pplxDeepCalls: state.pplxDeepCalls,
        tavilyCalls: state.tavilyCalls,
        openrouterCalls: state.openrouterCalls,
        subqCount: state.subqs.length,
        evidenceCount: state.evidence.length,
        runtimeExceeded: true
      }
    };
  }

  // Fallback: if still no evidence, try one broad Tavily search on the whole query
  const tavilyCap = input.deepMode ? TAVILY_CAP_DEEP : TAVILY_CAP;
  if (state.evidence.length === 0 && state.tavilyCalls < tavilyCap) {
    log('fallback> no evidence, running broad Tavily search');
    state.tavilyCalls++;
    const t = await tavilySearch({ 
      query: truncateForTavily(state.refinedQuery || input.query), 
      maxResults: input.deepMode ? 20 : 10, 
      timeRange: 'year', 
      searchDepth: 'advanced' 
    });
    state.evidence = dedupeEvidence(t.items.map((it: any)=>({ ...it, source_tool:'tavily' as const })));
    log('fallback> tavily items', state.evidence.length);
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

  // Only pass evidence the model can cite - more in deep mode
  const maxEvidence = input.deepMode ? 80 : 30;
  const citeable = state.evidence.slice(0, maxEvidence);
  const evidenceBlock = JSON.stringify(citeable, null, 2);

  // Use Gemini for synthesis in deep mode
  const synthModel = input.deepMode ? GEMINI_MODEL : DEFAULT_OR_MODEL;
  log('synthesis> using model:', synthModel, 'with', citeable.length, 'evidence items');

  const { object } = await openrouterCall<Report>({
    model: synthModel,
    messages: [
      { role: 'system', content: input.deepMode ? 
        'Return ONLY JSON strictly matching the provided schema. Generate comprehensive analysis with minimum 10 key findings and 3+ detailed sections.' :
        'Return ONLY JSON strictly matching the provided schema.' 
      },
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
      pplxDeepCalls: state.pplxDeepCalls,
      tavilyCalls: state.tavilyCalls,
      openrouterCalls: state.openrouterCalls,
      subqCount: state.subqs.length,
      evidenceCount: state.evidence.length
    }
  };
} 