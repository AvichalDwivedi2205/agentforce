// Main orchestration for ideation agent - 7-step pipeline
import { openrouterCall, perplexityAsk, tavilySearch } from '../../clients.js';
import {
  IdeationInput, IdeationOutput, IdeationState, Brief, Idea, IdeaScore,
  PROMPT_FRAMER, PROMPT_GENERATOR, PROMPT_SKEPTIC, PROMPT_SYNTHESIZER
} from './contracts.js';
import {
  deduplicateIdeas, scoreIdeas, parseIdeas, parseBrief, 
  enrichIdeasWithSources, getTopScoredIdea
} from './utils.js';
import { readIdeationCache, writeIdeationCache, clearIdeationCache, closeRedisConnection } from './cache.js';

const GEMINI_MODEL = 'google/gemini-2.5-flash-lite';
const log = (...args: any[]) => console.log('[ideation]', ...args);

export async function runIdeation(input: IdeationInput): Promise<IdeationOutput> {
  if (input.clearCache) {
    await clearIdeationCache();
    log('Cache cleared');
  }

  const state: IdeationState = {
    assumptionLedger: [],
    rawIdeas: [],
    finalIdeas: [],
    scores: [],
    onePager: '',
    decisionLog: '',
    apiCalls: { openrouter: 0, tavily: 0, perplexity: 0 },
    startTime: Date.now()
  };

  try {
    log('Starting ideation for:', input.topic);
    
    // Step 1: Frame - Collect brief and assumptions
    log('Step 1: Framing...');
    const framingResult = await stepFrame(input.topic, state);
    state.brief = framingResult.brief;
    state.assumptionLedger = framingResult.assumptions;
    
    // Step 2: Generate 8 candidate ideas
    log('Step 2: Generating ideas...');
    state.rawIdeas = await stepGenerate(state.brief!, state);
    log(`Generated ${state.rawIdeas.length} raw ideas`);
    
    // Step 3: De-duplicate to 5-8 ideas
    log('Step 3: De-duplicating...');
    state.finalIdeas = deduplicateIdeas(state.rawIdeas);
    log(`De-duplicated to ${state.finalIdeas.length} unique ideas`);
    
    // Step 4: Ground & enrich with market context
    log('Step 4: Grounding with market context...');
    state.finalIdeas = await stepGround(state.finalIdeas, state);
    
    // Step 5: Skeptic pass - disconfirmation analysis
    log('Step 5: Skeptic analysis...');
    state.finalIdeas = await stepSkeptic(state.finalIdeas, state);
    
    // Step 6: Score & rank
    log('Step 6: Scoring and ranking...');
    state.scores = scoreIdeas(state.finalIdeas);
    
    // Step 7: Synthesize winner + decision log
    log('Step 7: Synthesizing winner...');
    const topIdea = getTopScoredIdea(state.finalIdeas, state.scores);
    const topScore = state.scores.find(s => s.idea_id === topIdea.id);
    
    if (topScore) {
      state.onePager = await stepSynthesize(topIdea, topScore, state);
    } else {
      log('No scores available, creating fallback one-pager');
      state.onePager = `# ${topIdea.title}\n\n${topIdea.summary}\n\nThis is a fallback brief due to scoring system issues.`;
    }
    state.decisionLog = generateDecisionLog(state);
    
    log(`Completed in ${Date.now() - state.startTime}ms`);
    log('API calls:', state.apiCalls);
    
    return {
      brief: state.brief!,
      ideas: state.finalIdeas,
      scores: state.scores,
      onePager: state.onePager,
      decisionLog: state.decisionLog,
      meta: {
        costs: state.apiCalls,
        runtime_ms: Date.now() - state.startTime
      }
    };
    
  } catch (error) {
    console.error('[ideation] Error:', error);
    throw error;
  } finally {
    // Close Redis connection gracefully
    await closeRedisConnection();
  }
}

// Step 1: Frame - Ask clarifying questions and generate brief
async function stepFrame(topic: string, state: IdeationState): Promise<{ brief: Brief; assumptions: string[] }> {
  const cached = await readIdeationCache<{ brief: Brief; assumptions: string[] }>('frame', { topic });
  if (cached) {
    log('Frame cache hit');
    return cached;
  }
  
  const { text } = await openrouterCall({
    model: GEMINI_MODEL,
    messages: [
      { 
        role: 'system', 
        content: 'You are a framing assistant. Generate structured JSON responses for business ideation.' 
      },
      { role: 'user', content: PROMPT_FRAMER(topic) }
    ],
    temperature: 0.3
  });
  
  state.apiCalls.openrouter++;
  
  const result = parseBrief(text || '{}');
  
  // Cache the result
  await writeIdeationCache('frame', { topic }, result);
  
  return result;
}

// Step 2: Generate 8 candidate ideas using SCAMPER, inversion, analogy
async function stepGenerate(brief: Brief, state: IdeationState): Promise<Idea[]> {
  const { text } = await openrouterCall({
    model: GEMINI_MODEL,
    messages: [
      { 
        role: 'system', 
        content: 'You are a creative business ideation assistant. Generate diverse, actionable ideas using SCAMPER, inversion, and analogy lenses. Include exactly 1 contrarian idea that contradicts the prevailing strategy.' 
      },
      { role: 'user', content: PROMPT_GENERATOR(brief) }
    ],
    temperature: 0.8 // High creativity for idea generation
  });
  
  state.apiCalls.openrouter++;
  return parseIdeas(text || '[]');
}

