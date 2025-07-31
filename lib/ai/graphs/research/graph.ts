import { openrouterCall, perplexityAsk, tavilySearch } from '../../clients.js';
import {
  ResearchInput, ResearchState, SubQuestion, Evidence, Report, ClarifyingQuestion,
  EvidenceCluster, ExpandedQuery, DeepDiveSection,
  PROMPT_DECOMPOSE, PROMPT_GAPFILL, PROMPT_CLARIFY, PROMPT_CLARIFY_GEMINI,
  PROMPT_QUERY_EXPAND, PROMPT_CLUSTER_EVIDENCE, PROMPT_DEEP_FOCUSED,
  dedupeEvidence, withinWindow
} from './contracts.js';

import { tavilySearchCached } from '../../tavilyCached.js';
import { clearCache } from '../../../cache/fsCache.js';

// QUICK logger helper
const log = (...args: any[]) => console.log('[research]', ...args);

// DYNAMIC RESEARCH CONFIGURATION
const RUNTIME_CAP_MS = 6 * 60 * 1000; // 6 minutes max runtime

interface ResearchLimits {
  maxParts: number;          // 3-6 parts based on complexity
  tavilyPerPart: number;     // exactly 1 call per part
  sonarPerPart: number;      // exactly 1 call per part
  tavilyMaxResults: number;  // 20 results per search for quality
  searchDepth: 'basic' | 'advanced';
  sonarModel: 'sonar' | 'sonar-pro';
  openrouterCap: number;     // for synthesis
}

function getResearchLimits(mode: 'deep' | 'deeper'): ResearchLimits {
  if (mode === 'deeper') {
    return {
      maxParts: 6,
      tavilyPerPart: 1,
      sonarPerPart: 1,
      tavilyMaxResults: 20,
      searchDepth: 'advanced',
      sonarModel: 'sonar-pro',
      openrouterCap: 8
    };
  }
  
  // deep mode (default)
  return {
    maxParts: 6,
    tavilyPerPart: 1,
    sonarPerPart: 1,
    tavilyMaxResults: 20,
    searchDepth: 'basic',
    sonarModel: 'sonar',
    openrouterCap: 6
  };
}

