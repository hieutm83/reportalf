import { describe, expect, it } from 'vitest';
import { returnRateValue } from '../src/source-dashboard';

describe('return/refund rate', () => {
  it('falls back to all orders when TikTok eligible history is incomplete', () => {
    expect(returnRateValue({ returns: 1, returnEligibleOrders: 1, totalOrders: 247, returnRate: 1 })).toBeCloseTo(100 / 247, 8);
  });

  it('keeps the eligible-order denominator when the population is credible', () => {
    expect(returnRateValue({ returns: 4, returnEligibleOrders: 211, totalOrders: 311 })).toBeCloseTo(400 / 211, 8);
  });
});
