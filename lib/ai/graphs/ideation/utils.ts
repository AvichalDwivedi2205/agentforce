// Utility functions for ideation agent
import { Idea, IdeaScore } from './contracts.js';

// Helper function to extract JSON from markdown code fences or raw text
function extractJSON(text: string): string {
  // Remove any leading/trailing whitespace
  text = text.trim();
  
  // Method 1: Try to extract from markdown code fences
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim();
  }
  
  // Method 2: Look for JSON starting with { or [
  const jsonStart = Math.min(
    text.indexOf('{') === -1 ? Infinity : text.indexOf('{'),
    text.indexOf('[') === -1 ? Infinity : text.indexOf('[')
  );
  
  if (jsonStart !== Infinity) {
    // Find the matching closing bracket
    let bracketCount = 0;
    let startChar = text[jsonStart];
    let endChar = startChar === '{' ? '}' : ']';
    let endIndex = jsonStart;
    
    for (let i = jsonStart; i < text.length; i++) {
      if (text[i] === startChar) bracketCount++;
      if (text[i] === endChar) bracketCount--;
      if (bracketCount === 0) {
        endIndex = i;
        break;
      }
    }
    
    if (endIndex > jsonStart) {
      return text.substring(jsonStart, endIndex + 1);
    }
  }
  
  return text.trim();
}

// De-duplication using Jaccard similarity (no embeddings)
export function deduplicateIdeas(ideas: Idea[]): Idea[] {
  const unique: Idea[] = [];
  
  for (const idea of ideas) {
    const isDuplicate = unique.some(existing => {
      const titleSim = jaccardSimilarity(
        tokenize(idea.title.toLowerCase()),
        tokenize(existing.title.toLowerCase())
      );
      const summarySim = jaccardSimilarity(
        tokenize(idea.summary.toLowerCase()),
        tokenize(existing.summary.toLowerCase())
      );
      
      // Also check using Dice coefficient on bigrams
      const titleDice = diceCoefficient(
        getBigrams(idea.title.toLowerCase()),
        getBigrams(existing.title.toLowerCase())
      );
      
      return titleSim >= 0.6 || summarySim >= 0.5 || titleDice >= 0.6;
    });
    
    if (!isDuplicate) {
      unique.push(idea);
    }
  }
  
  // Keep best 5-8 ideas, prefer more divergent ones
  return unique.slice(0, 8);
}

// Scoring functions (ICE and RICE)
export function scoreIdeas(ideas: Idea[]): IdeaScore[] {
  return ideas.map((idea, index) => ({
    idea_id: idea.id || `idea-${index + 1}`,
    ICE: calculateICE(idea),
    RICE: calculateRICE(idea)
  }));
}

function calculateICE(idea: Idea) {
  // Estimate impact based on who benefits and market indicators
  const impact = Math.min(10, idea.who_benefits.length * 2 + 
    (idea.why_now.includes('trend') || idea.why_now.includes('opportunity') ? 3 : 1));
  
  // Confidence inversely related to assumptions and risks
  const confidence = Math.max(1, 10 - idea.assumptions.length - idea.risks_harms.length);
  
  // Ease based on effort complexity
  const complexityMap = { low: 8, med: 5, high: 2 };
  const ease = complexityMap[idea.effort.complexity] || 5;
  
  const score = (impact * confidence * ease) / 100;
  
  return { impact, confidence, ease, score: Math.round(score * 100) / 100 };
}

function calculateRICE(idea: Idea) {
  // Rough reach estimate based on audience
  const reach = idea.who_benefits.length * 1000;
  
  // Impact same as ICE
  const impact = Math.min(10, idea.who_benefits.length * 2 + 
    (idea.why_now.includes('trend') || idea.why_now.includes('opportunity') ? 3 : 1)) / 10;
  
  // Confidence same as ICE but normalized
  const confidence = Math.max(0.1, (10 - idea.assumptions.length - idea.risks_harms.length) / 10);
  
  // Effort in weeks
  const effort = idea.effort.dev_weeks || 1;
  
  const score = (reach * impact * confidence) / effort;
  
  return { 
    reach, 
    impact, 
    confidence, 
    effort, 
    score: Math.round(score * 100) / 100 
  };
}

