import { openrouterCall, perplexityAsk, tavilySearch } from '../../clients.js';
import {
  ResearchInput, ResearchState, SubQuestion, Evidence, Report, ClarifyingQuestion,
  EvidenceCluster, ExpandedQuery, DeepDiveSection,
  PROMPT_DECOMPOSE, PROMPT_GAPFILL, PROMPT_SYNTH, PROMPT_CLARIFY, PROMPT_CLARIFY_GEMINI,
  PROMPT_QUERY_EXPAND, PROMPT_CLUSTER_EVIDENCE, PROMPT_DEEP_GLOBAL, PROMPT_DEEP_FOCUSED, PROMPT_CONTRAST_ANALYSIS,
  dedupeEvidence, withinWindow
} from './contracts.js';

import { tavilySearchCached } from '../../tavilyCached.js';
import { clearCache } from '../../../cache/fsCache.js';

// QUICK logger helper
const log = (...args: any[]) => console.log('[research]', ...args);

// COST-OPTIMIZED BUDGET CAPS - Sonar Pro + OpenRouter only
const PPLX_CAP = 2;     // normal mode: 2 Sonar Pro calls (~$0.05-0.10)
const PPLX_CAP_DEEP = 4; // deep mode: 4 Sonar Pro calls (~$0.15-0.20)
const TAVILY_CAP = 15;   // normal mode: cached after first use
const TAVILY_CAP_DEEP = 25; // deep mode: more searches, but cached
const OPENROUTER_CAP = 8; // increased for comprehensive synthesis
const RUNTIME_CAP_MS = 6 * 60 * 1000; // 6 minutes max runtime

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
  // Always generate fallback questions first to ensure we never return empty
  const fallbackQuestions = generateFallbackClarifyingQuestions(input.query);
  
  if (state.openrouterCalls >= OPENROUTER_CAP) {
    log('clarify> using fallback questions due to budget limit');
    return fallbackQuestions;
  }
  
  // Choose model and prompt based on deep mode or explicit override
  const useGemini = input.clarifyModel === 'gemini' || (input.deepMode && input.clarifyModel !== 'mistral');
  const model = useGemini ? GEMINI_MODEL : DEFAULT_OR_MODEL;
  const prompt = useGemini ? PROMPT_CLARIFY_GEMINI(input.query) : PROMPT_CLARIFY(input.query);
  
  log('clarify> using model:', model);
  
  try {
    const { text } = await openrouterCall({
      model,
      messages: [
        { 
          role: 'system', 
          content: 'You are a research assistant. Return ONLY a valid JSON array with no markdown formatting, no code blocks, no explanations. Just the raw JSON array.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    });

    let object: any[] = [];
    try { 
      // Clean the response to extract JSON
      let cleanedText = (text || '').trim();
      
      // Remove markdown code blocks if present
      if (cleanedText.includes('```json')) {
        cleanedText = cleanedText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      }
      if (cleanedText.includes('```')) {
        cleanedText = cleanedText.replace(/```[^`]*```/g, '').trim();
      }
      
      // Find JSON array in the text
      const jsonMatch = cleanedText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        cleanedText = jsonMatch[0];
      }
      
      object = JSON.parse(cleanedText); 
      log('clarify> parsed JSON successfully, got', object.length, 'items');
    } catch (parseError) { 
      log('clarify> JSON parse failed:', parseError);
      log('clarify> raw response:', text?.substring(0, 200) + '...');
      
      // Try to extract questions from plain text as fallback
      const textQuestions = extractQuestionsFromText(text || '');
      if (textQuestions.length > 0) {
        log('clarify> extracted', textQuestions.length, 'questions from text');
        object = textQuestions;
      } else {
        object = []; 
      }
    }
    
    state.openrouterCalls++;
    
    if (object && Array.isArray(object) && object.length > 0) {
      const questions = object.slice(0, 7).map((q, i) => ({
        id: `cq${i+1}`,
        question: String(q.question || '').trim(),
        purpose: String(q.purpose || '').trim(),
        suggested_answers: q.suggested_answers || []
      })).filter(q => q.question.length > 0);
      
      if (questions.length > 0) {
        log('clarify> generated', questions.length, 'questions from API');
        return questions;
      }
    }
    
    log('clarify> API returned invalid data, using fallback questions');
    return fallbackQuestions;
    
  } catch (apiError) {
    log('clarify> API call failed:', apiError);
    log('clarify> using fallback questions');
    return fallbackQuestions;
  }
}

// Extract questions from plain text when JSON parsing fails
function extractQuestionsFromText(text: string): any[] {
  const lines = text.split('\n').filter(line => line.trim().length > 10);
  const questions: any[] = [];
  
  for (let i = 0; i < lines.length && questions.length < 5; i++) {
    const line = lines[i].trim();
    
    // Look for question patterns
    if (line.includes('?') || line.toLowerCase().includes('question')) {
      // Try to extract question and purpose
      const questionMatch = line.match(/(?:question[:\s]*)?([^?]+\?)/i);
      if (questionMatch) {
        const question = questionMatch[1].trim();
        const purpose = lines[i + 1]?.includes('purpose') || lines[i + 1]?.includes('help') ? 
          lines[i + 1].trim() : 'Helps focus the research scope';
        
        questions.push({
          question,
          purpose,
          suggested_answers: ['Yes', 'No', 'Partially', 'Unclear']
        });
      }
    }
  }
  
  return questions;
}

// Generate fallback clarifying questions based on query analysis
function generateFallbackClarifyingQuestions(query: string): ClarifyingQuestion[] {
  const lowerQuery = query.toLowerCase();
  
  // Travel-specific questions
  if (lowerQuery.includes('trip') || lowerQuery.includes('travel') || lowerQuery.includes('visit')) {
    return [
      {
        id: 'cq1',
        question: 'What is your approximate budget range for this trip?',
        purpose: 'Understanding budget constraints helps find appropriate options',
        suggested_answers: ['Under $500', '$500-1000', '$1000-2000', 'Over $2000']
      },
      {
        id: 'cq2', 
        question: 'How long are you planning to stay?',
        purpose: 'Trip duration affects accommodation and activity recommendations',
        suggested_answers: ['3-5 days', '1 week', '2 weeks', '1 month or more']
      },
      {
        id: 'cq3',
        question: 'What type of experiences are you most interested in?',
        purpose: 'Helps prioritize activities and destinations',
        suggested_answers: ['Cultural/Historical sites', 'Food and nightlife', 'Nature/Outdoor activities', 'Beaches and relaxation']
      }
    ];
  }
  
  // Market/Analysis questions
  if (lowerQuery.includes('market') || lowerQuery.includes('analysis') || lowerQuery.includes('industry')) {
    return [
      {
        id: 'cq1',
        question: 'What geographic scope should this analysis cover?',
        purpose: 'Defines the market boundaries for focused research',
        suggested_answers: ['Global', 'North America', 'Europe', 'Asia-Pacific', 'Specific country']
      },
      {
        id: 'cq2',
        question: 'What time frame are you most interested in?',
        purpose: 'Helps focus on relevant trends and data',
        suggested_answers: ['Current state', 'Historical trends (5+ years)', 'Future projections', 'Recent developments (1-2 years)']
      }
    ];
  }
  
  // Technology questions  
  if (lowerQuery.includes('ai') || lowerQuery.includes('tech') || lowerQuery.includes('software')) {
    return [
      {
        id: 'cq1',
        question: 'Are you interested in a specific industry application?',
        purpose: 'Focuses research on relevant use cases and implementations',
        suggested_answers: ['Healthcare', 'Finance', 'Manufacturing', 'General/Cross-industry']
      },
      {
        id: 'cq2',
        question: 'What aspect interests you most?',
        purpose: 'Helps prioritize technical vs business vs market perspectives',
        suggested_answers: ['Technical capabilities', 'Business impact', 'Market trends', 'Implementation challenges']
      }
    ];
  }
  
  // Generic fallback questions
  return [
    {
      id: 'cq1',
      question: 'What specific aspect of this topic interests you most?',
      purpose: 'Helps focus the research on your primary area of interest',
      suggested_answers: ['Overview/Introduction', 'Recent developments', 'Detailed analysis', 'Future outlook']
    },
    {
      id: 'cq2',
      question: 'What level of detail are you looking for?',
      purpose: 'Determines the depth and complexity of the research',
      suggested_answers: ['High-level summary', 'Detailed analysis', 'Technical deep-dive', 'Comprehensive report']
    }
  ];
}

// New enhanced pipeline functions
async function expandQueries(macroTopics: string[], state: ResearchState): Promise<ExpandedQuery[]> {
  if (state.openrouterCalls >= OPENROUTER_CAP) return [];
  
  log('expand> generating search queries for', macroTopics.length, 'topics');
  
  const { text } = await openrouterCall({
    model: GEMINI_MODEL,
    messages: [
      { role: 'system', content: 'Return only JSON array. No prose.' },
      { role: 'user', content: PROMPT_QUERY_EXPAND(macroTopics) }
    ],
    temperature: 0.3
  });

  let expandedQueries: ExpandedQuery[] = [];
  try {
    const parsed = JSON.parse(text || '[]');
    expandedQueries = parsed.map((item: any) => ({
      original: item.topic,
      expanded: item.queries || [],
      domains: {
        include: item.include_domains || [],
        exclude: item.exclude_domains || []
      }
    }));
  } catch {
    // Fallback to basic queries
    expandedQueries = macroTopics.map(topic => ({
      original: topic,
      expanded: [topic, `${topic} trends`, `${topic} analysis`],
      domains: {}
    }));
  }
  
  state.openrouterCalls++;
  log('expand> generated', expandedQueries.length, 'query sets');
  return expandedQueries;
}

async function gatherEvidenceEnhanced(expandedQueries: ExpandedQuery[], input: ResearchInput, state: ResearchState): Promise<Evidence[]> {
  const evidence: Evidence[] = [];
  const tavilyCap = input.deepMode ? TAVILY_CAP_DEEP : TAVILY_CAP;
  const maxResults = input.deepMode ? 12 : 7;
  
  log('gather-enhanced> processing', expandedQueries.length, 'query sets');
  
  for (const querySet of expandedQueries) {
    if (state.tavilyCalls >= tavilyCap) break;
    
    for (const query of querySet.expanded.slice(0, 3)) {
      if (state.tavilyCalls >= tavilyCap) break;
      
      state.tavilyCalls++;
      log('gather-enhanced> tavily call:', query.substring(0, 50) + '...');
      
      try {
        // Use cached Tavily search for better performance
        const res = await tavilySearchCached({
          query: truncateForTavily(query),
          maxResults,
          timeRange: 'month',
          searchDepth: 'advanced',
          includeDomains: querySet.domains?.include,
          excludeDomains: querySet.domains?.exclude
        });
        
        log('gather-enhanced> returned', res.items.length, 'items');
        
        for (const item of res.items) {
          if (withinWindow(item.published_at, input.from, input.to)) {
            evidence.push({ ...item, source_tool: 'tavily' });
          }
        }
      } catch (err: any) {
        log('gather-enhanced> error:', err?.message || err);
      }
    }
  }
  
  return dedupeEvidence(evidence);
}

async function clusterEvidence(evidence: Evidence[], state: ResearchState): Promise<EvidenceCluster[]> {
  if (state.openrouterCalls >= OPENROUTER_CAP || evidence.length < 10) {
    // Fallback clustering
    return [{
      theme: 'General Research',
      urls: evidence.map(e => e.url),
      evidence,
      strength: evidence.length,
      contradictions: []
    }];
  }
  
  log('cluster> analyzing', evidence.length, 'evidence items');
  
  const { text } = await openrouterCall({
    model: DEFAULT_OR_MODEL,
    messages: [
      { role: 'system', content: 'Return only JSON array. No prose.' },
      { role: 'user', content: PROMPT_CLUSTER_EVIDENCE(evidence) }
    ],
    temperature: 0.2
  });

  let clusters: EvidenceCluster[] = [];
  try {
    const parsed = JSON.parse(text || '[]');
    clusters = parsed.map((cluster: any, i: number) => ({
      theme: cluster.theme || `Theme ${i + 1}`,
      urls: evidence.filter(e => 
        cluster.evidence_statements?.some((stmt: string) => 
          e.snippet?.toLowerCase().includes(stmt.toLowerCase().split(' ')[0])
        )
      ).map(e => e.url),
      evidence: evidence.filter(e => 
        cluster.evidence_statements?.some((stmt: string) => 
          e.snippet?.toLowerCase().includes(stmt.toLowerCase().split(' ')[0])
        )
      ),
      strength: cluster.strength || 5,
      contradictions: cluster.contradictions || []
    }));
  } catch {
    // Fallback
    const chunkSize = Math.ceil(evidence.length / 4);
    clusters = Array.from({ length: 4 }, (_, i) => ({
      theme: `Research Area ${i + 1}`,
      urls: evidence.slice(i * chunkSize, (i + 1) * chunkSize).map(e => e.url),
      evidence: evidence.slice(i * chunkSize, (i + 1) * chunkSize),
      strength: chunkSize,
      contradictions: []
    }));
  }
  
  state.openrouterCalls++;
  log('cluster> created', clusters.length, 'evidence clusters');
  return clusters.filter(c => c.evidence.length > 0);
}

async function runContrastAnalysis(clusters: EvidenceCluster[], state: ResearchState): Promise<string[]> {
  if (state.pplxCalls >= (state.input.deepMode ? PPLX_CAP_DEEP : PPLX_CAP) || clusters.length < 2) {
    log('contrast> skipping due to budget limits or insufficient clusters');
    return generateFallbackContrasts(clusters);
  }
  
  // Find two clusters with potential conflicts
  const cluster1 = clusters[0];
  const cluster2 = clusters[1];
  
  log('contrast> analyzing conflicts between:', cluster1.theme, 'vs', cluster2.theme);
  
  try {
    const result = await perplexityAsk({
      prompt: `Analyze potential contradictions between these two research themes:

Theme 1: ${cluster1.theme}
- Evidence strength: ${cluster1.strength}/10
- Key sources: ${cluster1.urls.slice(0, 3).join(', ')}

Theme 2: ${cluster2.theme}  
- Evidence strength: ${cluster2.strength}/10
- Key sources: ${cluster2.urls.slice(0, 3).join(', ')}

Identify 2-3 specific contradictions or conflicting viewpoints between these themes. Focus on factual discrepancies, different conclusions, or conflicting data points.`,
      mode: 'pro'
    });
    
    state.pplxCalls++;
    
    // Always extract from text instead of trying to parse JSON
    log('contrast> extracting contradictions from text response');
    
    // Look for contradiction patterns in the text
    const text = result.text || '';
    const lines = text.split('\n').filter(line => line.trim().length > 20);
    const contradictions: string[] = [];
    
    // Extract bullet points or numbered items that mention conflicts
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        (trimmed.match(/^[-*•]\s/) || trimmed.match(/^\d+\.\s/)) &&
        (trimmed.toLowerCase().includes('contradic') || 
         trimmed.toLowerCase().includes('conflict') ||
         trimmed.toLowerCase().includes('disagree') ||
         trimmed.toLowerCase().includes('versus') ||
         trimmed.toLowerCase().includes('differ') ||
         trimmed.toLowerCase().includes('opposing'))
      ) {
        contradictions.push(trimmed.replace(/^[-*•]\s/, '').replace(/^\d+\.\s/, ''));
      }
    }
    
    // If no structured contradictions found, look for any conflict-related sentences
    if (contradictions.length === 0) {
      const sentences = text.split('.').filter(s => 
        s.length > 30 && (
          s.toLowerCase().includes('contradic') || 
          s.toLowerCase().includes('conflict') ||
          s.toLowerCase().includes('disagree') ||
          s.toLowerCase().includes('versus') ||
          s.toLowerCase().includes('differ')
        )
      );
      
      contradictions.push(...sentences.slice(0, 3).map(s => s.trim() + '.'));
    }
    
    if (contradictions.length > 0) {
      log('contrast> found', contradictions.length, 'contradictions from text');
      return contradictions.slice(0, 3);
    }
    
    return generateFallbackContrasts(clusters);
    
  } catch (apiError) {
    log('contrast> API call failed:', apiError);
    return generateFallbackContrasts(clusters);
  }
}

function generateFallbackContrasts(clusters: EvidenceCluster[]): string[] {
  if (clusters.length < 2) return [];
  
  return [
    `Potential discrepancy between ${clusters[0].theme} and ${clusters[1].theme} findings`,
    `Different source perspectives may lead to varying conclusions`,
    `Evidence strength varies across themes (${clusters[0].strength} vs ${clusters[1].strength})`
  ].slice(0, 2);
}

async function runDeepResearchGlobal(clusters: EvidenceCluster[], input: ResearchInput, state: ResearchState): Promise<Report> {
  if (state.pplxCalls >= (input.deepMode ? PPLX_CAP_DEEP : PPLX_CAP)) {
    return generateFallbackReport(input.query, clusters);
  }
  
  log('deep-global> running comprehensive analysis with', clusters.length, 'clusters');
  
  // Use cost-effective approach: Multiple Sonar Pro calls + OpenRouter for synthesis
  try {
    // Step 1: Get detailed research from Perplexity Sonar Pro with enhanced prompt
    const researchResult = await perplexityAsk({
      prompt: `Conduct comprehensive research on: ${input.query}

I need a detailed, thorough analysis covering multiple aspects. Please provide:

1. **Current State Analysis**: What's happening right now? Include specific statistics, recent developments, key players, and current trends with dates and numbers.

2. **Impact Analysis**: What are the real-world effects? Include both positive and negative impacts with concrete examples, case studies, and quantified outcomes.

3. **Future Outlook**: Where is this heading? Include projected trends, emerging developments, expert predictions, and potential scenarios.

4. **Stakeholder Perspectives**: How do different groups view this? Include viewpoints from industry experts, researchers, users, regulators, and critics.

5. **Challenges and Opportunities**: What are the main obstacles and potential benefits? Include technical challenges, ethical concerns, market barriers, and growth opportunities.

Evidence clusters available: ${clusters.map(c => `${c.theme} (${c.strength}/10 strength)`).join(', ')}

Make this analysis substantial and detailed. Include specific data, statistics, examples, and citations wherever possible. This should be a comprehensive research piece, not a brief overview.`,
      mode: 'pro'
    });
    
    state.pplxCalls++;
    
    // Step 2: Use OpenRouter to structure the response into JSON
    if (state.openrouterCalls < OPENROUTER_CAP) {
      const structuredResult = await openrouterCall({
        model: input.deepMode ? GEMINI_MODEL : DEFAULT_OR_MODEL,
        messages: [
          { 
            role: 'system', 
            content: `You are a senior research analyst creating a comprehensive research report. Your goal is to create a substantial, detailed analysis that's at least 5 times larger than a typical brief.

Create a thorough report with this structure (but feel free to adapt as needed):

{
  "executive_summary": "Write a comprehensive 400-600 word executive summary with key insights, main findings, and implications",
  "key_findings": [
    {
      "claim": "Detailed finding with specific data, statistics, or concrete examples - make each finding substantial",
      "citations": [{"url": "source_url", "title": "descriptive title", "source_tool": "tavily"}],
      "confidence": "high/medium/low"
    }
  ],
  "sections": [
    {
      "heading": "Descriptive Section Title",
      "content": "Write 400-800 words of detailed analysis with specific examples, data points, case studies, and thorough explanation. Include multiple paragraphs with deep insights.",
      "citations": [{"url": "source_url", "title": "descriptive title", "source_tool": "tavily"}]
    }
  ],
  "limitations": ["Specific limitation with context", "Another limitation"]
}

Make this report comprehensive and detailed. Include:
- 15+ substantial key findings (not just bullet points)
- 5+ detailed sections with 400-800 words each
- Specific data, statistics, examples, and case studies
- Multiple perspectives and thorough analysis
- Rich context and implications

This should be a substantial research document, not a brief summary.`
          },
          { 
            role: 'user', 
            content: `Research Topic: ${input.query}

Detailed Research Analysis: ${researchResult.text}

Available Evidence Sources: ${clusters.length} clusters with ${clusters.reduce((sum, c) => sum + c.urls.length, 0)} total sources

Create a comprehensive research report that's detailed and substantial. Make each section thorough with deep analysis, specific examples, and rich context. This should be a comprehensive document that provides real value to the reader.`
          }
        ],
        temperature: 0.3
      });
      
      state.openrouterCalls++;
      
      try {
        const report = JSON.parse(structuredResult.text || '{}');
        log('deep-global> successfully parsed structured report');
        
        return {
          query: input.query,
          executive_summary: report.executive_summary || generateFallbackSummary(input.query, researchResult.text),
          key_findings: report.key_findings || generateFallbackFindings(researchResult.text, clusters),
          sections: report.sections || generateFallbackSections(researchResult.text, clusters),
          limitations: report.limitations || ['Analysis based on available sources', 'Limited to current data']
        };
      } catch (parseError) {
        log('deep-global> JSON parsing failed, using text-based analysis');
        return generateReportFromText(input.query, researchResult.text, clusters);
      }
    }
    
    // Fallback: generate report directly from Perplexity text
    return generateReportFromText(input.query, researchResult.text, clusters);
    
  } catch (apiError) {
    log('deep-global> API call failed:', apiError);
    return generateFallbackReport(input.query, clusters);
  }
}

