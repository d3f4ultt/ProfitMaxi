/**
 * Meteora DLMM Adapter
 * 
 * Adapter for Meteora's Dynamic Liquidity Market Maker (DLMM) pools.
 * DLMM uses concentrated liquidity bins for improved capital efficiency.
 * 
 * @author Justin Liverman (d3f4ult) - Mezzanine DAO
 */

import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import { BaseAmmAdapter } from './base';
import {
  AmmProtocol,
  AMM_PROGRAM_IDS,
  PoolInfo,
  SwapQuote,
  PoolBuyEvent,
} from './types';

/**
 * Meteora Program IDs
 */
export const METEORA_DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
export const METEORA_DYNAMIC_PROGRAM_ID = new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');

/**
 * Meteora DLMM Pool State (LbPair)
 */
interface MeteoraLbPairState {
  parameters: {
    baseFactor: number;
    filterPeriod: number;
    decayPeriod: number;
    reductionFactor: number;
    variableFeeControl: number;
    protocolShare: number;
    maxVolatilityAccumulator: number;
  };
  vParameters: {
    volatilityAccumulator: number;
    volatilityReference: number;
    indexReference: number;
    padding: number[];
    lastUpdateTimestamp: BN;
    padding2: number[];
  };
  bumpSeed: number[];
  binStepSeed: number[];
  pairType: number;
  activeId: number;
  binStep: number;
  status: number;
  requireBaseFactorSeed: number;
  baseFactorSeed: number[];
  padding1: number;
  tokenXMint: PublicKey;
  tokenYMint: PublicKey;
  reserveX: PublicKey;
  reserveY: PublicKey;
  protocolFee: {
    amountX: BN;
    amountY: BN;
  };
  feeOwner: PublicKey;
  rewardInfos: any[];
  oracle: PublicKey;
  binArrayBitmap: BN[];
  lastUpdatedAt: BN;
  whitelistedWallet: PublicKey;
  preActivationSwapAddress: PublicKey;
  baseKey: PublicKey;
  activationType: number;
  creatorAlpha: number;
}

/**
 * Meteora DLMM Adapter
 */
export class MeteoraAdapter extends BaseAmmAdapter {
  readonly protocol = AmmProtocol.METEORA_DLMM;

  constructor(connection: Connection) {
    super({
      connection,
      programId: METEORA_DLMM_PROGRAM_ID,
    });
  }

  async findPools(tokenMint: PublicKey): Promise<PoolInfo[]> {
    const pools: PoolInfo[] = [];

    // Search for pools with token as X
    const xMintAccounts = await this.getProgramAccounts([
      { dataSize: 904 }, // LbPair size
      { memcmp: { offset: 72, bytes: tokenMint.toBase58() } }, // tokenXMint offset
    ]);

    for (const { pubkey, data } of xMintAccounts) {
      const pool = await this.parsePool(pubkey, data);
      if (pool) pools.push(pool);
    }

    // Search for pools with token as Y
    const yMintAccounts = await this.getProgramAccounts([
      { dataSize: 904 },
      { memcmp: { offset: 104, bytes: tokenMint.toBase58() } }, // tokenYMint offset
    ]);

    for (const { pubkey, data } of yMintAccounts) {
      const pool = await this.parsePool(pubkey, data);
      if (pool && !pools.find(p => p.address.equals(pubkey))) {
        pools.push(pool);
      }
    }

    return pools;
  }

  async getPool(poolAddress: PublicKey): Promise<PoolInfo | null> {
    const accountInfo = await this.connection.getAccountInfo(poolAddress);
    if (!accountInfo) return null;
    return this.parsePool(poolAddress, accountInfo.data);
  }