// Helper functions for similarity calculations
function tokenize(text: string): Set<string> {
  return new Set(
    text.split(/\W+/)
      .filter(token => token.length > 2)
      .map(token => token.toLowerCase())
  );
}

function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function getBigrams(text: string): Set<string> {
  const tokens = text.split(/\W+/).filter(t => t.length > 0);
  const bigrams = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

function diceCoefficient(set1: Set<string>, set2: Set<string>): number {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  return (set1.size + set2.size) === 0 ? 0 : (2 * intersection.size) / (set1.size + set2.size);
}

// Parse ideas from JSON response
export function parseIdeas(jsonText: string): Idea[] {
  try {
    console.log('[DEBUG] Original response:', jsonText.substring(0, 100));
    const cleanJson = extractJSON(jsonText);
    console.log('[DEBUG] Extracted JSON:', cleanJson.substring(0, 100));
    const parsed = JSON.parse(cleanJson);
    const ideas = Array.isArray(parsed) ? parsed : [parsed];
    
    return ideas.map((item, index) => ({
      id: `idea-${index + 1}`,
      title: item.title || `Idea ${index + 1}`,
      summary: item.summary || '',
      who_benefits: Array.isArray(item.who_benefits) ? item.who_benefits : [],
      why_now: item.why_now || '',
      assumptions: Array.isArray(item.assumptions) ? item.assumptions : [],
      risks_harms: Array.isArray(item.risks_harms) ? item.risks_harms : [],
      test: item.test || { design: '', success: '', timebox: '', budget: 'low' },
      effort: item.effort || { dev_weeks: 1, complexity: 'med', deps: [] },
      sources: item.sources || []
    }));
  } catch (error) {
    console.error('[ideation] Failed to parse ideas:', error);
    return [];
  }
}

// Parse brief from JSON response
export function parseBrief(jsonText: string): { brief: any; assumptions: string[] } {
  try {
    const parsed = JSON.parse(jsonText);
    return {
      brief: parsed.brief || {},
      assumptions: parsed.assumptions || []
    };
  } catch (error) {
    console.error('[ideation] Failed to parse brief:', error);
    return { brief: {}, assumptions: [] };
  }
}

// Enrich ideas with sources from search results
export function enrichIdeasWithSources(
  ideas: Idea[],
  tavilyResults: Array<{ url: string; title?: string; snippet?: string }>,
  perplexityCitations: string[]
): Idea[] {
  return ideas.map((idea, index) => {
    const sources = [
      // Add relevant Tavily results
      ...(tavilyResults.slice(index * 2, (index + 1) * 2).map(result => ({
        title: result.title || 'Source',
        url: result.url,
        confidence: 0.8
      }))),
      // Add Perplexity citations
      ...perplexityCitations.slice(index, index + 1).map(url => ({
        title: 'Perplexity Source',
        url,
        confidence: 0.9
      }))
    ];
    
    return { ...idea, sources };
  });
}

// Get top scored idea
export function getTopScoredIdea(ideas: Idea[], scores: IdeaScore[]): Idea {
  if (ideas.length === 0 || scores.length === 0) {
    // Return a fallback idea if arrays are empty
    return {
      id: 'fallback-idea',
      title: 'No viable ideas generated',
      summary: 'The ideation process did not generate any viable ideas. Consider refining the topic or trying again.',
      who_benefits: ['users'],
      why_now: 'fallback scenario',
      assumptions: ['this is a fallback'],
      risks_harms: ['no ideas generated'],
      test: { design: 'retry ideation', success: 'generate ideas', timebox: '1 day', budget: 'low' },
      effort: { dev_weeks: 0, complexity: 'low', deps: [] },
      sources: []
    };
  }
  
  const topScore = scores.reduce((best, current) => 
    current.ICE.score > best.ICE.score ? current : best
  );
  return ideas.find(idea => idea.id === topScore.idea_id) || ideas[0];
}