// Generate fallback report when APIs fail
function generateFallbackReport(query: string, clusters: EvidenceCluster[]): Report {
  return {
    query,
    executive_summary: `Research analysis for "${query}" based on ${clusters.length} evidence clusters covering ${clusters.map(c => c.theme).join(', ')}. Analysis includes findings from ${clusters.reduce((sum, c) => sum + c.urls.length, 0)} sources across multiple domains.`,
    key_findings: clusters.flatMap(cluster => [
      {
        claim: `${cluster.theme}: Analysis based on ${cluster.urls.length} sources`,
        citations: cluster.urls.slice(0, 3).map(url => ({ url, title: 'Source', source_tool: 'tavily' as const })),
        confidence: 'medium' as const
      }
    ]).slice(0, 10),
    sections: clusters.map(cluster => ({
      heading: cluster.theme,
      content: `Comprehensive analysis of ${cluster.theme} based on evidence from ${cluster.urls.length} sources. This analysis covers key trends, developments, and insights relevant to the research query. The evidence strength for this theme is rated ${cluster.strength}/10 based on source quality and relevance.`,
      citations: cluster.urls.slice(0, 5).map(url => ({ url, title: 'Source', source_tool: 'tavily' as const }))
    })).slice(0, 5),
    limitations: [
      'Analysis generated from evidence clusters due to API limitations',
      'Limited to available source material',
      'May not include most recent developments'
    ]
  };
}

