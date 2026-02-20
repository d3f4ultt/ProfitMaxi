/**
 * ProfitMaxi SDK
 * 
 * TypeScript SDK for interacting with the ProfitMaxi protocol.
 * Volume-Sensitive Limit Orders for AMM Liquidity Pools.
 * 
 * @author Justin Liverman (d3f4ult) - Mezzanine DAO
 * @license MIT
 */

export * from './client';
export * from './types';
export * from './constants';
export * from './utils';
export * from './instructions';
// Export the AMM module so the keeper (and other consumers) can import from
// '@profitmaxi/sdk' instead of maintaining their own duplicate copy.
export * from './amm';
