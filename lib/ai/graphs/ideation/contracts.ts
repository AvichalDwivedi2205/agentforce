// Data contracts and prompts for the ideation agent

export type IdeationInput = {
  topic: string;
  clearCache?: boolean;
};

export type Brief = {
  topic: string;
  goal: string;
  audience: string;
  constraints: string[];
  time_horizon: 'weeks' | 'months' | 'quarters';
  risk_appetite: 'low' | 'medium' | 'high';
  success_metric: string;
};

export type Idea = {
  id: string;
  title: string;
  summary: string; // 2-3 sentences
  who_benefits: string[]; // ["primary", "secondary"]
  why_now: string;
  assumptions: string[]; // ["A1", "A2", "A3"]
  risks_harms: string[]; // ["R1", "R2"]
  test: {
    design: string;
    success: string;
    timebox: string;
    budget: 'low' | 'med' | 'high';
  };
  effort: {
    dev_weeks: number;
    complexity: 'low' | 'med' | 'high';
    deps: string[];
  };
  sources: Array<{
    title: string;
    url: string;
    confidence: number;
  }>;
};

export type IdeaScore = {
  idea_id: string;
  ICE: {
    impact: number;
    confidence: number;
    ease: number;
    score: number;
  };
  RICE: {
    reach: number;
    impact: number;
    confidence: number;
    effort: number;
    score: number;
  };
};

export type IdeationState = {
  brief?: Brief;
  assumptionLedger: string[];
  rawIdeas: Idea[];
  finalIdeas: Idea[];
  scores: IdeaScore[];
  onePager: string;
  decisionLog: string;
  apiCalls: {
    openrouter: number;
    tavily: number;
    perplexity: number;
  };
  startTime: number;
};

export type IdeationOutput = {
  brief: Brief;
  ideas: Idea[];
  scores: IdeaScore[];
  onePager: string;
  decisionLog: string;
  meta: {
    costs: { openrouter: number; tavily: number; perplexity: number };
    runtime_ms: number;
  };
};

// Prompt templates following the exact specification

export const PROMPT_FRAMER = (topic: string) => `
You are a framing assistant. Given the topic "${topic}", ask at most 6 high-leverage questions to clarify:
- goal
- audience  
- constraints
- time horizon
- risk appetite
- success metric

Then propose a 5-7 sentence Brief and list 5 explicit assumptions.

You MUST respond with ONLY raw JSON, no markdown code fences, no explanations:
{
  "questions": [{"question": "...", "purpose": "..."}],
  "brief": {
    "topic": "${topic}",
    "goal": "...",
    "audience": "...", 
    "constraints": ["..."],
    "time_horizon": "weeks|months|quarters",
    "risk_appetite": "low|medium|high",
    "success_metric": "..."
  },
  "assumptions": ["assumption1", "assumption2", "assumption3", "assumption4", "assumption5"]
}
`;

export const PROMPT_GENERATOR = (brief: Brief) => `
Generate 8 ideas for this Brief: ${JSON.stringify(brief)}

Use lenses: SCAMPER, inversion, analogy.

For each, produce 150–250 words with:
- what it is (2-3 sentences)
- who benefits & why now  
- 3 key assumptions
- 2 risks/harms
- a cheapest reversible test (with pass/fail metric)
- effort snapshot (dev weeks, complexity, dependencies)

Prefer ideas that differ materially. Include 1 contrarian idea.

You MUST respond with ONLY a raw JSON array of 8 ideas, no markdown code fences, no explanations. Use this exact schema:
{
  "title": "string",
  "summary": "2–3 sentences", 
  "who_benefits": ["primary","secondary"],
  "why_now": "string",
  "assumptions": ["A1","A2","A3"],
  "risks_harms": ["R1","R2"],
  "test": {"design":"string","success":"string","timebox":"string","budget":"low|med|high"},
  "effort": {"dev_weeks": 1, "complexity": "low|med|high", "deps": ["..."]},
  "sources": []
}
`;

export const PROMPT_SKEPTIC = (ideas: Idea[]) => `
For each idea below, perform disconfirmation analysis:

${ideas.map((idea, i) => `${i + 1}. ${idea.title}: ${idea.summary}`).join('\n')}

For each idea:
- Rank the 3 riskiest assumptions (hardest-first)
- Write a 4-sentence pre-mortem: "It's 90 days later and we failed because..."
- Propose the smallest reversible test that probes the top risk first, with a pass/fail threshold

You MUST respond with ONLY a raw JSON array of updated ideas, no markdown code fences, no explanations.
`;

export const PROMPT_SYNTHESIZER = (idea: Idea, score: IdeaScore) => `
Create a one-page brief for this top-scoring idea:

Idea: ${JSON.stringify(idea, null, 2)}
Scores: ICE=${score.ICE.score}, RICE=${score.RICE.score}

Include:
- Problem & solution (who benefits, why now with sources)
- Risks & mitigations  
- 30-day plan
- Success metrics
- Resources needed

Make it decision-ready for a founder/investor.

Respond with ONLY the business brief text, no JSON, no markdown formatting.
`;