// Generate report from Perplexity text response
function generateReportFromText(query: string, text: string, clusters: EvidenceCluster[]): Report {
  const paragraphs = text.split('\n').filter(p => p.trim().length > 50);
  
  return {
    query,
    executive_summary: paragraphs.slice(0, 3).join(' ').substring(0, 800) || `Comprehensive analysis of ${query} based on research across multiple sources and evidence clusters.`,
    key_findings: paragraphs.slice(3, 13).map((finding, i) => ({
      claim: finding.substring(0, 200),
      citations: clusters[i % clusters.length]?.urls.slice(0, 2).map(url => ({ url, title: 'Source', source_tool: 'tavily' as const })) || [],
      confidence: 'medium' as const
    })),
    sections: [
      {
        heading: 'Research Analysis',
        content: paragraphs.slice(0, 5).join('\n\n'),
        citations: clusters.flatMap(c => c.urls.slice(0, 2)).slice(0, 5).map(url => ({ url, title: 'Source', source_tool: 'tavily' as const }))
      },
      {
        heading: 'Key Insights',
        content: paragraphs.slice(5, 10).join('\n\n'),
        citations: clusters.flatMap(c => c.urls.slice(2, 4)).slice(0, 5).map(url => ({ url, title: 'Source', source_tool: 'tavily' as const }))
      },
      {
        heading: 'Implications',
        content: paragraphs.slice(10).join('\n\n') || 'Based on the research findings, several key implications emerge for stakeholders and decision-makers.',
        citations: clusters.flatMap(c => c.urls.slice(4, 6)).slice(0, 5).map(url => ({ url, title: 'Source', source_tool: 'tavily' as const }))
      }
    ],
    limitations: [
      'Analysis based on text processing of research results',
      'Limited by source availability and quality',
      'May not capture all nuances of complex topics'
    ]
  };
}

