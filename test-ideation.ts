#!/usr/bin/env tsx
// Test script for the ideation agent
import { runIdeation } from './lib/ai/graphs/ideation/graph.js';

async function testIdeationAgent() {
  console.log('🧪 Testing Ideation Agent\n');
  
  const testCases = [
    {
      name: 'AI Productivity Tools',
      topic: 'AI productivity tools for small businesses',
      description: 'Testing with a popular AI/SaaS topic'
    },
    {
      name: 'Green Tech Solutions',
      topic: 'sustainable energy solutions for urban environments',
      description: 'Testing with environmental/sustainability focus'
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎯 Test Case: ${testCase.name}`);
    console.log(`📝 Topic: ${testCase.topic}`);
    console.log(`💡 Description: ${testCase.description}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
      const startTime = Date.now();
      
      const result = await runIdeation({
        topic: testCase.topic,
        clearCache: false // Test with caching
      });

      const duration = Date.now() - startTime;
      
      // Validate results
      console.log('✅ **SUCCESS** - Ideation completed!\n');
      
      console.log('📊 **VALIDATION RESULTS:**');
      console.log(`- Ideas generated: ${result.ideas.length}`);
      console.log(`- All ideas have titles: ${result.ideas.every(i => i.title)}`);
      console.log(`- All ideas have tests: ${result.ideas.every(i => i.test.design)}`);
      console.log(`- Brief generated: ${!!result.brief.goal}`);
      console.log(`- One-pager created: ${result.onePager.length > 100}`);
      console.log(`- Decision log present: ${result.decisionLog.length > 50}`);
      console.log(`- Scores calculated: ${result.scores.length === result.ideas.length}`);
      
      console.log('\n💰 **COST ANALYSIS:**');
      console.log(`- OpenRouter calls: ${result.meta.costs.openrouter}`);
      console.log(`- Tavily searches: ${result.meta.costs.tavily}`);
      console.log(`- Perplexity queries: ${result.meta.costs.perplexity}`);
      console.log(`- Total runtime: ${duration}ms`);
      
      console.log('\n🏆 **TOP 3 IDEAS:**');
      const sortedScores = result.scores.sort((a, b) => b.ICE.score - a.ICE.score);
      sortedScores.slice(0, 3).forEach((score, i) => {
        const idea = result.ideas.find(idea => idea.id === score.idea_id);
        console.log(`${i + 1}. **${idea?.title}**`);
        console.log(`   - ICE Score: ${score.ICE.score} (I:${score.ICE.impact}, C:${score.ICE.confidence}, E:${score.ICE.ease})`);
        console.log(`   - RICE Score: ${score.RICE.score}`);
        console.log(`   - Test: ${idea?.test.design}`);
        console.log('');
      });
      
      console.log('\n📄 **ONE-PAGER PREVIEW:**');
      console.log(result.onePager.substring(0, 300) + '...\n');
      
    } catch (error) {
      console.error(`❌ **FAILED** - Test case "${testCase.name}" failed:`);
      console.error(error);
      console.log('');
    }
  }
  
  console.log('\n🎉 **Testing Complete!**');
  console.log('Run individual tests with: pnpm start -- --ideation "your topic here"');
}

// Run the tests
testIdeationAgent().catch(console.error);