// Step 3: Ground & enrich with market context (Tavily + Perplexity)
async function stepGround(ideas: Idea[], state: IdeationState): Promise<Idea[]> {
  if (ideas.length === 0) {
    log('No ideas to ground, skipping');
    return ideas;
  }
  
  // Extract key themes for search
  const themes = ideas.slice(0, 3).map(idea => idea.title).join(', ');
  const searchQuery = `market trends opportunities ${themes}`;
  
  const cached = await readIdeationCache<{ tavily: any[]; perplexity: string[] }>('ground', { query: searchQuery });
  
  let tavilyResults: any[] = [];
  let perplexityCitations: string[] = [];
  
  if (cached) {
    log('Grounding cache hit');
    tavilyResults = cached.tavily;
    perplexityCitations = cached.perplexity;
  } else {
    try {
      // Tavily search - basic search with max 15 results
      const { items } = await tavilySearch({
        query: searchQuery,
        maxResults: 15,
        searchDepth: 'basic'
      });
      state.apiCalls.tavily++;
      tavilyResults = items;
      log(`Tavily found ${items.length} results`);
    } catch (error) {
      log('Tavily search failed:', error);
      tavilyResults = [];
    }
    
    try {
      // Perplexity sonar-pro for synthesized context
      const { text, citations } = await perplexityAsk({
        prompt: `Current market context and opportunities for: ${themes}. Include recent trends and market validation.`,
        mode: 'pro' // sonar-pro
      });
      state.apiCalls.perplexity++;
      perplexityCitations = citations;
      log(`Perplexity returned ${citations.length} citations`);
    } catch (error) {
      log('Perplexity search failed:', error);
      perplexityCitations = [];
    }
    
    // Cache the grounding data (even if partially failed)
    const groundingData = { tavily: tavilyResults, perplexity: perplexityCitations };
    await writeIdeationCache('ground', { query: searchQuery }, groundingData);
  }
  
  return enrichIdeasWithSources(ideas, tavilyResults, perplexityCitations);
}

// Step 4: Skeptic pass - disconfirmation analysis
async function stepSkeptic(ideas: Idea[], state: IdeationState): Promise<Idea[]> {
  const cached = await readIdeationCache<Idea[]>('skeptic', { ideas: ideas.map(i => i.id) });
  if (cached) {
    log('Skeptic cache hit');
    return cached;
  }
  
  const { text } = await openrouterCall({
    model: GEMINI_MODEL,
    messages: [
      { 
        role: 'system', 
        content: 'You are a rigorous business skeptic. Your job is disconfirmation - identify flaws, challenge assumptions, and design tests that target the hardest risks first. Force "hardest-risk first" testing.' 
      },
      { role: 'user', content: PROMPT_SKEPTIC(ideas) }
    ],
    temperature: 0.2 // Low temperature for analytical thinking
  });
  
  state.apiCalls.openrouter++;
  
  const analyzed = parseIdeas(text || '[]');
  
  // Merge skeptic insights back into original ideas
  const enhanced = ideas.map((original, index) => ({
    ...original,
    risks_harms: analyzed[index]?.risks_harms || original.risks_harms,
    assumptions: analyzed[index]?.assumptions || original.assumptions,
    test: analyzed[index]?.test || original.test
  }));
  
  // Cache the result
  await writeIdeationCache('skeptic', { ideas: ideas.map(i => i.id) }, enhanced);
  
  return enhanced;
}

// Step 6: Synthesize winner into one-page brief
async function stepSynthesize(idea: Idea, score: IdeaScore, state: IdeationState): Promise<string> {
  const cached = await readIdeationCache<string>('synthesize', { idea: idea.id, score });
  if (cached) {
    log('Synthesis cache hit');
    return cached;
  }
  
  const { text } = await openrouterCall({
    model: GEMINI_MODEL,
    messages: [
      { 
        role: 'system', 
        content: 'You are a business strategy consultant. Create comprehensive, decision-ready business briefs that investors and founders can act on immediately.' 
      },
      { role: 'user', content: PROMPT_SYNTHESIZER(idea, score) }
    ],
    temperature: 0.3
  });
  
  state.apiCalls.openrouter++;
  
  const result = text || '';
  
  // Cache the result
  await writeIdeationCache('synthesize', { idea: idea.id, score }, result);
  
  return result;
}

// Step 7: Generate decision log
function generateDecisionLog(state: IdeationState): string {
  const log = [];
  log.push('# Decision Log\n');
  log.push(`**Topic:** ${state.brief?.topic}`);
  log.push(`**Ideas Generated:** ${state.rawIdeas.length} raw → ${state.finalIdeas.length} final`);
  log.push(`**Top Scoring Method:** ICE (Impact × Confidence × Ease)\n`);
  
  log.push('## Scoring Summary');
  state.scores
    .sort((a, b) => b.ICE.score - a.ICE.score)
    .forEach((score, i) => {
      const idea = state.finalIdeas.find(idea => idea.id === score.idea_id);
      log.push(`${i + 1}. **${idea?.title}** - ICE: ${score.ICE.score}, RICE: ${score.RICE.score}`);
    });
  
  log.push('\n## Why This Ranking');
  log.push('- Prioritized ideas with clear value propositions');
  log.push('- Emphasized feasibility over pure novelty');  
  log.push('- Focused on "hardest-risk first" testing approach');
  
  log.push('\n## API Usage');
  log.push(`- OpenRouter calls: ${state.apiCalls.openrouter}`);
  log.push(`- Tavily searches: ${state.apiCalls.tavily}`);
  log.push(`- Perplexity queries: ${state.apiCalls.perplexity}`);
  
  return log.join('\n');
}