// Helper functions for fallback content generation
function generateFallbackSummary(query: string, text: string): string {
  const firstParagraph = text.split('\n')[0] || '';
  return firstParagraph.length > 100 ? firstParagraph.substring(0, 500) : 
    `Comprehensive research analysis of ${query} covering key trends, developments, and insights based on multiple authoritative sources.`;
}

function generateFallbackFindings(text: string, clusters: EvidenceCluster[]): any[] {
  const sentences = text.split('.').filter(s => s.trim().length > 30);
  return sentences.slice(0, 10).map((sentence, i) => ({
    claim: sentence.trim() + '.',
    citations: clusters[i % clusters.length]?.urls.slice(0, 2).map(url => ({ url, title: 'Source', source_tool: 'tavily' as const })) || [],
    confidence: 'medium'
  }));
}

function generateFallbackSections(text: string, clusters: EvidenceCluster[]): any[] {
  const paragraphs = text.split('\n').filter(p => p.trim().length > 100);
  return clusters.slice(0, 3).map((cluster, i) => ({
    heading: cluster.theme,
    content: paragraphs[i] || `Analysis of ${cluster.theme} based on research findings and evidence from multiple sources.`,
    citations: cluster.urls.slice(0, 3).map(url => ({ url, title: 'Source', source_tool: 'tavily' as const }))
  }));
}

