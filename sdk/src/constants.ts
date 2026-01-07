/**
 * Constants for ProfitMaxi SDK
 */

import { PublicKey } from '@solana/web3.js';

// Program ID (update after deployment)
export const PROFITMAXI_PROGRAM_ID = new PublicKey(
  'PrftMx1111111111111111111111111111111111111'
);

// PDA Seeds
export const CONFIG_SEED = Buffer.from('config');
export const ORDER_SEED = Buffer.from('order');
export const ESCROW_SEED = Buffer.from('escrow');
export const KEEPER_SEED = Buffer.from('keeper');
export const FEE_VAULT_SEED = Buffer.from('fee_vault');

// Basis points denominator
export const BPS_DENOMINATOR = 10_000;

// Delta ratio bounds
export const MIN_DELTA_RATIO_BPS = 1;
export const MAX_DELTA_RATIO_BPS = 10_000;

// Fee bounds
export const MAX_PROTOCOL_FEE_BPS = 1_000; // 10%
export const MAX_KEEPER_FEE_BPS = 500;     // 5%
export const DEFAULT_PROTOCOL_FEE_BPS = 10; // 0.1%
export const DEFAULT_KEEPER_FEE_BPS = 10;   // 0.1%

// Price precision
export const PRICE_PRECISION = 1_000_000_000;

// Order limits
export const MIN_ORDER_SIZE = 1_000_000;           // 0.001 SOL
export const MAX_ORDER_SIZE = 1_000_000_000_000_000; // 1M SOL
export const MIN_THRESHOLD = 100_000;              // 0.0001 SOL

// Known AMM Program IDs
export const AMM_PROGRAMS = {
  RAYDIUM_V4: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
  RAYDIUM_CLMM: new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'),
  ORCA_WHIRLPOOL: new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'),
  METEORA_DLMM: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
} as const;

// Common Token Mints
export const TOKEN_MINTS = {
  WSOL: new PublicKey('So11111111111111111111111111111111111111112'),
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  USDT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
} as const;

// Compute Budget Units
export const COMPUTE_UNITS = {
  CREATE_ORDER: 100_000,
  EXECUTE_SHARD: 300_000,
  CANCEL_ORDER: 50_000,
  UPDATE_ORDER: 30_000,
} as const;
