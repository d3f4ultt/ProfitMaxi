/**
 * ProfitMaxi Multi-DEX Keeper Service
 * 
 * Monitors AMM pools across Raydium, PumpSwap, and Meteora
 * for qualifying buys and executes ProfitMaxi orders.
 * 
 * @author Justin Liverman (d3f4ult) - Mezzanine DAO
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  VersionedTransaction,
} from '@solana/web3.js';
import BN from 'bn.js';
import { createLogger, format, transports } from 'winston';
import * as dotenv from 'dotenv';

// Import the AMM module from the shared SDK rather than the local duplicate.
// The keeper's keeper/src/amm/ directory is kept only for backward compatibility;
// new code should import from '@profitmaxi/sdk'.
import {
  PoolAggregator,
  createPoolAggregator,
  PoolBuyEvent,
  AmmProtocol,
  PoolInfo,
  RankedPool,
} from '@profitmaxi/sdk';

dotenv.config();

// Logger
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.colorize(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'keeper.log' }),
  ],
});

/**
 * Order data structure (matches on-chain)
 */
interface OrderAccount {
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
  status: number;
  orderId: BN;
}

/**
 * Token pool mapping
 */
interface TokenPoolMapping {
  tokenMint: PublicKey;
  primaryPool: RankedPool;
  allPools: RankedPool[];
  lastUpdated: number;
}

/**
 * Multi-DEX Keeper Configuration
 */
export interface MultiDexKeeperConfig {
  rpcEndpoint: string;
  keypair: Keypair;
  pollInterval: number;
  minProfitThreshold: BN;
  maxConcurrent: number;
  jitoEndpoint?: string;
  dryRun: boolean;
  /** Protocols to monitor */
  enabledProtocols?: AmmProtocol[];
  /** How often to refresh pool rankings (ms) */
  poolRefreshInterval?: number;
  /** Minimum pool liquidity to consider */
  minPoolLiquidity?: BN;
}

/**
 * Multi-DEX Keeper Service
 */
export class MultiDexKeeperService {
  private connection: Connection;
  private config: MultiDexKeeperConfig;
  private aggregator: PoolAggregator;
  
  // State
  private activeOrders: Map<string, OrderAccount> = new Map();
  private tokenPoolMappings: Map<string, TokenPoolMapping> = new Map();
  private isRunning: boolean = false;
  private subscriptionIds: number[] = [];
  
  // Metrics
  private metrics = {
    shardsExecuted: 0,
    totalVolume: new BN(0),
    totalProfit: new BN(0),
    failedExecutions: 0,
    buysDetected: 0,
  };

  constructor(config: MultiDexKeeperConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcEndpoint, {
      commitment: 'confirmed',
      wsEndpoint: config.rpcEndpoint.replace('https://', 'wss://'),
    });
    
