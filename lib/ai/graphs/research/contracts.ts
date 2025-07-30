// Single place for types, tiny helpers, and prompts (no external schema libs)

export type SubQuestion = {
  id: string;
  question: string;
  rationale?: string;
  type: 'factual' | 'knowledge' | 'reasoning';
};

export type ClarifyingQuestion = {
  id: string;
  question: string;
  purpose: string;
  suggested_answers?: string[];
};

export type Evidence = {
  url: string;
  title?: string;
  snippet?: string;
  published_at?: string; // ISO
  source_tool: 'tavily' | 'perplexity' | 'openrouter';
};

export type Citation = Evidence;

export type KeyFinding = {
  claim: string;
  citations: Citation[];
  confidence: 'high' | 'medium' | 'low';
};

export type Report = {
  query: string;
  executive_summary: string;
  key_findings: KeyFinding[];
  sections: Array<{ heading: string; content: string; citations: Citation[] }>;
  limitations: string[];
};

export type ResearchInput = {
  query: string;
  from?: string; // ISO
  to?: string;   // ISO
  interactive?: boolean; // Whether to ask clarifying questions
  deepMode?: boolean; // Enable Gemini models and larger budgets
  clarifyModel?: 'gemini' | 'mistral'; // Override clarify model
};

export type ResearchState = {
  input: ResearchInput;
  clarifyingQuestions: ClarifyingQuestion[];
  refinedQuery: string;
  subqs: SubQuestion[];
  evidence: Evidence[];
  contradictions: Array<{ topic: string; urls: string[] }>;
  pplxCalls: number;
  pplxDeepCalls: number; // track deep-research calls separately
  tavilyCalls: number;
  openrouterCalls: number;
};

// -------------- helpers ---------------
export function canonicalUrl(u: string): string {
  try {
    const url = new URL(u);
    url.searchParams.sort();
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(k => url.searchParams.delete(k));
    if (url.hostname.startsWith('m.')) url.hostname = url.hostname.slice(2);
    return url.toString();
  } catch { return u; }
}

export function dedupeEvidence(items: Evidence[]): Evidence[] {
  const seen = new Map<string, Evidence>();
  for (const it of items) {
    const key = canonicalUrl(it.url);
    if (!seen.has(key)) seen.set(key, { ...it, url: key });
  }
  return Array.from(seen.values());
}

export function withinWindow(pub?: string, from?: string, to?: string) {
  if (!pub || (!from && !to)) return true;
  const t = Date.parse(pub);
  if (Number.isNaN(t)) return true;
  if (from && t < Date.parse(from)) return false;
  if (to && t > Date.parse(to)) return false;
  return true;
}

// -------------- prompts ----------------
export const PROMPT_CLARIFY = (q: string) => `
You are a research assistant. The user has asked: "${q}"

To provide the best research, generate 3-5 clarifying questions that would help narrow down the scope and improve the research quality.

For each question, provide:
- The clarifying question
- Why this question is important (purpose)
- 2-3 suggested answer options (if applicable)

Return JSON array with objects: { "question": "...", "purpose": "...", "suggested_answers": ["option1", "option2", "option3"] }

Focus on:
- Time scope (when/what period?)
- Geographic scope (where/which regions?)
- Industry/sector specifics
- Stakeholder perspective (who is affected?)
- Specific aspects of interest
- Scale/magnitude (how big/small?)

User question: ${q}
`;

export const PROMPT_CLARIFY_GEMINI = (q: string) => `
You are an expert research strategist. The user wants to research: "${q}"

Generate 5-7 insightful clarifying questions that will significantly improve research quality and depth. Each question should unlock a different dimension of understanding.

For each question, provide:
- A precise, thought-provoking clarifying question
- The strategic purpose (why this matters for comprehensive research)
- 2-4 specific answer options that represent meaningful choices

Return a JSON array with objects: { "question": "...", "purpose": "...", "suggested_answers": ["option1", "option2", "option3", "option4"] }

Focus on strategic dimensions:
- Temporal scope (historical context, current state, future projections)
- Geographic/market scope (global vs regional focus, emerging vs established markets)
- Industry verticals and cross-sector implications
- Stakeholder ecosystems (startups, investors, regulators, customers)
- Analytical depth (quantitative metrics, qualitative trends, comparative analysis)
- Use case specificity (applications, technologies, business models)
- Scale and impact (market size, disruption potential, adoption patterns)

Make each question unlock substantially different research paths and evidence types.

User research topic: ${q}
`;

export const PROMPT_DECOMPOSE = (q: string) => `
Decompose the user question into 4-8 non-overlapping sub-questions.
For each, label it as one of: 
- factual (requires up-to-date sources or numbers/dates),
- knowledge (general synthesis),
- reasoning (multi-step inference or ambiguous).
Return JSON array with objects: { "question": "...", "type": "factual|knowledge|reasoning", "rationale": "..." }.
User question: ${q}
`;

export const PROMPT_GAPFILL = (q: string, conflict: string) => `
We have conflicting or missing information about: ${conflict}.
Provide a concise resolution or the most likely explanation, and list all the URLs that best support it.
Return a short paragraph answer followed by a JSON array of URLs on a new line.
User question: ${q}
`;

export const PROMPT_SYNTH = (q: string) => `
You are writing a concise research brief. 
Rules:
- Use ONLY the provided Evidence list (URLs/titles/snippets/dates) as sources.
- Every numeric or dated claim must cite at least one provided URL.
- If something is uncertain or conflicting, include it under "limitations".

Return a JSON object with:
{
  "query": string,
  "executive_summary": string,
  "key_findings": [{ "claim": string, "citations": Citation[], "confidence": "high|medium|low" }],
  "sections": [{ "heading": string, "content": string, "citations": Citation[] }],
  "limitations": string[]
}
Where Citation has: { "url": string, "title": string, "snippet": string, "published_at": string }
User question: ${q}
`; 