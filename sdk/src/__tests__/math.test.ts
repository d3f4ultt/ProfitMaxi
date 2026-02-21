/**
 * SDK math utility tests
 *
 * These test the TypeScript equivalents of the Rust utility functions.
 * They must stay in sync with the on-chain calculations in utils.rs.
 */

import BN from 'bn.js';
import {
  calculateSellAmount,
  calculateTokensForQuote,
  calculateAmmOutput,
  calculatePriceImpact,
  calculateWeightedAvgPrice,
  calculateKeeperFee,
  calculateProtocolFee,
  validateDeltaRatio,
  validateOrderSize,
} from '../utils';

// ─────────────────────────────────────────────────────────────────────────────
// calculateSellAmount
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateSellAmount', () => {
  it('r=1.0 (100%): sell == trigger', () => {
    const result = calculateSellAmount(new BN(100), 10000, new BN(1000));
    expect(result.toNumber()).toBe(100);
  });

  it('r=0.8 (80%): sells 80% of trigger', () => {
    const result = calculateSellAmount(new BN(100), 8000, new BN(1000));
    expect(result.toNumber()).toBe(80);
  });

  it('r=0.5 (50%): sells 50% of trigger', () => {
    const result = calculateSellAmount(new BN(100), 5000, new BN(1000));
    expect(result.toNumber()).toBe(50);
  });

  it('caps at remaining when proportional exceeds it', () => {
    const result = calculateSellAmount(new BN(100), 10000, new BN(50));
    expect(result.toNumber()).toBe(50);
  });

  it('returns 0 when remaining is 0', () => {
    const result = calculateSellAmount(new BN(100), 5000, new BN(0));
    expect(result.toNumber()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calculateTokensForQuote
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateTokensForQuote', () => {
  it('1:1 pool: 1 SOL of tokens = 1 SOL worth of tokens', () => {
    const result = calculateTokensForQuote(
      new BN(1_000_000_000), // 1 SOL
      new BN(1_000_000_000), // 1B token reserve
      new BN(1_000_000_000), // 1B quote reserve
    );
    expect(result.toNumber()).toBe(1_000_000_000);
  });

  it('10:1 token pool: 1 SOL buys 10 tokens worth', () => {
    // 10B tokens, 1B quote → price = 0.1 SOL/token → 1 SOL = 10 tokens
    const result = calculateTokensForQuote(
      new BN(1_000_000_000),
      new BN(10_000_000_000),
      new BN(1_000_000_000),
    );
    expect(result.toNumber()).toBe(10_000_000_000);
  });

  it('throws on zero quote reserve', () => {
    expect(() =>
      calculateTokensForQuote(new BN(100), new BN(1000), new BN(0))
    ).toThrow();
  });

  it('escrow is proportional to order size, not user balance', () => {
    // A 1 SOL order on a pool with 1M tokens / 1 SOL should escrow 1M tokens
    const orderSizeLamports = new BN(1_000_000_000);
    const poolTokenReserve = new BN(1_000_000_000_000); // 1M tokens (6 decimals)
    const poolQuoteReserve = new BN(1_000_000_000);     // 1 SOL

    const escrowed = calculateTokensForQuote(
      orderSizeLamports,
      poolTokenReserve,
      poolQuoteReserve,
    );

    // Should equal all pool tokens (order = 100% of pool value at this price)
    expect(escrowed.toString()).toBe(poolTokenReserve.toString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calculateAmmOutput — constant product formula
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateAmmOutput', () => {
  it('balanced pool, no fee: output ≈ input for small trades', () => {
    // 1000/1000 pool, sell 10 → expect ~9.9
    const out = calculateAmmOutput(new BN(10), new BN(1000), new BN(1000), 0);
    expect(out.toNumber()).toBeGreaterThanOrEqual(9);
    expect(out.toNumber()).toBeLessThanOrEqual(10);
  });

  it('fee reduces output', () => {
    const noFee = calculateAmmOutput(new BN(10), new BN(1000), new BN(1000), 0);
    const withFee = calculateAmmOutput(new BN(10), new BN(1000), new BN(1000), 30);
    expect(withFee.lt(noFee)).toBe(true);
  });

  it('throws on zero reserve', () => {
    expect(() =>
      calculateAmmOutput(new BN(10), new BN(0), new BN(1000), 30)
    ).toThrow();
  });

  it('constant product invariant holds approximately', () => {
    const rIn = new BN(1_000_000);
    const rOut = new BN(1_000_000);
    const amtIn = new BN(1000);
    const amtOut = calculateAmmOutput(amtIn, rIn, rOut, 0);

    // (x + dx)(y - dy) >= xy
    const newX = rIn.add(amtIn);
    const newY = rOut.sub(amtOut);
    expect(newX.mul(newY).gte(rIn.mul(rOut))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calculatePriceImpact
// ─────────────────────────────────────────────────────────────────────────────

describe('calculatePriceImpact', () => {
  it('tiny trade has near-zero impact', () => {
    const impact = calculatePriceImpact(
      new BN(1),
      new BN(1_000_000_000),
      new BN(1_000_000_000),
    );
    expect(impact).toBeLessThan(10); // < 0.1%
  });

  it('large trade has significant impact', () => {
    // Buying 10% of the reserve should move price noticeably
    const impact = calculatePriceImpact(
      new BN(100_000),
      new BN(1_000_000),
      new BN(1_000_000),
    );
    expect(impact).toBeGreaterThan(500); // > 5%
  });

  it('returns 0 on empty reserves', () => {
    const impact = calculatePriceImpact(new BN(100), new BN(0), new BN(1000));
    expect(impact).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calculateWeightedAvgPrice
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateWeightedAvgPrice', () => {
  it('first trade sets the average', () => {
    const avg = calculateWeightedAvgPrice(
      new BN(0), new BN(0), new BN(10), new BN(100)
    );
    expect(avg.toNumber()).toBe(10);
  });

  it('two equal-volume trades average the prices', () => {
    const avg = calculateWeightedAvgPrice(
      new BN(10), new BN(100), new BN(20), new BN(100)
    );
    expect(avg.toNumber()).toBe(15);
  });

  it('higher-volume trade has more weight', () => {
    // 100 units @ 10, then 900 units @ 20 → weighted avg ≈ 19
    const avg = calculateWeightedAvgPrice(
      new BN(10), new BN(100), new BN(20), new BN(900)
    );
    expect(avg.toNumber()).toBe(19);
  });

  it('returns 0 when total volume is 0', () => {
    const avg = calculateWeightedAvgPrice(
      new BN(0), new BN(0), new BN(0), new BN(0)
    );
    expect(avg.toNumber()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fee calculations — must mirror on-chain bps math
// ─────────────────────────────────────────────────────────────────────────────

describe('fee calculations', () => {
  it('keeper fee at 10 bps = 0.1% of quote', () => {
    const fee = calculateKeeperFee(new BN(1_000_000), 10);
    expect(fee.toNumber()).toBe(1_000); // 0.1%
  });

  it('protocol fee at 10 bps = 0.1% of quote', () => {
    const fee = calculateProtocolFee(new BN(1_000_000), 10);
    expect(fee.toNumber()).toBe(1_000);
  });

  it('keeper + protocol fees do not exceed net quote at default rates', () => {
    const quote = new BN(1_000_000_000); // 1 SOL
    const keeperFee = calculateKeeperFee(quote, 10);
    const protocolFee = calculateProtocolFee(quote, 10);
    const net = quote.sub(keeperFee).sub(protocolFee);
    expect(net.gt(new BN(0))).toBe(true);
    expect(net.toNumber()).toBe(998_000_000); // 1 SOL - 0.2%
  });

  it('zero fee bps returns zero fee', () => {
    expect(calculateKeeperFee(new BN(1_000_000), 0).toNumber()).toBe(0);
    expect(calculateProtocolFee(new BN(1_000_000), 0).toNumber()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

describe('validateDeltaRatio', () => {
  it('accepts valid range', () => {
    expect(() => validateDeltaRatio(1)).not.toThrow();
    expect(() => validateDeltaRatio(5000)).not.toThrow();
    expect(() => validateDeltaRatio(10000)).not.toThrow();
  });

  it('rejects 0', () => {
    expect(() => validateDeltaRatio(0)).toThrow();
  });

  it('rejects > 10000', () => {
    expect(() => validateDeltaRatio(10001)).toThrow();
  });
});

describe('validateOrderSize', () => {
  it('accepts valid sizes', () => {
    expect(() => validateOrderSize(new BN(1_000_000))).not.toThrow();
    expect(() => validateOrderSize(new BN(1_000_000_000))).not.toThrow();
  });

  it('rejects below minimum (< 0.001 SOL)', () => {
    expect(() => validateOrderSize(new BN(999_999))).toThrow();
  });

  it('rejects above maximum', () => {
    expect(() => validateOrderSize(new BN('9999999999999999'))).toThrow();
  });
});
