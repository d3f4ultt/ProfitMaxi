/**
 * Pool Aggregator
 * 
 * Aggregates pools across all supported AMMs, discovers the best pools for a token,
 * and ranks them based on liquidity, age, volume, and fees.
 * 
 * @author Justin Liverman (d3f4ult) - Mezzanine DAO
 */

import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
  IAmmAdapter,
  AmmProtocol,
  PoolInfo,
  PoolScore,
  SwapQuote,
  PoolBuyEvent,
  PoolDiscoveryOptions,
  DEFAULT_QUOTE_MINTS,
} from './types';
import { RaydiumV4Adapter, RaydiumCpmmAdapter } from './raydium';
import { PumpSwapAdapter } from './pumpswap';
import { MeteoraAdapter, MeteoraDynamicAdapter } from './meteora';

/**
 * Pool with computed score
 */
export interface RankedPool extends PoolInfo {
  score: PoolScore;
  rank: number;
}

/**
 * Best pool selection result
 */
export interface BestPoolResult {
  /** Primary pool (highest ranked) */
  primary: RankedPool;
  /** All discovered pools, ranked */
  all: RankedPool[];
  /** Pools by protocol */
  byProtocol: Map<AmmProtocol, RankedPool[]>;
}

/**
 * Pool aggregator configuration
 */
export interface PoolAggregatorConfig {
  connection: Connection;
  /** Protocols to enable */
  enabledProtocols?: AmmProtocol[];
  /** Weight for liquidity in scoring (default: 0.4) */
  liquidityWeight?: number;
  /** Weight for age in scoring (default: 0.3) */
  ageWeight?: number;
  /** Weight for volume in scoring (default: 0.2) */
  volumeWeight?: number;
  /** Weight for fees in scoring (default: 0.1) */
  feeWeight?: number;
}

/**
 * Default protocol list
 */
const DEFAULT_PROTOCOLS: AmmProtocol[] = [
  AmmProtocol.RAYDIUM_V4,
  AmmProtocol.RAYDIUM_CPMM,
  AmmProtocol.PUMPSWAP,
  AmmProtocol.METEORA_DLMM,
];

/**
 * Pool Aggregator
 * 
 * Unified interface for discovering and ranking pools across all AMMs.
 */
export class PoolAggregator {
  private connection: Connection;
  private adapters: Map<AmmProtocol, IAmmAdapter>;
  private weights: {
    liquidity: number;
    age: number;
    volume: number;
    fee: number;
  };
  /** Tracks signatures already processed to prevent duplicate event callbacks. */
  private processedSignatures: Set<string> = new Set();

  constructor(config: PoolAggregatorConfig) {
    this.connection = config.connection;
    this.adapters = new Map();
    
    // Set scoring weights
    this.weights = {
      liquidity: config.liquidityWeight ?? 0.4,
      age: config.ageWeight ?? 0.3,
      volume: config.volumeWeight ?? 0.2,
      fee: config.feeWeight ?? 0.1,
    };

    // Initialize enabled adapters
    const protocols = config.enabledProtocols ?? DEFAULT_PROTOCOLS;
    this.initializeAdapters(protocols);
  }

  /**
   * Initialize AMM adapters
   */
  private initializeAdapters(protocols: AmmProtocol[]): void {
    for (const protocol of protocols) {
      switch (protocol) {
        case AmmProtocol.RAYDIUM_V4:
          this.adapters.set(protocol, new RaydiumV4Adapter(this.connection));
          break;
        case AmmProtocol.RAYDIUM_CPMM:
          this.adapters.set(protocol, new RaydiumCpmmAdapter(this.connection));
          break;
        case AmmProtocol.PUMPSWAP:
          this.adapters.set(protocol, new PumpSwapAdapter(this.connection));
          break;
        case AmmProtocol.METEORA_DLMM:
          this.adapters.set(protocol, new MeteoraAdapter(this.connection));
          break;
        case AmmProtocol.METEORA_DYNAMIC:
          this.adapters.set(protocol, new MeteoraDynamicAdapter(this.connection));
          break;
      }
    }
  }

  /**
   * Discover all pools for a token across all enabled AMMs
   */
  async discoverPools(
    tokenMint: PublicKey,
    options?: PoolDiscoveryOptions
  ): Promise<PoolInfo[]> {
    const allPools: PoolInfo[] = [];
    const protocols = options?.protocols ?? Array.from(this.adapters.keys());

    // Query each adapter in parallel
    const poolPromises = protocols.map(async (protocol) => {
      const adapter = this.adapters.get(protocol);
      if (!adapter) return [];

      try {
        return await adapter.findPools(tokenMint);
      } catch (error) {
        console.error(`Failed to find pools on ${protocol}: ${error}`);
        return [];
      }
    });

    const results = await Promise.all(poolPromises);
    for (const pools of results) {
      allPools.push(...pools);
    }

    // Apply filters
    return this.filterPools(allPools, options);
  }