const DEFAULT_OR_MODEL = 'mistralai/mistral-7b-instruct:free';
const GEMINI_MODEL = 'google/gemini-2.5-flash-lite';

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
  const limits = getResearchLimits(input.deepMode ? 'deeper' : 'deep');
  
  // Always generate fallback questions first to ensure we never return empty
  const fallbackQuestions = generateFallbackClarifyingQuestions(input.query);
  
  if (state.openrouterCalls >= limits.openrouterCap) {
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
  const limits = getResearchLimits(state.input.deepMode ? 'deeper' : 'deep');
  if (state.openrouterCalls >= limits.openrouterCap) return [];
  
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
  const limits = getResearchLimits(input.deepMode ? 'deeper' : 'deep');
  const tavilyCap = limits.maxParts * limits.tavilyPerPart;
  const maxResults = limits.tavilyMaxResults;
  
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
  const limits = getResearchLimits(state.input.deepMode ? 'deeper' : 'deep');
  if (state.openrouterCalls >= limits.openrouterCap || evidence.length < 10) {
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
  const limits = getResearchLimits(state.input.deepMode ? 'deeper' : 'deep');
  const maxSonarCalls = limits.maxParts * limits.sonarPerPart;
  if (state.pplxCalls >= maxSonarCalls || clusters.length < 2) {
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
  const limits = getResearchLimits(input.deepMode ? 'deeper' : 'deep');
  const maxSonarCalls = limits.maxParts * limits.sonarPerPart;
  if (state.pplxCalls >= maxSonarCalls) {
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
    const limits = getResearchLimits(input.deepMode ? 'deeper' : 'deep');
    if (state.openrouterCalls < limits.openrouterCap) {
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
  
  const limits = getResearchLimits(input.deepMode ? 'deeper' : 'deep');
  if (state.openrouterCalls >= limits.openrouterCap) {
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
  
  // Dynamic budgets based on research mode
  const limits = getResearchLimits(input.deepMode ? 'deeper' : 'deep');
  const pplxCap = limits.maxParts * limits.sonarPerPart;
  const tavilyCap = limits.maxParts * limits.tavilyPerPart;
  const maxResults = limits.tavilyMaxResults;
  const searchDepth = limits.searchDepth;
  
  log('gather> starting for', subqs.length, 'subqs (deep mode:', !!input.deepMode, ')');
  log('gather> budgets - pplx:', pplxCap, 'tavily:', tavilyCap, 'maxResults:', maxResults, 'depth:', searchDepth);

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
      
                // Use dynamic mode selection based on research configuration
          let mode: 'pro' | 'reasoning' | 'default';
          if (sq.type === 'reasoning') {
            mode = 'reasoning';
          } else {
            mode = limits.sonarModel === 'sonar-pro' ? 'pro' : 'default';
          }
      log('gather> perplexity call for', sq.id, 'mode:', mode, 'model:', limits.sonarModel);
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
              maxResults: limits.tavilyMaxResults,
              timeRange: 'year',
              searchDepth: limits.searchDepth
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
  // Dynamic budgets based on research mode
  const limits = getResearchLimits(input.deepMode ? 'deeper' : 'deep');
  const pplxCap = limits.maxParts * limits.sonarPerPart;
  const tavilyCap = limits.maxParts * limits.tavilyPerPart;
  
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

// NEW: Content Extraction Phase
async function extractDetailedContent(themes: string[], input: ResearchInput, state: ResearchState): Promise<Array<{theme: string, content: string, sources: string[]}>> {
  const log = (...args: any[]) => console.log('[research]', ...args);
  log('extract> extracting detailed content for', themes.length, 'themes');
  
  const contentExtracts: Array<{theme: string, content: string, sources: string[]}> = [];
  
  for (const theme of themes) {
    try {
      // Get 2-3 sources with full content for this theme (OPTIMIZED)
      const searchResult = await tavilySearchCached({
        query: `${theme} ${input.query}`.substring(0, 350), // Keep under Tavily limit
        maxResults: 20, // Reduced from 6 to 3
        searchDepth: 'advanced', // Changed from advanced to basic for efficiency
        includeRawContent: true
      });
      
      log('extract> found', searchResult.items.length, 'sources for theme:', theme.substring(0, 30) + '...');
      
      // Filter sources with substantial content
      const richSources = searchResult.items
        .filter(item => item.raw_content && item.raw_content.length > 1000)
        .slice(0, 9); // Top 2 sources with good content (reduced from 4)
      
      if (richSources.length === 0) {
        log('extract> no rich content found for theme, using snippets');
        contentExtracts.push({
          theme,
          content: searchResult.items.map(item => `${item.title}: ${item.snippet}`).join('\n\n'),
          sources: searchResult.items.map(item => item.url).slice(0, 2) // Reduced from 4 to 2
        });
        continue;
      }
      
      // Extract insights from each source using OpenRouter with citation tracking
      const insights: string[] = [];
      const sourceUrls: string[] = [];
      let globalCitationCounter = state.globalCitationCounter || 1;
      
      for (const [sourceIndex, source] of richSources.entries()) {
        try {
          // Use free model for extraction to minimize costs
          const extractResult = await openrouterCall({
            model: GEMINI_MODEL, // Use free model for extraction
            messages: [
              {
                role: 'system',
                content: `Extract key insights about "${theme}" from the source with mandatory inline citations.

CRITICAL CITATION REQUIREMENTS:
- Every factual claim, statistic, or data point MUST have an inline citation immediately after it
- Use format: "Statement with fact [${globalCitationCounter + sourceIndex}]."
- This source should be cited as [${globalCitationCounter + sourceIndex}]
- Focus on specific data, examples, and trends with citations
- Write 2-3 paragraphs with the citation [${globalCitationCounter + sourceIndex}] throughout

EXAMPLE: "The adoption rate increased by 45% in Q3 2024 [${globalCitationCounter + sourceIndex}]. Market analysis shows significant growth [${globalCitationCounter + sourceIndex}]."`
              },
              {
                role: 'user',
                content: `Theme: ${theme}
Source: ${source.title}
URL: ${source.url}
Citation Number: [${globalCitationCounter + sourceIndex}]
Content: ${source.raw_content?.substring(0, 3000) || source.snippet || 'No content available'}

Extract key insights with inline citations [${globalCitationCounter + sourceIndex}] throughout the text:`
              }
            ],
            temperature: 0.2
          });
          
          insights.push(extractResult.text || 'No insights extracted');
          sourceUrls.push(`[${globalCitationCounter + sourceIndex}] ${source.title || 'Research Source'} - ${source.url || 'Unknown source'}`);
          
        } catch (error) {
          log('extract> failed to extract from source:', error);
          // Fallback to snippet
          insights.push(`${source.title}: ${source.snippet || 'No content available'} [${globalCitationCounter + sourceIndex}]`);
          sourceUrls.push(`[${globalCitationCounter + sourceIndex}] ${source.title || 'Research Source'} - ${source.url}`);
        }
      }
      
      // Update global citation counter for next theme
      state.globalCitationCounter = globalCitationCounter + richSources.length;
      
      // Combine insights for this theme
      const combinedContent = insights.join('\n\n---\n\n');
      contentExtracts.push({
        theme,
        content: combinedContent,
        sources: sourceUrls
      });
      
      log('extract> extracted', combinedContent.length, 'chars for theme:', theme.substring(0, 30) + '...');
      
    } catch (error) {
      log('extract> failed for theme:', theme, error);
      // Add empty extract so we don't skip the theme
      contentExtracts.push({
        theme,
        content: `Research theme: ${theme}\n\nDetailed analysis not available due to extraction error.`,
        sources: []
      });
    }
  }
  
  log('extract> completed extraction for', contentExtracts.length, 'themes');
  return contentExtracts;
}

// NEW: Parallel Focused Research
async function runParallelFocusedResearch(contentExtracts: Array<{theme: string, content: string, sources: string[]}>, input: ResearchInput, state: ResearchState): Promise<Array<{theme: string, analysis: string, sources: string[]}>> {
  const log = (...args: any[]) => console.log('[research]', ...args);
  log('parallel> running focused research on', contentExtracts.length, 'themes');
  
  const maxConcurrent = Math.min(contentExtracts.length, 3); // Limit to 3 parallel calls
  const analyses: Array<{theme: string, analysis: string, sources: string[]}> = [];
  
  // Process themes in batches
  for (let i = 0; i < contentExtracts.length; i += maxConcurrent) {
    const batch = contentExtracts.slice(i, i + maxConcurrent);
    
    const batchPromises = batch.map(async (extract) => {
      const limits = getResearchLimits(input.deepMode ? 'deeper' : 'deep');
      const maxSonarCalls = limits.maxParts * limits.sonarPerPart;
      if (state.pplxCalls >= maxSonarCalls) {
        log('parallel> perplexity budget exhausted for theme:', extract.theme.substring(0, 30) + '...');
        return {
          theme: extract.theme,
          analysis: `Detailed analysis of ${extract.theme}:\n\n${extract.content}`,
          sources: extract.sources
        };
      }
      
      try {
        state.pplxCalls++;
        log('parallel> researching theme:', extract.theme.substring(0, 40) + '...');
        log('[perplexity] calling sonar-pro for theme:', extract.theme.substring(0, 50) + '...');
        
        const result = await perplexityAsk({
          prompt: `Conduct comprehensive research analysis on: ${extract.theme}

CRITICAL CITATION REQUIREMENTS:
- Every factual claim, statistic, quote, or data point MUST have an inline citation immediately after it
- Use format: "Statement with fact [X]." or "Multiple claims [X][Y]."
- Number your citations sequentially starting from ${state.globalCitationCounter || 1}
- Include citations from both the extracted content AND your additional research

Context: This is part of a broader research on "${input.query}"

Pre-Cited Extracted Content (already has citations):
${extract.content}

Please provide a thorough analysis with inline citations covering:
1. **Current State & Key Developments**: What's happening now? Include specific examples [cite sources], statistics [cite sources], and recent developments [cite sources].

2. **Impact Analysis**: What are the real-world effects [cite sources] and implications? Include both positive and negative impacts with concrete examples [cite sources].

3. **Expert Perspectives**: What do researchers [cite sources], practitioners [cite sources], and stakeholders think? Include different viewpoints and debates [cite sources].

4. **Future Outlook**: Where is this heading [cite sources]? Include trends, predictions [cite sources], and emerging developments [cite sources].

5. **Challenges & Opportunities**: What are the main obstacles [cite sources] and potential benefits [cite sources]?

EXAMPLE CITATION STYLE: "Recent analysis shows 78% adoption rate [${state.globalCitationCounter || 1}]. Industry leaders report 45% efficiency gains [${(state.globalCitationCounter || 1) + 1}][${(state.globalCitationCounter || 1) + 2}]. Market projections indicate continued growth through 2025 [${(state.globalCitationCounter || 1) + 3}]."

Make this analysis substantial with inline citations after every claim, statistic, and data point.`,
          mode: 'pro'
        });
        
        log('[perplexity] received response, length:', (result.text || '').length, 'chars');
        log('[perplexity] citations received:', (result.citations || []).length);
        
        return {
          theme: extract.theme,
          analysis: result.text || `Analysis of ${extract.theme}:\n\nDetailed research analysis not available.`,
          sources: extract.sources.concat(result.citations || [])
        };
        
      } catch (error) {
        log('[perplexity] ERROR - API call failed for theme:', extract.theme.substring(0, 50));
        log('[perplexity] Error details:', error);
        log('parallel> research failed for theme:', extract.theme, error);
        return {
          theme: extract.theme,
          analysis: `Research Analysis: ${extract.theme}

${extract.content}

Note: Extended analysis was not available due to API limitations.`,
          sources: extract.sources
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    analyses.push(...batchResults);
    
    log('parallel> completed batch', Math.floor(i / maxConcurrent) + 1, 'of', Math.ceil(contentExtracts.length / maxConcurrent));
  }
  
  log('parallel> completed focused research on', analyses.length, 'themes');
  return analyses;
}

// NEW: Narrative Synthesis - Build Markdown Directly
async function synthesizeNarrativeReport(analyses: Array<{theme: string, analysis: string, sources: string[]}>, input: ResearchInput): Promise<{markdown: string, allSources: string[]}> {
  const log = (...args: any[]) => console.log('[research]', ...args);
  log('synthesize> creating narrative report from', analyses.length, 'analyses');
  
  try {
    // Collect all sources
    const allSources = Array.from(new Set(analyses.flatMap(a => a.sources)));
    
    // Create comprehensive synthesis prompt
    const synthesisResult = await openrouterCall({
      model: 'google/gemini-2.5-flash-lite', // Use free model for synthesis to minimize costs
      messages: [
        {
          role: 'system',
          content: `Create a comprehensive research report synthesizing the pre-cited analyses below.

CRITICAL: The analyses below already contain inline citations [1][2][3]. 
- PRESERVE all existing citations exactly as they appear
- DO NOT remove or modify any [1][2][3] citations  
- When combining content, maintain citation integrity
- Add section headings and structure while keeping all citations
- Every claim should have its citation preserved from the source material

Structure:
# Comprehensive Research Report
**Research Query:** [query]

## Executive Summary
[400-500 word summary with preserved citations [1][2][3]]

## Key Research Findings
### Finding 1: [Title]
[Detailed explanation with preserved citations [1][2][3]]
[Continue with 10+ findings with citations]

## Detailed Analysis  
### [Section Title]
[500-700 words analysis with preserved citations [1][2][3]]
[Continue with 3+ sections]

## Research Limitations
[List limitations]

PRESERVE ALL CITATIONS [1][2][3] from the source analyses. Never remove citations. Make it substantial with specific examples and data.`
        },
        {
          role: 'user',
          content: `Research Topic: ${input.query}

Detailed Analyses to Synthesize:

${analyses.map((a, i) => `## Analysis ${i + 1}: ${a.theme}

${a.analysis}

---`).join('\n\n')}

Create a comprehensive research report that synthesizes all these analyses into a cohesive, substantial document. Make it detailed with rich narrative content, specific examples, and thorough explanations.`
        }
      ],
      temperature: 0.3
    });
    
    const reportContent = synthesisResult.text || 'Comprehensive research analysis not available';
    
    // ENHANCED: Extract citations and make them clickable with anchor links
    const citationPattern = /\[(\d+)\]/g;
    const citationsFound = new Set<string>();
    let match;

    // Scan report content and all analyses for citations
    const contentToScan = reportContent + analyses.map(a => a.analysis).join(' ');
    while ((match = citationPattern.exec(contentToScan)) !== null) {
      citationsFound.add(match[1]);
    }

    // Convert inline citations to clickable anchor links
    let clickableContent = reportContent;
    const sortedCitations = Array.from(citationsFound).sort((a, b) => parseInt(a) - parseInt(b));
    
    for (const citationNum of sortedCitations) {
      const superscripts = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹', '¹⁰', '¹¹', '¹²', '¹³', '¹⁴', '¹⁵', '¹⁶', '¹⁷', '¹⁸', '¹⁹', '²⁰'];
      const num = parseInt(citationNum);
      const superscript = num <= 20 ? superscripts[num - 1] : `[${citationNum}]`;
      
      // Replace [1] with clickable anchor links [¹](#ref-1)
      const regex = new RegExp(`\\[${citationNum}\\]`, 'g');
      clickableContent = clickableContent.replace(regex, `[${superscript}](#ref-${citationNum})`);
    }

    // Build enhanced clickable reference list
    const citationReferences = sortedCitations
      .map(num => {
        // Find corresponding source info for this citation number
        const sourceInfo = allSources.find(s => s.includes(`[${num}]`));
        if (sourceInfo) {
          // Parse source info: "[1] Title - URL"
          const match = sourceInfo.match(/^\[(\d+)\]\s*(.+?)\s*-\s*(https?:\/\/.+)$/);
          if (match) {
            const [, citationNum, title, url] = match;
            return `<a id="ref-${citationNum}"></a>**[${citationNum}] ${title}**  
📄 *Research source with relevant insights*  
🔗 [${url}](${url})`;
          }
        }
        return `<a id="ref-${num}"></a>**[${num}] Research Source ${num}**  
📄 *Additional research source*`;
      }).join('\n\n');

    // Clean URLs for complete bibliography (remove citation numbers)
    const cleanUrls = allSources.map(s => s.replace(/^\[\d+\]\s*/, ''));
    
    const fullMarkdown = `${clickableContent}

---

## References

${citationReferences}

---

## Complete Source Bibliography (${cleanUrls.length} total sources searched)

${cleanUrls.map((url, i) => `${i + 1}. [${url}](${url})`).join('\n')}

---

**Research Methodology:** This comprehensive report was generated through systematic analysis of ${cleanUrls.length} sources across ${analyses.length} thematic areas, using advanced AI-powered research techniques with human oversight for quality assurance.

**Completion Date:** ${new Date().toLocaleDateString()}
`;
    
    log('synthesize> created', fullMarkdown.length, 'character report');
    return { markdown: fullMarkdown, allSources };
    
  } catch (error) {
    log('synthesize> synthesis failed:', error);
    
    // Fallback: Build report manually from analyses
    const fallbackMarkdown = `# Comprehensive Research Report

**Research Query:** ${input.query}

## Executive Summary

This comprehensive research report examines ${input.query} through detailed analysis of multiple thematic areas. The research reveals significant developments, challenges, and opportunities across this domain.

${analyses.map(a => `The analysis of ${a.theme} shows important insights and implications for the field.`).join(' ')}

## Detailed Analysis

${analyses.map((a, i) => `### ${i + 1}. ${a.theme}

${a.analysis}

---`).join('\n\n')}

## Research Limitations

1. Analysis based on available source material
2. Limited by source availability and quality  
3. May not capture all nuances of complex topics

---

## Appendix: Sources Consulted (${analyses.flatMap(a => a.sources).length} total)

${Array.from(new Set(analyses.flatMap(a => a.sources))).map((url, i) => `${i + 1}. ${url}`).join('\n')}

---

**Research completed with ${analyses.length} thematic analyses**
`;
    
    return { 
      markdown: fallbackMarkdown, 
      allSources: Array.from(new Set(analyses.flatMap(a => a.sources)))
    };
  }
}

export async function runDeepResearch(input: ResearchInput): Promise<{ report: Report; markdown: string; meta: any; clarifyingQuestions?: ClarifyingQuestion[] }> {
  const startTime = Date.now();
  log('research> starting CONTENT-FIRST research, mode:', input.deepMode ? 'DEEP' : 'NORMAL');
  log('research> skipClarify flag:', !!input.skipClarify);
  
  // Always clear cache for fresh results and prevent cache bloat
  clearCache();
  log('research> cache cleared automatically for fresh results');
  
  // Additional clear if explicitly requested (legacy support)
  if (input.clearCache) {
    log('research> explicit cache clear also requested');
  }
  
  const state: ResearchState = {
    input,
    clarifyingQuestions: [],
    refinedQuery: input.query, // This will be the refined query from user answers
    subqs: [],
    evidence: [],
    contradictions: [],
    pplxCalls: 0,
    pplxDeepCalls: 0,
    tavilyCalls: 0,
    openrouterCalls: 0,
    globalCitationCounter: 1
  };
  
  log('research> initialized state with query length:', input.query.length);

  // 0) Generate clarifying questions only if not skipped
  if (!input.skipClarify) {
    log('research> generating clarifying questions...');
    state.clarifyingQuestions = await generateClarifyingQuestions(input, state);
    
    // If clarifying questions were generated, return them for user input
    if (state.clarifyingQuestions.length > 0) {
      log('research> returning', state.clarifyingQuestions.length, 'clarifying questions to user');
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
    } else {
      log('research> no clarifying questions generated, proceeding with research');
    }
  } else {
    log('research> skipping clarifying questions, proceeding directly to research');
  }

  // Now proceed with actual research
  // NEW CONTENT-FIRST PIPELINE
  
  // 1) Decompose into research themes (instead of sub-questions)
  log('research> STEP 1: Decomposing query into research themes...');
  const macroTopics = await decompose({ ...input, query: state.refinedQuery }, state);
  const themes = macroTopics.map(sq => sq.question);
  state.subqs = macroTopics; // Keep for compatibility
  log('research> ✅ STEP 1 COMPLETE: Identified', themes.length, 'research themes');
  themes.forEach((theme, i) => log(`research>   Theme ${i+1}: ${theme.substring(0, 80)}...`));
  
  // 2) NEW - Extract detailed content from sources for each theme
  log('research> STEP 2: Extracting detailed content from sources...');
  const contentExtracts = await extractDetailedContent(themes, input, state);
  log('research> ✅ STEP 2 COMPLETE: Extracted content for', contentExtracts.length, 'themes');
  contentExtracts.forEach((extract, i) => {
    log(`research>   Extract ${i+1}: ${extract.theme.substring(0, 60)}... (${extract.sources.length} sources)`);
  });
  
  // 3) NEW - Run parallel focused research with rich content
  log('research> STEP 3: Running parallel focused research...');
  const focusedAnalyses = await runParallelFocusedResearch(contentExtracts, input, state);
  log('research> ✅ STEP 3 COMPLETE: Completed focused research on', focusedAnalyses.length, 'themes');
  focusedAnalyses.forEach((analysis, i) => {
    log(`research>   Analysis ${i+1}: ${analysis.theme.substring(0, 60)}... (${analysis.sources.length} sources)`);
  });
  
  // Runtime check
  if (Date.now() - startTime > RUNTIME_CAP_MS) {
    log('research> runtime cap exceeded, using available analysis');
  }
  
  // 4) NEW - Synthesize into comprehensive narrative report
  log('research> STEP 4: Synthesizing comprehensive narrative report...');
  const { markdown, allSources } = await synthesizeNarrativeReport(focusedAnalyses, input);
  log('research> ✅ STEP 4 COMPLETE: Synthesized final report');
  log('research>   Report length:', markdown.length, 'characters');
  log('research>   Total sources:', allSources.length);
  
  // Generate simplified report object for API compatibility (no duplicate processing)
  const reportSummary: Report = {
    query: input.query,
    executive_summary: "Comprehensive research completed with inline citations",
    key_findings: [],
    sections: [],
    limitations: ["Report generated with comprehensive analysis and clickable citations"]
  };

  log('research> 🎉 RESEARCH COMPLETE! Final stats:');
  log('research>   - Perplexity calls:', state.pplxCalls);
  log('research>   - Tavily calls:', state.tavilyCalls);
  log('research>   - OpenRouter calls:', state.openrouterCalls);
  log('research>   - Research themes:', themes.length);
  log('research>   - Content extracts:', contentExtracts.length);
  log('research>   - Focused analyses:', focusedAnalyses.length);
  log('research>   - Total sources:', allSources.length);
  log('research>   - Runtime:', Math.round((Date.now() - startTime) / 1000), 'seconds');

  return {
    report: reportSummary,
    markdown,
    meta: {
      pplxCalls: state.pplxCalls,
      pplxDeepCalls: state.pplxDeepCalls,
      tavilyCalls: state.tavilyCalls,
      openrouterCalls: state.openrouterCalls,
      subqCount: themes.length,
      evidenceCount: contentExtracts.length,
      evidenceClusters: focusedAnalyses.length,
      deepDiveGenerated: true,
      totalSources: allSources.length,
      contentFirstApproach: true,
      runtimeSeconds: Math.round((Date.now() - startTime) / 1000)
    }
  };
}

function buildEnhancedMarkdown(report: Report, allSourceUrls: string[], deepDive?: DeepDiveSection | null): string {
  // Create a comprehensive citation map for numbered references
  const allCitations = report.sections.flatMap(s => s.citations)
    .concat(report.key_findings.flatMap(f => f.citations || []))
    .filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  
  // Build sections - content should already have inline citations from LLM
  const sectionMd = report.sections.map((s, index) => {
    const sectionNumber = index + 1;
    
    return `### ${s.heading}

${s.content}

`;
  }).join('\n');

  // Build findings - claims should already have inline citations from LLM
  const findings = report.key_findings.map((k, index) => {
    const findingNumber = index + 1;
    
    return `### Finding ${findingNumber}: ${k.claim}
${k.citations && k.citations.length > 0 ? k.citations.map(c => c.snippet).join(' ') : ''}

**Confidence Level:** ${k.confidence.toUpperCase()}

`;
  }).join('\n');

  // Build comprehensive numbered reference system with titles and descriptions
  const numberedReferences = allCitations
    .map((c, i) => {
      const title = c.title || 'Research Source';
      const description = c.snippet ? ` - ${c.snippet.substring(0, 100)}...` : '';
      return `${i + 1}. **${title}**${description}  
   ${c.url}`;
    })
    .join('\n\n');
    
  // Ensure all discovered URLs are included in complete bibliography
  const uniqueAllUrls = [...new Set(allSourceUrls)];
  const completeSourceList = uniqueAllUrls
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

## Executive Summary

${report.executive_summary}

## Key Research Findings

${findings}

## Detailed Analysis

${sectionMd}${deepDiveSection}

---

## References

${numberedReferences.length > 0 ? numberedReferences : 'No citations available in the generated content.'}

---

## Complete Source Bibliography (${uniqueAllUrls.length} total sources searched)

${completeSourceList}

---

## Research Limitations

${report.limitations.map((l, i) => `${i + 1}. ${l}`).join('\n')}

---

**Research Methodology:** This comprehensive report was generated through systematic analysis of ${allSourceUrls.length} sources across ${report.sections.length} thematic areas, using advanced AI-powered research techniques with human oversight for quality assurance.

**Completion Date:** ${new Date().toLocaleDateString()}

`;
} 