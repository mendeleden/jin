// Token pricing per million tokens, ported from sidecar's pricing.go

interface ModelPricing {
  input: number;  // $ per 1M tokens
  output: number;
}

const TIERS: Record<string, ModelPricing> = {
  "opus-high": { input: 15.0, output: 75.0 },     // Opus 3/4/4.1
  "opus-low": { input: 5.0, output: 25.0 },        // Opus 4.5+
  "sonnet": { input: 3.0, output: 15.0 },          // All Sonnet
  "haiku-45": { input: 1.0, output: 5.0 },         // Haiku 4.5+
  "haiku-35": { input: 0.8, output: 4.0 },         // Haiku 3.5
  "haiku-3": { input: 0.25, output: 1.25 },        // Haiku 3
  "gpt4o": { input: 2.5, output: 10.0 },
  "gpt4": { input: 30.0, output: 60.0 },
  "o1": { input: 15.0, output: 60.0 },
  "o3": { input: 10.0, output: 40.0 },
  "gemini-pro": { input: 1.25, output: 5.0 },
  "gemini-flash": { input: 0.075, output: 0.3 },
  "default": { input: 3.0, output: 15.0 },         // Fallback = Sonnet tier
};

function classifyModel(model: string): ModelPricing {
  const m = model.toLowerCase();

  // Claude models
  if (m.includes("opus")) {
    // opus-4-5 or opus-4-6 → low tier; opus-3 / opus-4 / opus-4-1 → high tier
    if (m.includes("4-5") || m.includes("4-6") || m.includes("4.5") || m.includes("4.6")) {
      return TIERS["opus-low"];
    }
    return TIERS["opus-high"];
  }
  if (m.includes("sonnet")) return TIERS["sonnet"];
  if (m.includes("haiku")) {
    if (m.includes("4-5") || m.includes("4.5") || m.includes("4-6") || m.includes("4.6")) return TIERS["haiku-45"];
    if (m.includes("3-5") || m.includes("3.5")) return TIERS["haiku-35"];
    return TIERS["haiku-3"];
  }

  // OpenAI
  if (m.includes("gpt-4o") || m.includes("gpt4o")) return TIERS["gpt4o"];
  if (m.includes("gpt-4") || m.includes("gpt4")) return TIERS["gpt4"];
  if (m.includes("o3")) return TIERS["o3"];
  if (m.includes("o1")) return TIERS["o1"];

  // Gemini
  if (m.includes("gemini") && m.includes("flash")) return TIERS["gemini-flash"];
  if (m.includes("gemini") && m.includes("pro")) return TIERS["gemini-pro"];

  return TIERS["default"];
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheRead: number = 0,
  cacheWrite: number = 0
): number {
  const tier = classifyModel(model);
  const inputCost = (inputTokens * tier.input) / 1_000_000;
  const cacheReadCost = (cacheRead * tier.input * 0.1) / 1_000_000;
  const cacheWriteCost = (cacheWrite * tier.input * 1.25) / 1_000_000;
  const outputCost = (outputTokens * tier.output) / 1_000_000;
  return inputCost + cacheReadCost + cacheWriteCost + outputCost;
}