  /**
   * Filter pools based on options
   */
  private filterPools(
    pools: PoolInfo[],
    options?: PoolDiscoveryOptions
  ): PoolInfo[] {
    return pools.filter((pool) => {
      // Filter by minimum liquidity
      if (options?.minLiquidity && pool.liquidity.lt(options.minLiquidity)) {
        return false;
      }

      // Filter by minimum age
      if (options?.minAge) {
        const now = Math.floor(Date.now() / 1000);
        const age = now - pool.createdAt;
        if (age < options.minAge) return false;
      }

      // Filter by maximum fee
      if (options?.maxFeeBps && pool.feeBps > options.maxFeeBps) {
        return false;
      }

      // Filter by quote mint
      if (options?.quoteMints && options.quoteMints.length > 0) {
        if (!options.quoteMints.some((m) => m.equals(pool.quoteMint))) {
          return false;
        }
      }

      // Must be active
      if (!pool.isActive) return false;

      return true;
    });
  }

  /**
   * Find the best pool for a token
   */
  async findBestPool(
    tokenMint: PublicKey,
    options?: PoolDiscoveryOptions
  ): Promise<BestPoolResult | null> {
    const pools = await this.discoverPools(tokenMint, options);
    if (pools.length === 0) return null;

    // Rank all pools
    const rankedPools = this.rankPools(pools);

    // Group by protocol
    const byProtocol = new Map<AmmProtocol, RankedPool[]>();
    for (const pool of rankedPools) {
      const list = byProtocol.get(pool.protocol) || [];
      list.push(pool);
      byProtocol.set(pool.protocol, list);
    }

    return {
      primary: rankedPools[0],
      all: rankedPools,
      byProtocol,
    };
  }

  /**
   * Rank pools by composite score
   */
  rankPools(pools: PoolInfo[]): RankedPool[] {
    if (pools.length === 0) return [];

    // Calculate normalization factors
    const maxLiquidity = pools.reduce(
      (max, p) => BN.max(max, p.liquidity),
      new BN(0)
    );
    const maxAge = pools.reduce(
      (max, p) => Math.max(max, Date.now() / 1000 - p.createdAt),
      0
    );
    const maxVolume = pools.reduce(
      (max, p) => BN.max(max, p.volume24h || new BN(0)),
      new BN(0)
    );
    const maxFee = pools.reduce((max, p) => Math.max(max, p.feeBps), 0);

    // Score each pool
    const scored: RankedPool[] = pools.map((pool) => {
      const score = this.calculateScore(pool, {
        maxLiquidity,
        maxAge,
        maxVolume,
        maxFee,
      });

      return {
        ...pool,
        score,
        rank: 0, // Set after sorting
      };
    });

    // Sort by total score descending
    scored.sort((a, b) => b.score.total - a.score.total);

    // Assign ranks
    scored.forEach((pool, index) => {
      pool.rank = index + 1;
    });

    return scored;
  }

  /**
   * Calculate composite score for a pool
   */
  private calculateScore(
    pool: PoolInfo,
    normalization: {
      maxLiquidity: BN;
      maxAge: number;
      maxVolume: BN;
      maxFee: number;
    }
  ): PoolScore {
    const { maxLiquidity, maxAge, maxVolume, maxFee } = normalization;

    // Liquidity score (0-100)
    const liquidityScore = maxLiquidity.gt(new BN(0))
      ? pool.liquidity.mul(new BN(100)).div(maxLiquidity).toNumber()
      : 0;

    // Age score (0-100) - older is better
    const age = Date.now() / 1000 - pool.createdAt;
    const ageScore = maxAge > 0 ? (age / maxAge) * 100 : 0;

    // Volume score (0-100)
    const volume = pool.volume24h || new BN(0);
    const volumeScore = maxVolume.gt(new BN(0))
      ? volume.mul(new BN(100)).div(maxVolume).toNumber()
      : 0;

    // Fee score (0-100) - lower is better
    const feeScore = maxFee > 0 ? ((maxFee - pool.feeBps) / maxFee) * 100 : 100;

    // Weighted total
    const total =
      liquidityScore * this.weights.liquidity +
      ageScore * this.weights.age +
      volumeScore * this.weights.volume +
      feeScore * this.weights.fee;

    return {
      total,
      liquidityScore,
      ageScore,
      volumeScore,
      feeScore,
    };
  }

  /**
   * Get the primary pool for a token
   * 
   * Primary pool is determined by:
   * 1. Highest liquidity
   * 2. Oldest creation date
   * 3. Highest 24h volume
   */
  async getPrimaryPool(tokenMint: PublicKey): Promise<PoolInfo | null> {
    const result = await this.findBestPool(tokenMint);
    return result?.primary || null;
  }

  /**
   * Get swap quote from best pool
   */
  async getBestQuote(
    tokenMint: PublicKey,
    amountIn: BN,
    isBuy: boolean,
    slippageBps: number = 100
  ): Promise<SwapQuote | null> {
    const result = await this.findBestPool(tokenMint);
    if (!result) return null;

    const adapter = this.adapters.get(result.primary.protocol);
    if (!adapter) return null;

    return adapter.getSwapQuote(result.primary, amountIn, isBuy, slippageBps);
  }

