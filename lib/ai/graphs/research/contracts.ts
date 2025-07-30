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
  extraDeep?: boolean; // Force second deep-research call
  noExtraDeep?: boolean; // Disable auto second deep-research call
  clearCache?: boolean; // Clear cache before run
};

export type ExpandedQuery = {
  original: string;
  expanded: string[];
  domains?: {
    include?: string[];
    exclude?: string[];
  };
};

export type EvidenceCluster = {
  theme: string;
  urls: string[];
  evidence: Evidence[];
  strength: number; // citation count or confidence score
  contradictions?: string[];
};

export type DeepDiveSection = {
  theme: string;
  content: string;
  findings: KeyFinding[];
  metrics_table?: string; // Markdown table
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
  // Enhanced state
  expandedQueries?: ExpandedQuery[];
  evidenceClusters?: EvidenceCluster[];
  deepDiveSection?: DeepDiveSection;
  allSourceUrls?: string[];
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
You are a research strategist helping to design the perfect research approach. The user wants to research: "${q}"

Your task is to ask 2-3 thoughtful questions that will help create a much better, more focused research report. Think creatively about what would make this research most valuable.

Consider asking about:
- What specific aspects matter most to them
- What type of analysis would be most useful
- What perspective or angle would be most insightful
- What scope or focus would provide the best value

Feel free to ask whatever you think would genuinely improve the research - don't be limited by templates.

For each question, provide:
- The question itself (make it conversational and clear)
- A brief explanation of why this helps
- 3-4 practical answer options

Return a JSON array: [{"question": "...", "purpose": "...", "suggested_answers": ["...", "...", "..."]}]

Research topic: ${q}
`;

export const PROMPT_QUERY_EXPAND = (macroTopics: string[]) => `
You are a search query optimization expert. For each macro-topic below, generate 3 diverse search phrases that will find comprehensive evidence.

Use advanced search techniques:
- Synonyms and related terms
- Boolean operators (AND, OR)
- Domain-specific terminology
- File type hints when useful ("filetype:pdf" for reports)
- Time-sensitive keywords when relevant

Also suggest authoritative domains to include/exclude for each topic.

Return JSON array with objects: { 
  "topic": "...", 
  "queries": ["query1", "query2", "query3"],
  "include_domains": ["domain1.com", "domain2.org"],
  "exclude_domains": ["spam.com", "lowquality.net"]
}

Macro-topics: ${macroTopics.join(', ')}
`;

export const PROMPT_CLUSTER_EVIDENCE = (evidenceItems: Evidence[]) => `
You are a research analyst. Cluster the evidence items below into 4-6 thematic groups.

For each cluster, provide:
- Theme name (concise, descriptive)
- Evidence strength score (1-10 based on citation count and source quality)
- Key evidence statements (bullet points, ≤40 tokens each)
- Any contradictions within the cluster

Return JSON array with objects: {
  "theme": "...",
  "strength": 8,
  "evidence_statements": ["statement1", "statement2", ...],
  "contradictions": ["contradiction1", ...]
}

Evidence items: ${JSON.stringify(evidenceItems.slice(0, 100), null, 2)}
`;

export const PROMPT_DEEP_GLOBAL = (evidenceClusters: EvidenceCluster[], query: string) => `
You are writing a comprehensive research brief. Create an analyst-grade report with extensive detail and thorough analysis.

REQUIREMENTS:
- Executive summary: ≥300 words with key insights
- Key findings: ≥15 findings with high confidence citations
- Main sections: ≥5 sections, each ≥250 words with detailed analysis
- Inline citations: Use provided evidence extensively (≥60 citations total)
- Appendix: List all primary sources used

ANALYSIS DEPTH:
- Provide quantitative data with context and implications
- Include trend analysis and comparative insights  
- Explain causation, not just correlation
- Address different stakeholder perspectives
- Highlight market dynamics and competitive landscape

Return JSON strictly matching the Report schema with comprehensive content.

Query: ${query}
Evidence clusters: ${JSON.stringify(evidenceClusters, null, 2)}
`;

export const PROMPT_DEEP_FOCUSED = (cluster: EvidenceCluster, query: string) => `
You are conducting a deep-dive analysis on a specific research theme. Create a comprehensive 700+ word analysis with additional findings and metrics.

REQUIREMENTS:
- Deep-dive content: ≥700 words with detailed analysis and insights
- Additional findings: 5 new findings specific to this theme
- Metrics table: Create a markdown table with ≥8 relevant metrics/data points
- Use ONLY the evidence cluster provided below

Focus on:
- Detailed trend analysis with specific numbers
- Comparative analysis across time periods or segments
- Market dynamics and implications
- Stakeholder impact assessment
- Future projections based on current data

Return JSON: {
  "theme": "...",
  "content": "700+ word analysis...",
  "findings": [5 KeyFinding objects],
  "metrics_table": "markdown table with 8+ metrics"
}

Original query: ${query}
Evidence cluster: ${JSON.stringify(cluster, null, 2)}
`;

export const PROMPT_CONTRAST_ANALYSIS = (cluster1: EvidenceCluster, cluster2: EvidenceCluster) => `
You are analyzing contradictions between two evidence clusters. Identify key conflicts and provide balanced analysis.

Return JSON array of contradiction objects: {
  "topic": "specific area of conflict",
  "cluster1_position": "what cluster1 suggests",
  "cluster2_position": "what cluster2 suggests", 
  "analysis": "balanced explanation of the conflict",
  "confidence": "high|medium|low"
}

Cluster 1: ${JSON.stringify(cluster1, null, 2)}
Cluster 2: ${JSON.stringify(cluster2, null, 2)}
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