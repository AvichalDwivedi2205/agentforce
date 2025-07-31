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
  from?: string; // ISO date range start
  to?: string;   // ISO date range end
  deepMode?: boolean; // Enable deeper research with sonar-pro models and advanced search
  clarifyModel?: 'gemini' | 'mistral'; // Override clarify model (default: mistral)
  clearCache?: boolean; // Clear cache before research starts
  skipClarify?: boolean; // Skip clarifying questions (internal flag)
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
  globalCitationCounter: number; // track citation numbering across all sources
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

Generate exactly 2 comprehensive clarifying questions that would help narrow down the scope and dramatically improve the research quality and narrow down search.

For each question, provide:
- The clarifying question (conversational and clear)
- Why this question is important (purpose)
- 3-4 practical suggested answer options

Return JSON array with exactly 2 objects: { "question": "...", "purpose": "...", "suggested_answers": ["option1", "option2", "option3", "option4"] }

User question: ${q}
`;

export const PROMPT_CLARIFY_GEMINI = (q: string) => `
You are a research assistant. The user has asked: "${q}"

Generate exactly 2 comprehensive clarifying questions that would help narrow down the scope and dramatically improve the research quality and narrow down search.

For each question, provide:
- The clarifying question (conversational and clear)
- Why this question is important (purpose)
- 3-4 practical suggested answer options

Return JSON array with exactly 2 objects: { "question": "...", "purpose": "...", "suggested_answers": ["option1", "option2", "option3", "option4"] }

User question: ${q}
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
You are writing a comprehensive research brief with mandatory inline citations throughout.

CRITICAL CITATION REQUIREMENTS:
- Every factual claim, statistic, quote, or data point MUST have an inline citation immediately after it
- Use format: "Statement with fact [1]." or "Multiple claims [1][2]."  
- Number citations sequentially: [1], [2], [3], etc.
- Include citations throughout ALL content: executive_summary, sections, and key_findings
- Use provided evidence extensively (≥60 citations total across all content)

CONTENT REQUIREMENTS:
- Executive summary: ≥300 words with key insights and inline citations [1][2][3]
- Key findings: ≥15 findings with high confidence citations embedded in claims
- Main sections: ≥5 sections, each ≥250 words with detailed analysis and inline citations
- Never make unsupported claims - if no evidence exists, don't include the claim

ANALYSIS DEPTH:
- Provide quantitative data with context and implications [with citations]
- Include trend analysis and comparative insights [with citations]
- Explain causation, not just correlation [with citations]
- Address different stakeholder perspectives [with citations]  
- Highlight market dynamics and competitive landscape [with citations]

EXAMPLE CITATION STYLE:
"Decentralized governance models show 35% improved accountability through blockchain transparency [1]. The ETHOS framework has been adopted by 12 major protocols, reducing compliance costs by an average of €2.3M annually [2][3]. Recent analysis indicates that 78% of enterprises prefer hybrid governance models over purely centralized approaches [4]."

Return JSON strictly matching the Report schema with comprehensive content and inline citations.

Query: ${query}
Evidence clusters: ${JSON.stringify(evidenceClusters, null, 2)}
`;

export const PROMPT_DEEP_FOCUSED = (cluster: EvidenceCluster, query: string) => `
You are conducting a deep-dive analysis on a specific research theme with mandatory inline citations.

CRITICAL CITATION REQUIREMENTS:
- Every factual claim, statistic, quote, or data point MUST have an inline citation immediately after it
- Use format: "Statement with fact [1]." or "Multiple claims [1][2]."  
- Number citations sequentially: [1], [2], [3], etc.
- Use ONLY the evidence cluster provided below as sources
- Never make unsupported claims - if no evidence exists, don't include the claim

CONTENT REQUIREMENTS:
- Deep-dive content: ≥700 words with detailed analysis, insights, and inline citations [1][2][3]
- Additional findings: 5 new findings specific to this theme with embedded citations
- Metrics table: Create a markdown table with ≥8 relevant metrics/data points (cite sources)
- Use ONLY the evidence cluster provided below

Focus on (with citations for all claims):
- Detailed trend analysis with specific numbers [cite sources]
- Comparative analysis across time periods or segments [cite sources]
- Market dynamics and implications [cite sources]
- Stakeholder impact assessment [cite sources]
- Future projections based on current data [cite sources]

EXAMPLE CITATION STYLE:
"The adoption rate increased by 45% in Q3 2024 [1]. Market leaders like Protocol X reported 60% efficiency gains [2], while smaller players achieved 25% improvements [3]."

Return JSON: {
  "theme": "...",
  "content": "700+ word analysis with inline citations [1][2][3]...",
  "findings": [5 KeyFinding objects with citations in claim text],
  "metrics_table": "markdown table with 8+ metrics and source citations"
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
Analyze this research topic and break it down into 3-6 distinct, focused themes for comprehensive analysis.

ADAPTIVE COMPLEXITY GUIDELINES:
- Simple/straightforward topics → 3 themes
- Moderately complex topics → 4-5 themes  
- Highly complex/multi-faceted topics → 6 themes

Each theme should cover a different major aspect of the topic. Make them specific and actionable for research.

Think about the natural complexity and scope of this topic, then choose the optimal number of themes (3-6) that will provide comprehensive coverage without unnecessary overlap.

Return your themes as a JSON array:
[
  {"question": "Theme 1: [Specific aspect]", "type": "knowledge", "rationale": "Why this theme matters"},
  {"question": "Theme 2: [Different aspect]", "type": "knowledge", "rationale": "Why this theme matters"}, 
  {"question": "Theme 3: [Third major aspect]", "type": "knowledge", "rationale": "Why this theme matters"}
  // Add 4-6 themes if the topic complexity warrants it
]

Focus on themes that will provide comprehensive coverage without overlap. Choose the number of themes based on what the topic actually needs, not a fixed count.

User question: ${q}
`;

export const PROMPT_GAPFILL = (q: string, conflict: string) => `
We have conflicting or missing information about: ${conflict}.
Provide a concise resolution or the most likely explanation, and list all the URLs that best support it.
Return a short paragraph answer followed by a JSON array of URLs on a new line.
User question: ${q}
`;

export const PROMPT_SYNTH = (q: string) => `
You are writing a comprehensive research report with mandatory inline citations.

CRITICAL CITATION REQUIREMENTS:
- Every factual claim, statistic, quote, or data point MUST have an inline citation immediately after it
- Use format: "Statement with fact [1]." or "Multiple claims [1][2]."  
- Number citations sequentially: [1], [2], [3], etc.
- Use ONLY the provided Evidence list as sources
- Include citations throughout ALL content: executive_summary, sections, and key_findings
- Never make unsupported claims - if no evidence exists, don't include the claim

EXAMPLE:
"Decentralized governance models show 35% improved accountability [1]. ETHOS framework reduces compliance costs by €2.3M annually [2][3]. Recent studies indicate widespread adoption across 12 major protocols [4]."

Return a JSON object with:
{
  "query": string,
  "executive_summary": string, // MUST include inline citations [1][2][3] throughout
  "key_findings": [{ "claim": string, "citations": Citation[], "confidence": "high|medium|low" }], // claim MUST include [X] citations
  "sections": [{ "heading": string, "content": string, "citations": Citation[] }], // content MUST include [X] citations throughout
  "limitations": string[]
}
Where Citation has: { "url": string, "title": string, "snippet": string, "published_at": string }

User question: ${q}
`; 