  /**
   * Get quotes from all pools and find best execution
   */
  async getAllQuotes(
    tokenMint: PublicKey,
    amountIn: BN,
    isBuy: boolean,
    slippageBps: number = 100
  ): Promise<SwapQuote[]> {
    const result = await this.findBestPool(tokenMint);
    if (!result) return [];

    const quotes: SwapQuote[] = [];

    for (const pool of result.all) {
      const adapter = this.adapters.get(pool.protocol);
      if (!adapter) continue;

      try {
        const quote = await adapter.getSwapQuote(pool, amountIn, isBuy, slippageBps);
        quotes.push(quote);
      } catch (error) {
        console.error(`Failed to get quote from ${pool.protocol}: ${error}`);
      }
    }

    // Sort by output amount descending (best execution first)
    quotes.sort((a, b) => b.amountOut.cmp(a.amountOut));

    return quotes;
  }

  /**
   * Subscribe to buy events across all pools for a token
   */
  async subscribeToBuyEvents(
    tokenMint: PublicKey,
    callback: (event: PoolBuyEvent) => void
  ): Promise<number[]> {
    const result = await this.findBestPool(tokenMint);
    if (!result) return [];

    const subscriptionIds: number[] = [];

    for (const pool of result.all) {
      // Subscribe to each pool's account changes
      const subId = this.connection.onAccountChange(
        pool.address,
        async (accountInfo, context) => {
          // When pool state changes, check for buy
          const adapter = this.adapters.get(pool.protocol);
          if (!adapter) return;

          // Get recent signatures for this pool
          const signatures = await this.connection.getSignaturesForAddress(
            pool.address,
            { limit: 5 }
          );

          for (const sig of signatures) {
            // Skip signatures we have already processed to prevent duplicate callbacks
            if (this.processedSignatures.has(sig.signature)) continue;
            this.processedSignatures.add(sig.signature);

            const event = await adapter.parseBuyEvent(sig.signature);
            if (event && event.slot === context.slot) {
              callback(event);
            }
          }

          // Periodically prune the deduplication set to prevent unbounded growth
          if (this.processedSignatures.size > 10_000) {
            const oldest = Array.from(this.processedSignatures).slice(0, 5_000);
            oldest.forEach(s => this.processedSignatures.delete(s));
          }
        },
        'confirmed'
      );

      subscriptionIds.push(subId);
    }

    return subscriptionIds;
  }

  /**
   * Get adapter for a specific protocol
   */
  getAdapter(protocol: AmmProtocol): IAmmAdapter | undefined {
    return this.adapters.get(protocol);
  }

  /**
   * Check if a pool is the primary pool for its token
   */
  async isPrimaryPool(poolAddress: PublicKey): Promise<boolean> {
    // Get pool info to find token
    for (const adapter of this.adapters.values()) {
      const pool = await adapter.getPool(poolAddress);
      if (pool) {
        const primary = await this.getPrimaryPool(pool.baseMint);
        return primary?.address.equals(poolAddress) || false;
      }
    }
    return false;
  }

  /**
   * Get pool info from any adapter
   */
  async getPool(poolAddress: PublicKey): Promise<PoolInfo | null> {
    for (const adapter of this.adapters.values()) {
      const pool = await adapter.getPool(poolAddress);
      if (pool) return pool;
    }
    return null;
  }

  /**
   * Parse buy event from any adapter
   */
  async parseBuyEvent(signature: string): Promise<PoolBuyEvent | null> {
    for (const adapter of this.adapters.values()) {
      const event = await adapter.parseBuyEvent(signature);
      if (event) return event;
    }
    return null;
  }

  /**
   * Get statistics across all adapters
   */
  async getAggregateStats(tokenMint: PublicKey): Promise<{
    totalPools: number;
    totalLiquidity: BN;
    protocolBreakdown: Map<AmmProtocol, number>;
    primaryPool: PoolInfo | null;
  }> {
    const result = await this.findBestPool(tokenMint);
    
    if (!result) {
      return {
        totalPools: 0,
        totalLiquidity: new BN(0),
        protocolBreakdown: new Map(),
        primaryPool: null,
      };
    }

    const totalLiquidity = result.all.reduce(
      (sum, pool) => sum.add(pool.liquidity),
      new BN(0)
    );

    const protocolBreakdown = new Map<AmmProtocol, number>();
    for (const [protocol, pools] of result.byProtocol) {
      protocolBreakdown.set(protocol, pools.length);
    }

    return {
      totalPools: result.all.length,
      totalLiquidity,
      protocolBreakdown,
      primaryPool: result.primary,
    };
  }
}

/**
 * Create a pool aggregator with default settings
 */
export function createPoolAggregator(connection: Connection): PoolAggregator {
  return new PoolAggregator({ connection });
}
