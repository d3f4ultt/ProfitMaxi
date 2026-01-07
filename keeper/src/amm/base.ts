/**
 * Base AMM Adapter
 * 
 * Abstract base class with common functionality for all AMM adapters.
 */

import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';
import {
  IAmmAdapter,
  AmmProtocol,
  PoolInfo,
  SwapQuote,
  PoolBuyEvent,
} from './types';

/**
 * Base adapter configuration
 */
export interface BaseAdapterConfig {
  connection: Connection;
  programId: PublicKey;
}

/**
 * Abstract base class for AMM adapters
 */
export abstract class BaseAmmAdapter implements IAmmAdapter {
  protected connection: Connection;
  abstract readonly protocol: AmmProtocol;
  readonly programId: PublicKey;

  constructor(config: BaseAdapterConfig) {
    this.connection = config.connection;
    this.programId = config.programId;
  }

  /**
   * Find all pools for a token
   */
  abstract findPools(tokenMint: PublicKey): Promise<PoolInfo[]>;

  /**
   * Get pool info by address
   */
  abstract getPool(poolAddress: PublicKey): Promise<PoolInfo | null>;

  /**
   * Get swap quote
   */
  abstract getSwapQuote(
    pool: PoolInfo,
    amountIn: BN,
    isBuy: boolean,
    slippageBps: number
  ): Promise<SwapQuote>;

  /**
   * Build swap instruction
   */
  abstract buildSwapInstruction(
    quote: SwapQuote,
    user: PublicKey
  ): Promise<TransactionInstruction[]>;

  /**
   * Parse buy event from transaction
   */
  abstract parseBuyEvent(signature: string): Promise<PoolBuyEvent | null>;

  /**
   * Get accounts required for swap CPI
   */
  abstract getSwapAccounts(pool: PoolInfo): Promise<PublicKey[]>;

  /**
   * Check if pool is valid
   */
  async isPoolValid(poolAddress: PublicKey): Promise<boolean> {
    try {
      const pool = await this.getPool(poolAddress);
      return pool !== null && pool.isActive;
    } catch {
      return false;
    }
  }

  /**
   * Calculate constant product output
   * dy = y * dx / (x + dx)
   */
  protected calculateConstantProductOutput(
    amountIn: BN,
    reserveIn: BN,
    reserveOut: BN,
    feeBps: number = 0
  ): BN {
    const amountInWithFee = amountIn.mul(new BN(10000 - feeBps));
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(new BN(10000)).add(amountInWithFee);
    return numerator.div(denominator);
  }

  /**
   * Calculate price impact in basis points
   */
  protected calculatePriceImpact(
    amountIn: BN,
    reserveIn: BN,
    reserveOut: BN
  ): number {
    if (reserveIn.isZero() || reserveOut.isZero()) return 0;

    const spotPrice = reserveOut.mul(new BN(1e9)).div(reserveIn);
    const amountOut = this.calculateConstantProductOutput(amountIn, reserveIn, reserveOut);
    const execPrice = amountOut.mul(new BN(1e9)).div(amountIn);
    
    const impact = spotPrice.sub(execPrice).mul(new BN(10000)).div(spotPrice);
    return Math.abs(impact.toNumber());
  }

  /**
   * Fetch and deserialize account data
   */
  protected async fetchAccount<T>(
    address: PublicKey,
    deserialize: (data: Buffer) => T
  ): Promise<T | null> {
    const accountInfo = await this.connection.getAccountInfo(address);
    if (!accountInfo) return null;
    return deserialize(accountInfo.data);
  }

  /**
   * Get program accounts with filters
   */
  protected async getProgramAccounts(
    filters: { memcmp?: { offset: number; bytes: string }; dataSize?: number }[]
  ): Promise<{ pubkey: PublicKey; data: Buffer }[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters,
    });
    return accounts.map(({ pubkey, account }) => ({
      pubkey,
      data: account.data,
    }));
  }
}
