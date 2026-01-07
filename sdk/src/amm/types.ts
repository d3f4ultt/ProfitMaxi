/**
 * AMM Adapter Interface
 * 
 * Unified interface for interacting with different AMM protocols.
 * Each AMM (Raydium, Meteora, PumpSwap) implements this interface.
 * 
 * @author Justin Liverman (d3f4ult) - Mezzanine DAO
 */

import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';

/**
 * Supported AMM protocols
 */
export enum AmmProtocol {
  /** Raydium AMM V4 (CPMM) */
  RAYDIUM_V4 = 'raydium_v4',
  /** Raydium CLMM (Concentrated Liquidity) */
  RAYDIUM_CLMM = 'raydium_clmm',
  /** Raydium CPMM (New) */
  RAYDIUM_CPMM = 'raydium_cpmm',
  /** Meteora DLMM */
  METEORA_DLMM = 'meteora_dlmm',
  /** Meteora Dynamic Pools */
  METEORA_DYNAMIC = 'meteora_dynamic',
  /** PumpSwap (pump.fun AMM) */
  PUMPSWAP = 'pumpswap',
  /** Orca Whirlpool */
  ORCA_WHIRLPOOL = 'orca_whirlpool',
}

/**
 * AMM Program IDs on Solana Mainnet
 */
export const AMM_PROGRAM_IDS: Record<AmmProtocol, PublicKey> = {
  [AmmProtocol.RAYDIUM_V4]: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
  [AmmProtocol.RAYDIUM_CLMM]: new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'),
  [AmmProtocol.RAYDIUM_CPMM]: new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'),
  [AmmProtocol.METEORA_DLMM]: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
  [AmmProtocol.METEORA_DYNAMIC]: new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB'),
  [AmmProtocol.PUMPSWAP]: new PublicKey('PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP'),
  [AmmProtocol.ORCA_WHIRLPOOL]: new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'),
};

/**
 * Pool information structure
 */
export interface PoolInfo {
  /** Pool address */
  address: PublicKey;
  /** AMM protocol */
  protocol: AmmProtocol;
  /** Base token mint (the token being traded) */
  baseMint: PublicKey;
  /** Quote token mint (SOL/USDC) */
  quoteMint: PublicKey;
  /** Base token reserve */
  baseReserve: BN;
  /** Quote token reserve */
  quoteReserve: BN;
  /** Pool creation timestamp */
  createdAt: number;
  /** Current liquidity in quote terms */
  liquidity: BN;
  /** 24h volume in quote terms */
  volume24h?: BN;
  /** Fee rate in basis points */
  feeBps: number;
  /** LP token mint */
  lpMint?: PublicKey;
  /** Whether pool is active */
  isActive: boolean;
  /** Pool-specific extra data */
  extra?: Record<string, any>;
}

/**
 * Pool ranking score components
 */
export interface PoolScore {
  /** Overall score (higher = better) */
  total: number;
  /** Liquidity score component */
  liquidityScore: number;
  /** Age score component */
  ageScore: number;
  /** Volume score component */
  volumeScore: number;
  /** Fee score component (lower fees = higher score) */
  feeScore: number;
}

/**
 * Swap quote result
 */
export interface SwapQuote {
  /** Input amount */
  amountIn: BN;
  /** Expected output amount */
  amountOut: BN;
  /** Minimum output (with slippage) */
  minAmountOut: BN;
  /** Price impact in basis points */
  priceImpactBps: number;
  /** Fee amount */
  feeAmount: BN;
  /** Execution price */
  executionPrice: BN;
  /** Pool used */
  pool: PoolInfo;
}

/**
 * Swap execution result
 */
export interface SwapResult {
  /** Transaction signature */
  signature: string;
  /** Actual amount out */
  amountOut: BN;
  /** Actual fee paid */
  feePaid: BN;
  /** Slot executed */
  slot: number;
}

/**
 * Buy event detected from pool
 */
export interface PoolBuyEvent {
  /** Pool address */
  pool: PublicKey;
  /** Protocol */
  protocol: AmmProtocol;
  /** Token being bought */
  tokenMint: PublicKey;
  /** Buy amount in quote currency */
  buyAmount: BN;
  /** Transaction signature */
  signature: string;
  /** Slot number */
  slot: number;
  /** Timestamp */
  timestamp: number;
  /** Buyer address */
  buyer?: PublicKey;
}

/**
 * AMM Adapter Interface
 * 
 * Each AMM protocol must implement this interface.
 */
export interface IAmmAdapter {
  /** Protocol identifier */
  readonly protocol: AmmProtocol;
  /** Program ID */
  readonly programId: PublicKey;

  /**
   * Find all pools for a token
   * @param tokenMint - The token to find pools for
   * @returns Array of pool info
   */
  findPools(tokenMint: PublicKey): Promise<PoolInfo[]>;

  /**
   * Get pool info by address
   * @param poolAddress - Pool public key
   * @returns Pool info or null
   */
  getPool(poolAddress: PublicKey): Promise<PoolInfo | null>;

  /**
   * Get swap quote
   * @param pool - Pool to use
   * @param amountIn - Input amount
   * @param isBuy - True if buying base token, false if selling
   * @param slippageBps - Slippage tolerance in basis points
   * @returns Swap quote
   */
  getSwapQuote(
    pool: PoolInfo,
    amountIn: BN,
    isBuy: boolean,
    slippageBps: number
  ): Promise<SwapQuote>;

  /**
   * Build swap instruction
   * @param quote - Swap quote
   * @param user - User public key
   * @returns Transaction instructions
   */
  buildSwapInstruction(
    quote: SwapQuote,
    user: PublicKey
  ): Promise<TransactionInstruction[]>;

  /**
   * Parse pool transaction logs for buy events
   * @param signature - Transaction signature
   * @returns Buy event if detected, null otherwise
   */
  parseBuyEvent(signature: string): Promise<PoolBuyEvent | null>;

  /**
   * Get required accounts for swap CPI
   * @param pool - Pool info
   * @returns Account metas for CPI
   */
  getSwapAccounts(pool: PoolInfo): Promise<PublicKey[]>;

  /**
   * Check if pool is valid and active
   * @param poolAddress - Pool address
   * @returns True if pool can be used
   */
  isPoolValid(poolAddress: PublicKey): Promise<boolean>;
}

/**
 * Pool discovery and ranking options
 */
export interface PoolDiscoveryOptions {
  /** Minimum liquidity threshold */
  minLiquidity?: BN;
  /** Minimum age in seconds */
  minAge?: number;
  /** Maximum fee in basis points */
  maxFeeBps?: number;
  /** Protocols to search */
  protocols?: AmmProtocol[];
  /** Quote mints to accept */
  quoteMints?: PublicKey[];
}

/**
 * Default quote mints (SOL, USDC, USDT)
 */
export const DEFAULT_QUOTE_MINTS = [
  new PublicKey('So11111111111111111111111111111111111111112'), // WSOL
  new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // USDC
  new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'), // USDT
];