  private async parsePool(address: PublicKey, data: Buffer): Promise<PoolInfo | null> {
    try {
      if (data.length < 904) return null;

      // Parse DLMM pool state (simplified)
      const status = data.readUInt8(67);
      if (status !== 1) return null; // Not active

      const binStep = data.readUInt16LE(65);
      const activeId = data.readInt32LE(61);
      
      const tokenXMint = new PublicKey(data.slice(72, 104));
      const tokenYMint = new PublicKey(data.slice(104, 136));
      const reserveX = new PublicKey(data.slice(136, 168));
      const reserveY = new PublicKey(data.slice(168, 200));

      // Fetch reserves
      const [xAccount, yAccount] = await Promise.all([
        this.connection.getTokenAccountBalance(reserveX),
        this.connection.getTokenAccountBalance(reserveY),
      ]);

      const baseReserve = new BN(xAccount.value.amount);
      const quoteReserve = new BN(yAccount.value.amount);

      // DLMM fees vary based on volatility, use base fee
      const baseFactor = data.readUInt16LE(8);
      const feeBps = Math.ceil((baseFactor * binStep) / 10000);

      // Get creation time from oracle or estimate
      const lastUpdatedAt = new BN(data.slice(872, 880), 'le');

      return {
        address,
        protocol: AmmProtocol.METEORA_DLMM,
        baseMint: tokenXMint,
        quoteMint: tokenYMint,
        baseReserve,
        quoteReserve,
        createdAt: lastUpdatedAt.toNumber(), // Approximate
        liquidity: quoteReserve.mul(new BN(2)),
        feeBps,
        isActive: true,
        extra: {
          reserveX,
          reserveY,
          binStep,
          activeId,
          baseFactor,
        },
      };
    } catch (error) {
      console.error(`Failed to parse Meteora pool: ${error}`);
      return null;
    }
  }

  async getSwapQuote(
    pool: PoolInfo,
    amountIn: BN,
    isBuy: boolean,
    slippageBps: number
  ): Promise<SwapQuote> {
    const extra = pool.extra as {
      binStep: number;
      activeId: number;
    };

    // DLMM uses bin-based pricing
    // For simplicity, use effective constant product approximation
    const reserveIn = isBuy ? pool.quoteReserve : pool.baseReserve;
    const reserveOut = isBuy ? pool.baseReserve : pool.quoteReserve;

    // Calculate output with dynamic fee
    const effectiveFee = this.calculateDynamicFee(pool, amountIn);
    const amountOut = this.calculateConstantProductOutput(
      amountIn,
      reserveIn,
      reserveOut,
      effectiveFee
    );

    const minAmountOut = amountOut
      .mul(new BN(10000 - slippageBps))
      .div(new BN(10000));

    return {
      amountIn,
      amountOut,
      minAmountOut,
      priceImpactBps: this.calculatePriceImpact(amountIn, reserveIn, reserveOut),
      feeAmount: amountIn.mul(new BN(effectiveFee)).div(new BN(10000)),
      executionPrice: amountOut.mul(new BN(1e9)).div(amountIn),
      pool,
    };
  }

  /**
   * Calculate dynamic fee based on volatility
   */
  private calculateDynamicFee(pool: PoolInfo, amountIn: BN): number {
    const extra = pool.extra as {
      binStep: number;
      baseFactor: number;
    };

    // Base fee = baseFactor * binStep / 10000
    const baseFee = (extra.baseFactor * extra.binStep) / 10000;
    
    // Variable fee based on volatility (simplified)
    // In production, would calculate from volatility accumulator
    const variableFee = 0;

    return Math.ceil(baseFee + variableFee);
  }

