/**
 * Token pricing data - Updated Jan 2026
 * Source: https://ai.google.dev/gemini-api/docs/pricing
 */

import type { TokenUsage } from '../../types/index.js';

export type { TokenUsage };

export interface ModelPricing {
  input: number;      // per 1M tokens
  output: number;     // per 1M tokens
  cached: number;     // per 1M tokens
  thoughts: number;   // per 1M tokens (billed as output)
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gemini-3-pro-preview': {
    input: 2.00,
    output: 12.00,
    cached: 0.20,
    thoughts: 12.00,
  },
  'gemini-3-flash-preview': {
    input: 0.50,
    output: 3.00,
    cached: 0.05,
    thoughts: 3.00,
  },
  'gemini-2.5-pro': {
    input: 1.25,
    output: 10.00,
    cached: 0.125,
    thoughts: 10.00,
  },
  'gemini-2.5-pro-preview': {
    input: 1.25,
    output: 10.00,
    cached: 0.125,
    thoughts: 10.00,
  },
  'gemini-2.5-flash': {
    input: 0.30,
    output: 2.50,
    cached: 0.03,
    thoughts: 2.50,
  },
  'gemini-2.5-flash-lite': {
    input: 0.10,
    output: 0.40,
    cached: 0.01,
    thoughts: 0.40,
  },
  'gemini-2.0-flash': {
    input: 0.10,
    output: 0.40,
    cached: 0.01,
    thoughts: 0.40,
  },
  'gemini-2.0-flash-exp': {
    input: 0.10,
    output: 0.40,
    cached: 0.01,
    thoughts: 0.40,
  },
  // Default fallback
  'default': {
    input: 0.50,
    output: 3.00,
    cached: 0.05,
    thoughts: 3.00,
  }
};

/**
 * Get pricing for a model, with fallback to default
 */
export function getModelPricing(modelName: string): ModelPricing {
  // Try exact match first
  if (MODEL_PRICING[modelName]) {
    return MODEL_PRICING[modelName];
  }

  // Try partial match
  for (const key of Object.keys(MODEL_PRICING)) {
    if (key.includes(modelName) || modelName.includes(key)) {
      return MODEL_PRICING[key];
    }
  }

  return MODEL_PRICING['default'];
}

export interface CostBreakdown {
  input: number;
  output: number;
  cached: number;
  thoughts: number;
  total: number;
  model: string;
  pricing: ModelPricing;
}

/**
 * Calculate cost for token usage
 */
export function calculateCost(
  usage: TokenUsage,
  model: string = 'default'
): CostBreakdown {
  const pricing = getModelPricing(model);

  // Input tokens: subtract cached from input (cached are billed at lower rate)
  let actualInput = usage.input - usage.cached;
  if (actualInput < 0) actualInput = 0;

  const inputCost = (actualInput / 1_000_000) * pricing.input;
  const outputCost = (usage.output / 1_000_000) * pricing.output;
  const cachedCost = (usage.cached / 1_000_000) * pricing.cached;
  const thoughtsCost = (usage.thoughts / 1_000_000) * pricing.thoughts;

  return {
    input: inputCost,
    output: outputCost,
    cached: cachedCost,
    thoughts: thoughtsCost,
    total: inputCost + outputCost + cachedCost + thoughtsCost,
    model,
    pricing
  };
}

/**
 * Format cost as currency string
 */
export function formatCost(amount: number): string {
  if (amount >= 1.0) {
    return `$${amount.toFixed(2)}`;
  } else if (amount >= 0.01) {
    return `$${amount.toFixed(3)}`;
  } else if (amount >= 0.001) {
    return `$${amount.toFixed(4)}`;
  } else {
    return `$${amount.toFixed(6)}`;
  }
}

/**
 * Format token count with K/M suffix
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  } else if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return String(n);
}
