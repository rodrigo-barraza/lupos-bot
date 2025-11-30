const modelsMap = new Map();
const anthropicModelsMap = new Map();
const openAIModelsMap = new Map();
const googleModelsMap = new Map();

// Rodrigo: Current model
// anthropicModelsMap.set('claude-opus-4-1-20250805', {
//   type: 'ANTHROPIC',
//   name: 'claude-opus-4-1-20250805',
//   intelligenceRank: 1,
//   pricing: { input: 15, output: 75 },
// });
// Rodrigo: Current model
anthropicModelsMap.set('claude-sonnet-4-5-20250929', {
  type: 'ANTHROPIC',
  name: 'claude-sonnet-4-5-20250929',
  intelligenceRank: 2,
  pricing: { input: 3, output: 15 },
});
// Rodrigo: Older model
anthropicModelsMap.set('claude-3-7-sonnet-20250219', {
  type: 'ANTHROPIC',
  name: 'claude-3-7-sonnet-20250219',
  intelligenceRank: 2,
  pricing: { input: 3, output: 15 },
});
// Rodrigo: Older model
anthropicModelsMap.set('claude-3-5-sonnet-20241022', {
  type: 'ANTHROPIC',
  name: 'claude-3-5-sonnet-20241022',
  intelligenceRank: 2,
  pricing: { input: 3, output: 15 },
});
// Rodrigo: Older model
anthropicModelsMap.set('claude-3-5-sonnet-20240620', {
  type: 'ANTHROPIC',
  name: 'claude-3-5-sonnet-20240620',
  intelligenceRank: 2,
  pricing: { input: 3, output: 15 },
});
// Rodrigo: Current model
anthropicModelsMap.set('claude-3-5-haiku-20241022', {
  type: 'ANTHROPIC',
  name: 'claude-3-5-haiku-20241022',
  intelligenceRank: 3,
  pricing: { input: 0.80, output: 4 },
});

openAIModelsMap.set('gpt-4o', {
  type: 'OPENAI',
  name: 'gpt-4o',
  intelligenceRank: 1,
  pricing: { input: 2.50, output: 10, cachedInput: 1.25 },
});
openAIModelsMap.set('gpt-5', {
  type: 'OPENAI',
  name: 'gpt-5',
  intelligenceRank: 1,
  pricing: { input: 1.25, output: 10, cachedInput: 0.125 },
  batchedPricing: { input: 0.625, output: 5, cachedInput: 0.0623 },
});
openAIModelsMap.set('gpt-5-mini', {
  type: 'OPENAI',
  name: 'gpt-5-mini',
  intelligenceRank: 2,
  pricing: { input: 0.25, output: 2, cachedInput: 0.025 },
  batchedPricing: { input: 0.125, output: 1, cachedInput: 0.013 },
});
openAIModelsMap.set('gpt-4.1-nano', {
  type: 'OPENAI',
  name: 'gpt-4.1-nano',
  intelligenceRank: 2,
  pricing: { input: 0.10, output: 0.40, cachedInput: 0.025 },
});
openAIModelsMap.set('gpt-5-nano', {
  type: 'OPENAI',
  name: 'gpt-5-nano',
  intelligenceRank: 3,
  pricing: { input: 0.05, output: 0.40, cachedInput: 0.005 },
  batchedPricing: { input: 0.025, output: 0.20, cachedInput: 0.003 },
});

googleModelsMap.set('gemini-2.5-flash-image-preview', {
  type: 'GOOGLE',
  name: 'gemini-2.5-flash-image-preview',
  intelligenceRank: 1,
  pricing: { input: 0.30, output: 2.5 },
  imagePricing: { input: 0.30, output: 2.5 },
});

googleModelsMap.set('gemini-3-pro-image-preview', {
  type: 'GOOGLE',
  name: 'gemini-3-pro-image-preview',
  intelligenceRank: 1,
  pricing: { input: 2, output: 12 }, // text pricing
  imagePricing: { input: 2, output: 120 }, // image pricing
});

modelsMap.set('ANTHROPIC', anthropicModelsMap);
modelsMap.set('OPENAI', openAIModelsMap);
modelsMap.set('GOOGLE', googleModelsMap);

module.exports = modelsMap;