  async buildSwapInstruction(
    quote: SwapQuote,
    user: PublicKey
  ): Promise<TransactionInstruction[]> {
    const { pool } = quote;
    const extra = pool.extra as {
      reserveX: PublicKey;
      reserveY: PublicKey;
      activeId: number;
    };

    // Build DLMM swap instruction
    const data = Buffer.alloc(25);
    data.writeUInt8(1, 0); // Swap discriminator
    quote.amountIn.toArrayLike(Buffer, 'le', 8).copy(data, 1);
    quote.minAmountOut.toArrayLike(Buffer, 'le', 8).copy(data, 9);
    data.writeInt32LE(extra.activeId, 17); // Active bin ID
    data.writeUInt8(1, 21); // Swap for Y (buying base with quote)

    // Get user ATAs
    const userTokenXAta = await this.getUserAta(user, pool.baseMint);
    const userTokenYAta = await this.getUserAta(user, pool.quoteMint);

    // Get bin arrays for current active range
    const binArrays = await this.getBinArraysForSwap(pool, extra.activeId);

    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: pool.address, isSigner: false, isWritable: true },
        { pubkey: user, isSigner: true, isWritable: false },
        { pubkey: extra.reserveX, isSigner: false, isWritable: true },
        { pubkey: extra.reserveY, isSigner: false, isWritable: true },
        { pubkey: userTokenXAta, isSigner: false, isWritable: true },
        { pubkey: userTokenYAta, isSigner: false, isWritable: true },
        { pubkey: pool.baseMint, isSigner: false, isWritable: false },
        { pubkey: pool.quoteMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        // Bin arrays would be added here
        ...binArrays.map(ba => ({
          pubkey: ba,
          isSigner: false,
          isWritable: true,
        })),
      ],
      data,
    });

    return [instruction];
  }

  /**
   * Get bin arrays needed for swap
   */
  private async getBinArraysForSwap(
    pool: PoolInfo,
    activeId: number
  ): Promise<PublicKey[]> {
    // Calculate bin array indices for active range
    const binArrayIndex = Math.floor(activeId / 70); // 70 bins per array
    
    const binArrays: PublicKey[] = [];
    
    // Get surrounding bin arrays
    for (let i = -1; i <= 1; i++) {
      const index = binArrayIndex + i;
      const [binArray] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('bin_array'),
          pool.address.toBuffer(),
          Buffer.from(new Int32Array([index]).buffer),
        ],
        this.programId
      );
      binArrays.push(binArray);
    }

    return binArrays;
  }

  async parseBuyEvent(signature: string): Promise<PoolBuyEvent | null> {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta) return null;

      // Check for Meteora program
      const programIds = tx.transaction.message.accountKeys.map(k =>
        typeof k === 'string' ? k : k.pubkey.toBase58()
      );

      if (!programIds.includes(this.programId.toBase58())) {
        return null;
      }

      // Parse balance changes
      const preBalances = tx.meta.preTokenBalances || [];
      const postBalances = tx.meta.postTokenBalances || [];

      for (const pre of preBalances) {
        const post = postBalances.find(p => p.accountIndex === pre.accountIndex);
        if (!post) continue;

        const preAmount = new BN(pre.uiTokenAmount.amount);
        const postAmount = new BN(post.uiTokenAmount.amount);

        // Detect buy: Y reserve (quote) increased
        if (postAmount.gt(preAmount) &&
            pre.mint === 'So11111111111111111111111111111111111111112') {
          const buyAmount = postAmount.sub(preAmount);

          return {
            pool: new PublicKey(pre.owner || ''),
            protocol: AmmProtocol.METEORA_DLMM,
            tokenMint: new PublicKey(pre.mint),
            buyAmount,
            signature,
            slot: tx.slot,
            timestamp: tx.blockTime || 0,
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  async getSwapAccounts(pool: PoolInfo): Promise<PublicKey[]> {
    const extra = pool.extra as {
      reserveX: PublicKey;
      reserveY: PublicKey;
    };

    return [
      pool.address,
      extra.reserveX,
      extra.reserveY,
      pool.baseMint,
      pool.quoteMint,
    ];
  }

  /**
   * Get user's associated token account
   */
  private async getUserAta(user: PublicKey, mint: PublicKey): Promise<PublicKey> {
    const [ata] = PublicKey.findProgramAddressSync(
      [user.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );
    return ata;
  }

  /**
   * Get price from bin ID
   */
  getPriceFromBinId(binId: number, binStep: number): number {
    // Price = (1 + binStep/10000)^binId
    const base = 1 + binStep / 10000;
    return Math.pow(base, binId);
  }

  /**
   * Get bin ID from price
   */
  getBinIdFromPrice(price: number, binStep: number): number {
    const base = 1 + binStep / 10000;
    return Math.floor(Math.log(price) / Math.log(base));
  }
}

/**
 * Meteora Dynamic Pools Adapter
 */
export class MeteoraDynamicAdapter extends BaseAmmAdapter {
  readonly protocol = AmmProtocol.METEORA_DYNAMIC;

  constructor(connection: Connection) {
    super({
      connection,
      programId: METEORA_DYNAMIC_PROGRAM_ID,
    });
  }

  async findPools(tokenMint: PublicKey): Promise<PoolInfo[]> {
    // Similar implementation for dynamic pools
    return [];
  }

  async getPool(poolAddress: PublicKey): Promise<PoolInfo | null> {
    return null;
  }

  async getSwapQuote(
    pool: PoolInfo,
    amountIn: BN,
    isBuy: boolean,
    slippageBps: number
  ): Promise<SwapQuote> {
    throw new Error('Not implemented');
  }

  async buildSwapInstruction(
    quote: SwapQuote,
    user: PublicKey
  ): Promise<TransactionInstruction[]> {
    return [];
  }

  async parseBuyEvent(signature: string): Promise<PoolBuyEvent | null> {
    return null;
  }

  async getSwapAccounts(pool: PoolInfo): Promise<PublicKey[]> {
    return [];
  }
}
