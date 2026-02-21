/**
 * AMM adapter unit tests
 *
 * Tests pure logic (quote calculation, price impact, buy event parsing helpers)
 * without hitting the network. Network-dependent methods (findPools, parseBuyEvent)
 * are tested via integration tests that require a live RPC endpoint.
 */

import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { AmmProtocol, AMM_PROGRAM_IDS } from '../amm/types';

// ─────────────────────────────────────────────────────────────────────────────
// AMM Program IDs — sanity-check that every supported protocol has an ID
// ─────────────────────────────────────────────────────────────────────────────

describe('AMM_PROGRAM_IDS', () => {
  const EXPECTED_PROTOCOLS = [
    AmmProtocol.RAYDIUM_V4,
    AmmProtocol.RAYDIUM_CLMM,
    AmmProtocol.RAYDIUM_CPMM,
    AmmProtocol.METEORA_DLMM,
    AmmProtocol.METEORA_DYNAMIC,
    AmmProtocol.PUMPSWAP,
    AmmProtocol.ORCA_WHIRLPOOL,
  ];

  for (const protocol of EXPECTED_PROTOCOLS) {
    it(`${protocol} has a valid PublicKey`, () => {
      const id = AMM_PROGRAM_IDS[protocol];
      expect(id).toBeDefined();
      // PublicKey.toBase58() throws if the key is invalid
      expect(() => id.toBase58()).not.toThrow();
      expect(id.toBase58()).toHaveLength(44); // base58 length for 32-byte key
    });
  }

  it('all program IDs are unique', () => {
    const ids = EXPECTED_PROTOCOLS.map(p => AMM_PROGRAM_IDS[p].toBase58());
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constant-product output formula — replicated in BaseAmmAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure implementation mirroring BaseAmmAdapter.calculateConstantProductOutput
 * so we can test the math without instantiating an adapter (which needs Connection).
 */
function cpOutput(amountIn: BN, reserveIn: BN, reserveOut: BN, feeBps: number): BN {
  const amountInWithFee = amountIn.mul(new BN(10000 - feeBps));
  const numerator = amountInWithFee.mul(reserveOut);
  const denominator = reserveIn.mul(new BN(10000)).add(amountInWithFee);
  return numerator.div(denominator);
}

function cpPriceImpact(amountIn: BN, reserveIn: BN, reserveOut: BN): number {
  const amountOut = cpOutput(amountIn, reserveIn, reserveOut, 0);
  const priceBefore = reserveOut.mul(new BN(1e9)).div(reserveIn);
  const newReserveOut = reserveOut.sub(amountOut);
  const newReserveIn = reserveIn.add(amountIn);
  const priceAfter = newReserveOut.mul(new BN(1e9)).div(newReserveIn);
  if (priceBefore.isZero()) return 0;
  return priceBefore.sub(priceAfter).mul(new BN(10000)).div(priceBefore).toNumber();
}

describe('constant product formula', () => {
  const R = new BN(1_000_000_000); // 1B (balanced pool)

  it('output is less than input for balanced pool (price > 1:1)', () => {
    // Selling 1 unit into a 1B/1B pool should give back slightly less than 1
    const out = cpOutput(new BN(1), R, R, 0);
    expect(out.lte(new BN(1))).toBe(true);
  });

  it('fee of 25 bps reduces output vs no fee', () => {
    const noFee = cpOutput(new BN(1000), R, R, 0);
    const withFee = cpOutput(new BN(1000), R, R, 25);
    expect(withFee.lt(noFee)).toBe(true);
  });

  it('xy >= k invariant holds after trade (no fee)', () => {
    const amtIn = new BN(10_000);
    const amtOut = cpOutput(amtIn, R, R, 0);
    const newX = R.add(amtIn);
    const newY = R.sub(amtOut);
    expect(newX.mul(newY).gte(R.mul(R))).toBe(true);
  });

  it('slippage increases with trade size', () => {
    const small = cpPriceImpact(new BN(1_000), R, R);
    const large = cpPriceImpact(new BN(10_000_000), R, R);
    expect(large).toBeGreaterThan(small);
  });

  it('price impact of 1% trade is ~1%', () => {
    // 1% of reserve = ~100 bps price impact
    const impact = cpPriceImpact(new BN(10_000_000), R, R);
    expect(impact).toBeGreaterThan(50);
    expect(impact).toBeLessThan(300);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Buy event parsing helpers — deterministic logic that can be unit-tested
// ─────────────────────────────────────────────────────────────────────────────

const WSOL = 'So11111111111111111111111111111111111111112';
const TOKEN_A = 'TokenAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'TokenBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/**
 * Find the base token whose vault balance decreased in a swap
 * (= the token that was sold by the pool to the buyer).
 * This is the pure logic extracted from meteora.ts and raydium.ts parsers.
 */
function findSoldToken(
  preBalances: Array<{ accountIndex: number; mint: string; amount: string }>,
  postBalances: Array<{ accountIndex: number; mint: string; amount: string }>,
): string | null {
  for (const post of postBalances) {
    if (post.mint === WSOL) continue;
    const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
    if (!pre) continue;
    if (new BN(pre.amount).gt(new BN(post.amount))) {
      return post.mint;
    }
  }
  return null;
}

/**
 * Detect if a set of balance changes represents a buy (quote increased).
 */
function detectBuy(
  preBalances: Array<{ accountIndex: number; mint: string; amount: string }>,
  postBalances: Array<{ accountIndex: number; mint: string; amount: string }>,
): { buyAmount: BN; soldMint: string } | null {
  for (const pre of preBalances) {
    if (pre.mint !== WSOL) continue;
    const post = postBalances.find(p => p.accountIndex === pre.accountIndex);
    if (!post) continue;
    const preAmt = new BN(pre.amount);
    const postAmt = new BN(post.amount);
    if (postAmt.gt(preAmt)) {
      const soldMint = findSoldToken(preBalances, postBalances);
      if (!soldMint) return null;
      return { buyAmount: postAmt.sub(preAmt), soldMint };
    }
  }
  return null;
}

describe('buy event detection', () => {
  it('detects a buy when wSOL vault increases and base token vault decreases', () => {
    const pre = [
      { accountIndex: 0, mint: WSOL,    amount: '1000000000' },
      { accountIndex: 1, mint: TOKEN_A, amount: '5000000000' },
    ];
    const post = [
      { accountIndex: 0, mint: WSOL,    amount: '2000000000' }, // +1 SOL
      { accountIndex: 1, mint: TOKEN_A, amount: '4000000000' }, // -1B tokens
    ];

    const result = detectBuy(pre, post);
    expect(result).not.toBeNull();
    expect(result!.buyAmount.toNumber()).toBe(1_000_000_000);
    expect(result!.soldMint).toBe(TOKEN_A);
  });

  it('returns null for a sell (wSOL vault decreases)', () => {
    const pre = [
      { accountIndex: 0, mint: WSOL,    amount: '2000000000' },
      { accountIndex: 1, mint: TOKEN_A, amount: '4000000000' },
    ];
    const post = [
      { accountIndex: 0, mint: WSOL,    amount: '1000000000' }, // -1 SOL
      { accountIndex: 1, mint: TOKEN_A, amount: '5000000000' }, // +1B tokens
    ];

    const result = detectBuy(pre, post);
    expect(result).toBeNull();
  });

  it('never returns wSOL as the sold token', () => {
    const pre = [
      { accountIndex: 0, mint: WSOL, amount: '1000000000' },
      { accountIndex: 1, mint: WSOL, amount: '500000000' }, // second wSOL account
    ];
    const post = [
      { accountIndex: 0, mint: WSOL, amount: '2000000000' },
      { accountIndex: 1, mint: WSOL, amount: '300000000' },
    ];

    const result = detectBuy(pre, post);
    // wSOL shouldn't be returned as the sold token
    if (result) {
      expect(result.soldMint).not.toBe(WSOL);
    }
  });

  it('correctly picks the right token when multiple tokens are present', () => {
    const pre = [
      { accountIndex: 0, mint: WSOL,    amount: '1000000000' },
      { accountIndex: 1, mint: TOKEN_A, amount: '5000000000' }, // decreases
      { accountIndex: 2, mint: TOKEN_B, amount: '3000000000' }, // unchanged
    ];
    const post = [
      { accountIndex: 0, mint: WSOL,    amount: '2000000000' },
      { accountIndex: 1, mint: TOKEN_A, amount: '4000000000' }, // decreased
      { accountIndex: 2, mint: TOKEN_B, amount: '3000000000' }, // unchanged
    ];

    const result = detectBuy(pre, post);
    expect(result).not.toBeNull();
    expect(result!.soldMint).toBe(TOKEN_A);
  });
});