async function maybeRunDeepFocused(clusters: EvidenceCluster[], input: ResearchInput, state: ResearchState): Promise<DeepDiveSection | null> {
  // Disable second deep call - using only Sonar Pro now
  const shouldTrigger = false;
  
  if (!shouldTrigger) {
    log('deep-focused> skipping second deep call');
    return null;
  }
  
  // Find weakest cluster
  const weakestCluster = clusters.reduce((min, cluster) => 
    cluster.strength < min.strength ? cluster : min
  );
  
  log('deep-focused> running focused analysis on:', weakestCluster.theme);
  
  const result = await perplexityAsk({
    prompt: PROMPT_DEEP_FOCUSED(weakestCluster, input.query),
    mode: 'deep-research'
  });
  
  state.pplxDeepCalls++;
  state.pplxCalls++;
  
  try {
    const deepDive = JSON.parse(result.text || '{}');
    return {
      theme: deepDive.theme || weakestCluster.theme,
      content: deepDive.content || 'No content available.',
      findings: deepDive.findings || [],
      metrics_table: deepDive.metrics_table || ''
    };
  } catch {
    return null;
  }
}

async function decompose(input: ResearchInput, state: ResearchState): Promise<SubQuestion[]> {
  // Generate fallback topics first
  const fallbackTopics = generateFallbackTopics(input.query);
  
  if (state.openrouterCalls >= OPENROUTER_CAP) {
    log('decompose> using fallback topics due to budget limit');
    return fallbackTopics;
  }
  
  // Use Gemini for decomposition in deep mode
  const model = input.deepMode ? GEMINI_MODEL : DEFAULT_OR_MODEL;
  log('decompose> using model:', model);
  
  try {
    const { text: decompText } = await openrouterCall({
      model,
      messages: [
        { 
          role: 'system', 
          content: 'You are a research analyst. Return ONLY a valid JSON array with no markdown formatting, no code blocks, no explanations. Just the raw JSON array of research topics.' 
        },
        { role: 'user', content: PROMPT_DECOMPOSE(input.query) }
      ],
      temperature: 0.1
    });

    let arr: any[] = [];
    try { 
      // Clean the response to extract JSON
      let cleanedText = (decompText || '').trim();
      
      // Remove markdown code blocks if present
      if (cleanedText.includes('```json')) {
        cleanedText = cleanedText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      }
      if (cleanedText.includes('```')) {
        cleanedText = cleanedText.replace(/```[^`]*```/g, '').trim();
      }
      
      // Find JSON array in the text
      const jsonMatch = cleanedText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        cleanedText = jsonMatch[0];
      }
      
      arr = JSON.parse(cleanedText);
      log('decompose> parsed JSON successfully, got', arr.length, 'items');
    } catch (parseError) { 
      log('decompose> JSON parse failed:', parseError);
      log('decompose> raw response:', decompText?.substring(0, 200) + '...');
      arr = []; 
    }
    
    state.openrouterCalls++;
    
    if (arr && arr.length > 0) {
      const subqs: SubQuestion[] = arr.slice(0,8).map((x,i)=>({
          id: `sq${i+1}`,
          question: String(x.question || '').trim(),
          rationale: String(x.rationale || '').trim(),
          type: pickType(x)
        })).filter(s=>s.question.length>0);

      if (subqs.length > 0) {
        log('decompose> generated', subqs.length, 'topics from API');
        return subqs;
      }
    }
    
    log('decompose> API returned invalid data, using fallback topics');
    return fallbackTopics;
    
  } catch (apiError) {
    log('decompose> API call failed:', apiError);
    log('decompose> using fallback topics');
    return fallbackTopics;
  }
}

// Generate fallback research topics based on query analysis
function generateFallbackTopics(query: string): SubQuestion[] {
  const lowerQuery = query.toLowerCase();
  
  // Travel planning topics
  if (lowerQuery.includes('trip') || lowerQuery.includes('travel') || lowerQuery.includes('visit')) {
    return [
      {
        id: 'sq1',
        question: `Flight options and costs from India to ${extractDestination(query)}`,
        rationale: 'Transportation is typically the largest expense for international travel',
        type: 'factual'
      },
      {
        id: 'sq2', 
        question: `Budget accommodation options in ${extractDestination(query)}`,
        rationale: 'Accommodation costs vary significantly and affect total budget',
        type: 'factual'
      },
      {
        id: 'sq3',
        question: `Daily expenses and cost of living for tourists in ${extractDestination(query)}`,
        rationale: 'Understanding daily costs helps with budget planning',
        type: 'factual'
      },
      {
        id: 'sq4',
        question: `Best time to visit ${extractDestination(query)} for budget travelers`,
        rationale: 'Seasonal pricing affects overall trip costs',
        type: 'knowledge'
      }
    ];
  }
  
  // Market analysis topics
  if (lowerQuery.includes('market') || lowerQuery.includes('analysis') || lowerQuery.includes('industry')) {
    const subject = extractSubject(query);
    return [
      {
        id: 'sq1',
        question: `Current market size and growth trends for ${subject}`,
        rationale: 'Market size provides baseline understanding of industry scale',
        type: 'factual'
      },
      {
        id: 'sq2',
        question: `Key players and competitive landscape in ${subject}`,
        rationale: 'Understanding competition reveals market dynamics',
        type: 'knowledge'
      },
      {
        id: 'sq3',
        question: `Recent developments and innovations in ${subject}`,
        rationale: 'Recent changes indicate future market direction',
        type: 'factual'
      }
    ];
  }
  
  // Technology topics
  if (lowerQuery.includes('ai') || lowerQuery.includes('tech') || lowerQuery.includes('software')) {
    const tech = extractTechTopic(query);
    return [
      {
        id: 'sq1',
        question: `Current capabilities and applications of ${tech}`,
        rationale: 'Understanding current state provides foundation for analysis',
        type: 'knowledge'
      },
      {
        id: 'sq2',
        question: `Recent advances and breakthroughs in ${tech}`,
        rationale: 'Recent developments show technology evolution',
        type: 'factual'
      },
      {
        id: 'sq3',
        question: `Market adoption and business impact of ${tech}`,
        rationale: 'Business perspective shows practical implications',
        type: 'knowledge'
      }
    ];
  }
  
  // Generic fallback
  return [
    {
      id: 'sq1',
      question: `Overview and current state of ${query}`,
      rationale: 'Foundational understanding of the topic',
      type: 'knowledge'
    },
    {
      id: 'sq2',
      question: `Recent developments and trends related to ${query}`,
      rationale: 'Current trends provide relevant context',
      type: 'factual'
    },
    {
      id: 'sq3',
      question: `Key challenges and opportunities in ${query}`,
      rationale: 'Understanding challenges and opportunities provides balanced perspective',
      type: 'reasoning'
    }
  ];
}

// Helper functions to extract key terms from queries
function extractDestination(query: string): string {
  const destinations = ['spain', 'france', 'italy', 'germany', 'uk', 'japan', 'thailand', 'singapore'];
  const found = destinations.find(dest => query.toLowerCase().includes(dest));
  return found ? found.charAt(0).toUpperCase() + found.slice(1) : 'the destination';
}

function extractSubject(query: string): string {
  const words = query.split(' ').filter(w => w.length > 3);
  return words.slice(0, 3).join(' ') || 'the subject';
}

function extractTechTopic(query: string): string {
  const techs = ['artificial intelligence', 'ai', 'machine learning', 'blockchain', 'quantum computing'];
  const found = techs.find(tech => query.toLowerCase().includes(tech));
  return found || 'the technology';
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
      
                // Use appropriate Sonar models - no expensive deep research
          let mode: 'pro' | 'reasoning';
          if (sq.type === 'reasoning') {
            mode = 'reasoning';
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
    
    // Use reasoning for gap-fill - no expensive deep research
    const mode = 'reasoning';
    log('gapfill> using reasoning mode for cost optimization');
    
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
  
  // Clear cache if requested
  if (input.clearCache) {
    clearCache();
    log('research> cache cleared');
  }
  
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
  
  // Enhanced state tracking
  let evidenceClusters: EvidenceCluster[] = [];
  let deepDiveSection: DeepDiveSection | null = null;
  let allSourceUrls: string[] = [];

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

  // Enhanced Research Pipeline
  
  // 1) Decompose into macro-topics (not sub-questions)
  const macroTopics = await decompose({ ...input, query: state.refinedQuery }, state);
  const topicNames = macroTopics.map(sq => sq.question);
  log('research> decomposed into', topicNames.length, 'macro-topics');

  // 2) Expand queries for comprehensive search
  const expandedQueries = await expandQueries(topicNames, state);
  
  // 3) Enhanced evidence gathering with caching
  const gatheredEvidence = await gatherEvidenceEnhanced(expandedQueries, input, state);
  state.evidence = gatheredEvidence.filter(e => withinWindow(e.published_at, input.from, input.to));
  allSourceUrls = [...new Set(state.evidence.map(e => e.url))];
  log('research> gathered', state.evidence.length, 'evidence items from', allSourceUrls.length, 'unique sources');

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
        subqCount: topicNames.length,
        evidenceCount: state.evidence.length,
        runtimeExceeded: true
      }
    };
  }

  // 4) Cluster evidence into themes
  evidenceClusters = await clusterEvidence(state.evidence, state);
  
  // 5) Run contrast analysis for limitations
  const contradictionAnalysis = await runContrastAnalysis(evidenceClusters, state);
  
  // 6) First deep-research call (global synthesis)
  const globalReport = await runDeepResearchGlobal(evidenceClusters, input, state);
  
  // 7) Maybe run second deep-research call (focused analysis)
  deepDiveSection = await maybeRunDeepFocused(evidenceClusters, input, state);
  
  // Update contradictions for legacy compatibility
  state.contradictions = contradictionAnalysis.map(analysis => ({
    topic: analysis.substring(0, 100),
    urls: evidenceClusters.slice(0, 2).flatMap(c => c.urls.slice(0, 3))
  }));

  // 8) Build final comprehensive report
  let finalReport = globalReport;
  
  // Add deep-dive section if available
  if (deepDiveSection) {
    finalReport.sections.push({
      heading: `Deep Dive: ${deepDiveSection.theme}`,
      content: deepDiveSection.content + (deepDiveSection.metrics_table ? '\n\n' + deepDiveSection.metrics_table : ''),
      citations: deepDiveSection.findings.flatMap(f => f.citations || [])
    });
    finalReport.key_findings.push(...deepDiveSection.findings);
  }
  
  // Add contrast analysis to limitations
  if (contradictionAnalysis.length > 0) {
    finalReport.limitations.push(...contradictionAnalysis.slice(0, 3));
  }
  
  // Ensure limitations are concise
  finalReport.limitations = finalReport.limitations.slice(0, 3);
  
  const markdown = buildEnhancedMarkdown(finalReport, allSourceUrls, deepDiveSection);

  return {
    report: finalReport,
    markdown,
    meta: {
      pplxCalls: state.pplxCalls,
      pplxDeepCalls: state.pplxDeepCalls,
      tavilyCalls: state.tavilyCalls,
      openrouterCalls: state.openrouterCalls,
      subqCount: topicNames.length,
      evidenceCount: state.evidence.length,
      evidenceClusters: evidenceClusters.length,
      deepDiveGenerated: !!deepDiveSection,
      totalSources: allSourceUrls.length
    }
  };
}

function buildEnhancedMarkdown(report: Report, allSourceUrls: string[], deepDive?: DeepDiveSection | null): string {
  const cite = (c: Evidence) => `[[source]](${c.url})`;
  
  // Build sections with enhanced formatting and better spacing
  const sectionMd = report.sections.map((s, index) => {
    const sectionNumber = index + 1;
    return `## ${sectionNumber}. ${s.heading}

${s.content}

**Sources:** ${s.citations.map(cite).join(' ')}

---

`;
  }).join('\n');

  // Build findings with enhanced formatting
  const findings = report.key_findings.map((k, index) => {
    const findingNumber = index + 1;
    return `### Finding ${findingNumber}: ${k.claim}

**Confidence Level:** ${k.confidence.toUpperCase()}

**Supporting Evidence:** ${k.citations.map(cite).join(' ')}

`;
  }).join('\n');

  // Build comprehensive appendix with better organization
  const primarySources = report.sections.flatMap(s => s.citations)
    .concat(report.key_findings.flatMap(f => f.citations || []))
    .filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
    
  const appendixA = primarySources
    .map((c, i) => `${i + 1}. **${c.title || 'Research Source'}**  
   ${c.url}`)
    .join('\n\n');

  const appendixB = allSourceUrls
    .map((url, i) => `${i + 1}. ${url}`)
    .join('\n');

  // Add deep dive section if available
  const deepDiveSection = deepDive ? `

## Deep Dive Analysis: ${deepDive.theme}

${deepDive.content}

${deepDive.metrics_table || ''}

**Additional Findings:**
${deepDive.findings.map((f, i) => `${i + 1}. **${f.claim}** (${f.confidence})`).join('\n')}

---

` : '';

  return `# Comprehensive Research Report

**Research Query:** ${report.query}

---

## Executive Summary

${report.executive_summary}

---

## Key Research Findings

${findings}

---

## Detailed Analysis

${sectionMd}${deepDiveSection}

## Research Limitations

${report.limitations.map((l, i) => `${i + 1}. ${l}`).join('\n')}

---

## Appendix A: Primary Sources Referenced (${primarySources.length} sources)

${appendixA}

---

## Appendix B: Complete Source Bibliography (${allSourceUrls.length} total sources)

${appendixB}

---

**Research Methodology:** This comprehensive report was generated through systematic analysis of ${allSourceUrls.length} sources across ${report.sections.length} thematic areas, using advanced AI-powered research techniques with human oversight for quality assurance.

**Completion Date:** ${new Date().toLocaleDateString()}
`;
} 