/**
 * USD per million tokens, as published by Anthropic. Cache writes bill at 1.25x the input
 * rate and cache reads at 0.1x. Kept here rather than inlined so the run cost shown in the
 * UI can be checked against the price list in one place.
 */
interface ModelPricing {
  input: number;
  output: number;
}

const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
};

/** Offered in the UI. The extraction endpoint accepts nothing outside this list. */
export const SELECTABLE_MODELS = [
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-opus-5", label: "Opus 5" },
] as const;

export const DEFAULT_MODEL = "claude-sonnet-5";

export function isSelectableModel(model: string): boolean {
  return SELECTABLE_MODELS.some((m) => m.id === model);
}

export function priceLabel(model: string): string {
  const price = PRICING[model];
  return price ? `$${price.input} / $${price.output} pro Mio.` : "";
}

const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
}

/** Returns USD, or null for a model with no published rate on file. */
export function estimateCostUsd(model: string, usage: Usage): number | null {
  const price = PRICING[model];
  if (!price) return null;

  const cacheRead = usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  // inputTokens is the total; cached reads and writes are billed at their own rates.
  const uncached = Math.max(
    (usage.inputTokens ?? 0) - cacheRead - cacheWrite,
    0,
  );

  const usd =
    (uncached * price.input +
      cacheWrite * price.input * CACHE_WRITE_MULTIPLIER +
      cacheRead * price.input * CACHE_READ_MULTIPLIER +
      (usage.outputTokens ?? 0) * price.output) /
    1_000_000;

  return usd;
}

export function formatUsd(usd: number): string {
  return usd < 0.01 ? `<$0.01` : `$${usd.toFixed(2)}`;
}
