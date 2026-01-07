/**
 * Type definitions for ProfitMaxi SDK
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

/**
 * Order status enumeration
 */
export enum OrderStatus {
  Active = 0,
  Paused = 1,
  Filled = 2,
  Cancelled = 3,
}

/**
 * Supported AMM types
 */
export enum AmmType {
  RaydiumV4 = 'raydium_v4',
  RaydiumClmm = 'raydium_clmm',
  OrcaWhirlpool = 'orca_whirlpool',
  MeteoraDlmm = 'meteora_dlmm',
}

/**
 * Protocol configuration
 */
export interface ConfigAccount {
  admin: PublicKey;
  protocolFeeBps: number;
  keeperFeeBps: number;
  totalFeesCollected: BN;
  totalOrders: BN;
  totalShardsExecuted: BN;
  totalVolume: BN;
  isPaused: boolean;
  bump: number;
}

/**
 * Order account data
 */
export interface OrderAccount {
  owner: PublicKey;
  tokenMint: PublicKey;
  quoteMint: PublicKey;
  ammPool: PublicKey;
  ammProgram: PublicKey;
  totalSize: BN;
  remaining: BN;
  escrowedTokens: BN;
  deltaRatioBps: number;
  minThreshold: BN;
  createdAt: BN;
  lastExecutedAt: BN;
  totalFills: number;
  totalQuoteReceived: BN;
  avgExecutionPrice: BN;
  status: OrderStatus;
  orderId: BN;
  bump: number;
}

/**
 * Keeper account data
 */
export interface KeeperAccount {
  authority: PublicKey;
  shardsExecuted: BN;
  volumeProcessed: BN;
  feesEarned: BN;
  registeredAt: BN;
  lastActiveAt: BN;
  isActive: boolean;
  bump: number;
}

/**
 * Create order parameters
 */
export interface CreateOrderParams {
  /** Total order size in quote currency (lamports) */
  totalSize: BN | number;
  /** Delta ratio in basis points (1-10000) */
  deltaRatioBps: number;
  /** Minimum buy size to trigger (lamports) */
  minThreshold: BN | number;
  /** Token mint to sell */
  tokenMint: PublicKey;
  /** Quote mint (SOL/USDC) */
  quoteMint: PublicKey;
  /** AMM pool address */
  ammPool: PublicKey;
  /** AMM program ID */
  ammProgram: PublicKey;
}

/**
 * Execute shard parameters
 */
export interface ExecuteShardParams {
  /** Order public key */
  order: PublicKey;
  /** Triggering buy amount (lamports) */
  triggerBuyLamports: BN | number;
  /** Minimum tokens to receive (slippage protection) */
  minAmountOut: BN | number;
}

/**
 * Update order parameters
 */
export interface UpdateOrderParams {
  /** Order public key */
  order: PublicKey;
  /** New delta ratio (optional) */
  newDeltaRatioBps?: number;
  /** New minimum threshold (optional) */
  newMinThreshold?: BN | number;
}

/**
 * Order created event
 */
export interface OrderCreatedEvent {
  order: PublicKey;
  owner: PublicKey;
  tokenMint: PublicKey;
  quoteMint: PublicKey;
  ammPool: PublicKey;
  totalSize: BN;
  tokensEscrowed: BN;
  deltaRatioBps: number;
  minThreshold: BN;
  orderId: BN;
  timestamp: BN;
}

/**
 * Shard executed event
 */
export interface ShardExecutedEvent {
  order: PublicKey;
  owner: PublicKey;
  triggerBuy: BN;
  sellAmount: BN;
  tokensSold: BN;
  quoteReceived: BN;
  executionPrice: BN;
  remaining: BN;
  keeper: PublicKey;
  keeperFee: BN;
  protocolFee: BN;
  fillNumber: number;
  timestamp: BN;
}

/**
 * Order filled event
 */
export interface OrderFilledEvent {
  order: PublicKey;
  owner: PublicKey;
  totalSize: BN;
  totalQuoteReceived: BN;
  avgExecutionPrice: BN;
  totalFills: number;
  fillDuration: BN;
  timestamp: BN;
}

/**
 * Simulation result
 */
export interface SimulationResult {
  expectedSellAmount: BN;
  expectedTokensOut: BN;
  priceImpactBps: number;
  estimatedFees: {
    keeper: BN;
    protocol: BN;
  };
}

/**
 * Order statistics
 */
export interface OrderStats {
  fillPercentage: number;
  avgPrice: number;
  totalFees: BN;
  timeElapsed: number;
  estimatedTimeRemaining: number;
}