    this.aggregator = new PoolAggregator({
      connection: this.connection,
      enabledProtocols: config.enabledProtocols,
    });
  }

  /**
   * Start the keeper service
   */
  async start(): Promise<void> {
    logger.info('╔══════════════════════════════════════════════════════════╗');
    logger.info('║        ProfitMaxi Multi-DEX Keeper Service               ║');
    logger.info('╚══════════════════════════════════════════════════════════╝');
    logger.info(`Keeper: ${this.config.keypair.publicKey.toBase58()}`);
    logger.info(`RPC: ${this.config.rpcEndpoint}`);
    logger.info(`Protocols: ${this.config.enabledProtocols?.join(', ') || 'All'}`);
    logger.info(`Dry run: ${this.config.dryRun}`);

    // Load active orders
    await this.loadActiveOrders();

    // Discover pools for all order tokens
    await this.discoverAllPools();

    // Start monitoring
    this.isRunning = true;
    await this.startMonitoring();

    // Start pool refresh loop
    this.startPoolRefreshLoop();

    logger.info('Keeper service started successfully');
  }

  /**
   * Stop the keeper service
   */
  async stop(): Promise<void> {
    logger.info('Stopping keeper service...');
    this.isRunning = false;

    for (const id of this.subscriptionIds) {
      await this.connection.removeOnLogsListener(id);
    }
    this.subscriptionIds = [];

    this.logMetrics();
    logger.info('Keeper service stopped');
  }

  /**
   * Load all active orders from the program
   */
  private async loadActiveOrders(): Promise<void> {
    logger.info('Loading active orders...');
    
    // Fetch all order accounts
    // In production, use getProgramAccounts with proper filters
    
    logger.info(`Loaded ${this.activeOrders.size} active orders`);
  }

  /**
   * Discover pools for all tokens with active orders
   */
  private async discoverAllPools(): Promise<void> {
    logger.info('Discovering pools across all DEXes...');

    const uniqueTokens = new Set<string>();
    for (const order of this.activeOrders.values()) {
      uniqueTokens.add(order.tokenMint.toBase58());
    }

    for (const tokenMintStr of uniqueTokens) {
      const tokenMint = new PublicKey(tokenMintStr);
      await this.discoverPoolsForToken(tokenMint);
    }

    logger.info(`Discovered pools for ${uniqueTokens.size} tokens`);
    this.logPoolSummary();
  }

  /**
   * Discover and rank pools for a specific token
   */
  private async discoverPoolsForToken(tokenMint: PublicKey): Promise<void> {
    try {
      const result = await this.aggregator.findBestPool(tokenMint, {
        minLiquidity: this.config.minPoolLiquidity,
        quoteMints: [
          new PublicKey('So11111111111111111111111111111111111111112'), // SOL
        ],
      });

      if (!result) {
        logger.warn(`No pools found for ${tokenMint.toBase58()}`);
        return;
      }

      this.tokenPoolMappings.set(tokenMint.toBase58(), {
        tokenMint,
        primaryPool: result.primary,
        allPools: result.all,
        lastUpdated: Date.now(),
      });

      logger.info(
        `Token ${tokenMint.toBase58().slice(0, 8)}... - ` +
        `${result.all.length} pools found, ` +
        `primary: ${result.primary.protocol} ` +
        `(liquidity: ${this.formatSol(result.primary.liquidity)} SOL)`
      );

    } catch (error) {
      logger.error(`Failed to discover pools for ${tokenMint.toBase58()}: ${error}`);
    }
  }

  /**
   * Start monitoring pools for buy events
   */
  private async startMonitoring(): Promise<void> {
    logger.info('Starting pool monitoring...');

    // Subscribe to each token's primary pool
    for (const [tokenMintStr, mapping] of this.tokenPoolMappings) {
      await this.subscribeToPool(mapping.primaryPool);
      
      // Optionally monitor secondary pools too
      for (const pool of mapping.allPools.slice(1, 3)) {
        await this.subscribeToPool(pool);
      }
    }

    // Start backup polling loop
    this.startPollingLoop();
  }

  /**
   * Subscribe to a specific pool for events
   */
  private async subscribeToPool(pool: PoolInfo): Promise<void> {
    const subId = this.connection.onAccountChange(
      pool.address,
      async (accountInfo, context) => {
        await this.handlePoolChange(pool, context.slot);
      },
      'confirmed'
    );
    
    this.subscriptionIds.push(subId);
    logger.debug(`Subscribed to ${pool.protocol} pool: ${pool.address.toBase58().slice(0, 8)}...`);
  }

  /**
   * Handle pool state change
   */
  private async handlePoolChange(pool: PoolInfo, slot: number): Promise<void> {
    try {
      // Get recent signatures for this pool
      const signatures = await this.connection.getSignaturesForAddress(
        pool.address,
        { limit: 3 }
      );

      for (const sig of signatures) {
        // Try to parse as buy event
        const event = await this.aggregator.parseBuyEvent(sig.signature);
        if (event) {
          await this.handleBuyEvent(event);
        }
      }
    } catch (error) {
      logger.error(`Error handling pool change: ${error}`);
    }
  }

  /**
   * Handle detected buy event
   */
  private async handleBuyEvent(event: PoolBuyEvent): Promise<void> {
    this.metrics.buysDetected++;
    
    logger.debug(
      `Buy detected on ${event.protocol}: ` +
      `${this.formatSol(event.buyAmount)} SOL for ${event.tokenMint.toBase58().slice(0, 8)}...`
    );

    // Find matching orders
    const matchingOrders = this.findMatchingOrders(event);

    for (const order of matchingOrders) {
      // Check threshold
      if (event.buyAmount.lt(order.minThreshold)) {
        continue;
      }

      // Calculate sell amount
      const sellAmount = this.calculateSellAmount(event.buyAmount, order.deltaRatioBps, order.remaining);
      
      logger.info(
        `Order ${order.orderId.toString()} triggered: ` +
        `buy=${this.formatSol(event.buyAmount)}, ` +
        `sell=${this.formatSol(sellAmount)} (r=${order.deltaRatioBps/100}%)`
      );

      // Execute shard
      await this.executeShard(order, event, sellAmount);
    }
  }

  /**
   * Find orders matching a buy event
   */
  private findMatchingOrders(event: PoolBuyEvent): OrderAccount[] {
    const matches: OrderAccount[] = [];

    for (const order of this.activeOrders.values()) {
      // Match by token
      if (!order.tokenMint.equals(event.tokenMint)) continue;
      
      // Check if order is active
      if (order.status !== 0) continue;
      
      // Check if order has remaining size
      if (order.remaining.lte(new BN(0))) continue;

      // Check if this pool is valid for the order
      // (primary pool or any monitored pool)
      const mapping = this.tokenPoolMappings.get(order.tokenMint.toBase58());
      if (!mapping) continue;

      const isValidPool = mapping.allPools.some(p => p.address.equals(event.pool));
      if (!isValidPool) continue;

      matches.push(order);
    }

    return matches;
  }

  /**
   * Calculate sell amount based on delta ratio
   */
  private calculateSellAmount(triggerBuy: BN, deltaRatioBps: number, remaining: BN): BN {
    const proportional = triggerBuy.mul(new BN(deltaRatioBps)).div(new BN(10000));
    return BN.min(proportional, remaining);
  }

  /**
   * Execute a shard for an order
   */
  private async executeShard(
    order: OrderAccount,
    event: PoolBuyEvent,
    sellAmount: BN
  ): Promise<void> {
    try {
      // Get best quote for selling
      const quote = await this.aggregator.getBestQuote(
        order.tokenMint,
        sellAmount,
        false, // selling (not buying)
        100 // 1% slippage
      );

      if (!quote) {
        logger.error(`No quote available for order ${order.orderId}`);
        return;
      }

      logger.info(
        `Executing on ${quote.pool.protocol}: ` +
        `sell ${this.formatSol(sellAmount)} ` +
        `for ${this.formatSol(quote.amountOut)} ` +
        `(impact: ${quote.priceImpactBps / 100}%)`
      );

      if (this.config.dryRun) {
        logger.info('[DRY RUN] Would execute shard');
        return;
      }

      // Build and send transaction
      // ... (actual execution logic)

      this.metrics.shardsExecuted++;
      this.metrics.totalVolume = this.metrics.totalVolume.add(sellAmount);

    } catch (error) {
      logger.error(`Shard execution failed: ${error}`);
      this.metrics.failedExecutions++;
    }
  }

  /**
   * Start backup polling loop
   */
  private startPollingLoop(): void {
    const poll = async () => {
      if (!this.isRunning) return;

      try {
        await this.pollAllPools();
      } catch (error) {
        logger.error(`Polling error: ${error}`);
      }

      setTimeout(poll, this.config.pollInterval);
    };

    poll();
  }

  /**
   * Poll all pools for recent transactions
   */
  private async pollAllPools(): Promise<void> {
    for (const mapping of this.tokenPoolMappings.values()) {
      for (const pool of mapping.allPools.slice(0, 3)) {
        try {
          const signatures = await this.connection.getSignaturesForAddress(
            pool.address,
            { limit: 5 }
          );

          for (const sig of signatures) {
            const event = await this.aggregator.parseBuyEvent(sig.signature);
            if (event) {
              await this.handleBuyEvent(event);
            }
          }
        } catch (error) {
          // Ignore individual pool errors
        }
      }
    }
  }

  /**
   * Start pool refresh loop
   */
  private startPoolRefreshLoop(): void {
    const refreshInterval = this.config.poolRefreshInterval || 60000; // 1 min default

    const refresh = async () => {
      if (!this.isRunning) return;

      try {
        await this.refreshPoolRankings();
      } catch (error) {
        logger.error(`Pool refresh error: ${error}`);
      }

      setTimeout(refresh, refreshInterval);
    };

    // Start after initial delay
    setTimeout(refresh, refreshInterval);
  }

  /**
   * Refresh pool rankings for all tokens
   */
  private async refreshPoolRankings(): Promise<void> {
    logger.debug('Refreshing pool rankings...');

    for (const [tokenMintStr, mapping] of this.tokenPoolMappings) {
      const tokenMint = new PublicKey(tokenMintStr);
      
      // Skip if recently updated
      if (Date.now() - mapping.lastUpdated < 30000) continue;

      await this.discoverPoolsForToken(tokenMint);
    }
  }

  /**
   * Log pool summary
   */
  private logPoolSummary(): void {
    const protocolCounts: Record<string, number> = {};

    for (const mapping of this.tokenPoolMappings.values()) {
      for (const pool of mapping.allPools) {
        protocolCounts[pool.protocol] = (protocolCounts[pool.protocol] || 0) + 1;
      }
    }

    logger.info('Pool distribution:');
    for (const [protocol, count] of Object.entries(protocolCounts)) {
      logger.info(`  ${protocol}: ${count} pools`);
    }
  }

  /**
   * Log metrics
   */
  private logMetrics(): void {
    logger.info('═══════════════════════════════════════');
    logger.info('Session Metrics:');
    logger.info(`  Shards executed: ${this.metrics.shardsExecuted}`);
    logger.info(`  Total volume: ${this.formatSol(this.metrics.totalVolume)} SOL`);
    logger.info(`  Total profit: ${this.formatSol(this.metrics.totalProfit)} SOL`);
    logger.info(`  Failed executions: ${this.metrics.failedExecutions}`);
    logger.info(`  Buys detected: ${this.metrics.buysDetected}`);
    logger.info('═══════════════════════════════════════');
  }

  /**
   * Format BN as SOL
   */
  private formatSol(lamports: BN): string {
    return (lamports.toNumber() / 1e9).toFixed(4);
  }

  /**
   * Get service status
   */
  getStatus(): object {
    return {
      isRunning: this.isRunning,
      activeOrders: this.activeOrders.size,
      tokensMonitored: this.tokenPoolMappings.size,
      subscriptions: this.subscriptionIds.length,
      metrics: this.metrics,
    };
  }
}

// CLI entry point
if (require.main === module) {
  const keypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(process.env.KEEPER_PRIVATE_KEY || '[]'))
  );

  const config: MultiDexKeeperConfig = {
    rpcEndpoint: process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
    keypair,
    pollInterval: parseInt(process.env.POLL_INTERVAL || '1000'),
    minProfitThreshold: new BN(process.env.MIN_PROFIT || '10000'),
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '5'),
    jitoEndpoint: process.env.JITO_ENDPOINT,
    dryRun: process.env.DRY_RUN === 'true',
    enabledProtocols: [
      AmmProtocol.RAYDIUM_V4,
      AmmProtocol.RAYDIUM_CPMM,
      AmmProtocol.PUMPSWAP,
      AmmProtocol.METEORA_DLMM,
    ],
    poolRefreshInterval: 60000,
    minPoolLiquidity: new BN(process.env.MIN_POOL_LIQUIDITY || '100000000000'), // 100 SOL
  };

  const keeper = new MultiDexKeeperService(config);

  keeper.start().catch((error) => {
    logger.error(`Failed to start keeper: ${error}`);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await keeper.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await keeper.stop();
    process.exit(0);
  });
}

export default MultiDexKeeperService;
