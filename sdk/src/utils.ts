/**
 * Utility functions for ProfitMaxi SDK
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { BPS_DENOMINATOR, PRICE_PRECISION } from './constants';

/**
 * Calculate sell amount based on trigger buy and delta ratio
 * 
 * @param triggerBuy - Incoming buy amount
 * @param deltaRatioBps - Delta ratio in basis points
 * @param remaining - Remaining order size
 * @returns Calculated sell amount
 */
export function calculateSellAmount(
  triggerBuy: BN,
  deltaRatioBps: number,
  remaining: BN
): BN {
  const proportional = triggerBuy
    .mul(new BN(deltaRatioBps))
    .div(new BN(BPS_DENOMINATOR));
  
  return BN.min(proportional, remaining);
}

/**
 * Calculate tokens to sell for a given quote value
 * 
 * @param quoteValue - Value in quote currency
 * @param tokenReserve - Pool token reserve
 * @param quoteReserve - Pool quote reserve
 * @returns Number of tokens
 */
export function calculateTokensForQuote(
  quoteValue: BN,
  tokenReserve: BN,
  quoteReserve: BN
): BN {
  if (quoteReserve.isZero()) {
    throw new Error('Quote reserve cannot be zero');
  }
  
  return quoteValue.mul(tokenReserve).div(quoteReserve);
}

/**
 * Calculate expected AMM output (constant product)
 * 
 * @param amountIn - Input amount
 * @param reserveIn - Input reserve
 * @param reserveOut - Output reserve
 * @param feeBps - Fee in basis points (default 30 = 0.3%)
 * @returns Expected output amount
 */
export function calculateAmmOutput(
  amountIn: BN,
  reserveIn: BN,
  reserveOut: BN,
  feeBps: number = 30
): BN {
  if (reserveIn.isZero() || reserveOut.isZero()) {
    throw new Error('Reserves cannot be zero');
  }
  
  const amountInWithFee = amountIn.mul(new BN(BPS_DENOMINATOR - feeBps));
  const numerator = amountInWithFee.mul(reserveOut);
  const denominator = reserveIn.mul(new BN(BPS_DENOMINATOR)).add(amountInWithFee);
  
  return numerator.div(denominator);
}

/**
 * Calculate price impact in basis points
 * 
 * @param amountIn - Input amount
 * @param reserveIn - Input reserve
 * @param reserveOut - Output reserve
 * @returns Price impact in basis points
 */
export function calculatePriceImpact(
  amountIn: BN,
  reserveIn: BN,
  reserveOut: BN
): number {
  if (reserveIn.isZero() || reserveOut.isZero()) {
    return 0;
  }
  
  const amountOut = calculateAmmOutput(amountIn, reserveIn, reserveOut, 0);
  
  // Price before = reserveOut / reserveIn
  const priceBefore = reserveOut.mul(new BN(PRICE_PRECISION)).div(reserveIn);
  
  // Price after = (reserveOut - amountOut) / (reserveIn + amountIn)
  const newReserveOut = reserveOut.sub(amountOut);
  const newReserveIn = reserveIn.add(amountIn);
  const priceAfter = newReserveOut.mul(new BN(PRICE_PRECISION)).div(newReserveIn);
  
  // Impact = (priceBefore - priceAfter) / priceBefore * 10000
  const impact = priceBefore.sub(priceAfter)
    .mul(new BN(BPS_DENOMINATOR))
    .div(priceBefore);
  
  return impact.toNumber();
}

/**
 * Calculate weighted average price
 * 
 * @param prevAvg - Previous average price
 * @param prevVolume - Previous total volume
 * @param newPrice - New execution price
 * @param newVolume - New execution volume
 * @returns Updated weighted average
 */
export function calculateWeightedAvgPrice(
  prevAvg: BN,
  prevVolume: BN,
  newPrice: BN,
  newVolume: BN
): BN {
  const totalVolume = prevVolume.add(newVolume);
  
  if (totalVolume.isZero()) {
    return new BN(0);
  }
  
  const weightedSum = prevAvg.mul(prevVolume).add(newPrice.mul(newVolume));
  return weightedSum.div(totalVolume);
}

/**
 * Calculate keeper fee
 * 
 * @param sellAmount - Sell amount
 * @param keeperFeeBps - Fee in basis points
 * @returns Keeper fee
 */
export function calculateKeeperFee(sellAmount: BN, keeperFeeBps: number): BN {
  return sellAmount.mul(new BN(keeperFeeBps)).div(new BN(BPS_DENOMINATOR));
}

/**
 * Calculate protocol fee
 * 
 * @param sellAmount - Sell amount
 * @param protocolFeeBps - Fee in basis points
 * @returns Protocol fee
 */
export function calculateProtocolFee(sellAmount: BN, protocolFeeBps: number): BN {
  return sellAmount.mul(new BN(protocolFeeBps)).div(new BN(BPS_DENOMINATOR));
}

/**
 * Convert delta ratio to percentage string
 * 
 * @param deltaRatioBps - Delta ratio in basis points
 * @returns Formatted percentage string
 */
export function deltaRatioToPercent(deltaRatioBps: number): string {
  return `${(deltaRatioBps / 100).toFixed(2)}%`;
}

/**
 * Convert percentage to delta ratio
 * 
 * @param percent - Percentage (0-100)
 * @returns Delta ratio in basis points
 */
export function percentToDeltaRatio(percent: number): number {
  return Math.round(percent * 100);
}

/**
 * Format lamports to SOL
 * 
 * @param lamports - Amount in lamports
 * @returns Formatted SOL string
 */
export function formatSol(lamports: BN | number): string {
  const bn = new BN(lamports);
  const sol = bn.toNumber() / 1e9;
  return sol.toLocaleString(undefined, { maximumFractionDigits: 9 });
}

/**
 * Parse SOL to lamports
 * 
 * @param sol - Amount in SOL
 * @returns Lamports as BN
 */
export function parseSol(sol: number): BN {
  return new BN(Math.round(sol * 1e9));
}

/**
 * Estimate fill time based on historical data
 * 
 * @param remaining - Remaining order size
 * @param avgBuyVolume - Average buy volume per time unit
 * @param deltaRatioBps - Delta ratio
 * @returns Estimated fill time in time units
 */
export function estimateFillTime(
  remaining: BN,
  avgBuyVolume: BN,
  deltaRatioBps: number
): number {
  if (avgBuyVolume.isZero() || deltaRatioBps === 0) {
    return Infinity;
  }
  
  const effectiveVolume = avgBuyVolume
    .mul(new BN(deltaRatioBps))
    .div(new BN(BPS_DENOMINATOR));
  
  return remaining.div(effectiveVolume).toNumber();
}

/**
 * Validate delta ratio
 * 
 * @param deltaRatioBps - Delta ratio in basis points
 * @throws If invalid
 */
export function validateDeltaRatio(deltaRatioBps: number): void {
  if (deltaRatioBps < 1 || deltaRatioBps > 10000) {
    throw new Error('Delta ratio must be between 1 and 10000 basis points');
  }
}

/**
 * Validate order size
 * 
 * @param size - Order size in lamports
 * @throws If invalid
 */
export function validateOrderSize(size: BN | number): void {
  const bn = new BN(size);
  if (bn.lt(new BN(1_000_000))) {
    throw new Error('Order size must be at least 0.001 SOL');
  }
  if (bn.gt(new BN('1000000000000000'))) {
    throw new Error('Order size exceeds maximum');
  }
}

/**
 * Check if a public key is a valid Solana address
 * 
 * @param address - Address string
 * @returns True if valid
 */
export function isValidAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sleep for a specified duration
 * 
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
