/**
 * PumpSwap AMM Adapter
 * 
 * Adapter for pump.fun's AMM (PumpSwap) pools.
 * Handles tokens that graduated from pump.fun bonding curve.
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
 * PumpSwap Program IDs
 */
export const PUMPSWAP_PROGRAM_ID = new PublicKey('PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP');
export const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

/**
 * PumpSwap Pool State Layout
 */
interface PumpSwapPoolState {
  discriminator: BN;
  poolBump: number;
  index: number;
  creator: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  lpMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  lpSupply: BN;
  baseReserve: BN;
  quoteReserve: BN;
  cumulativeVolume: BN;
  cumulativeFees: BN;
  createdAt: BN;
  tradingEnabled: boolean;
}

/**
 * PumpSwap instruction types
 */
enum PumpSwapInstruction {
  Swap = 0,
  AddLiquidity = 1,
  RemoveLiquidity = 2,
}

/**
 * PumpSwap AMM Adapter
 */
export class PumpSwapAdapter extends BaseAmmAdapter {
  readonly protocol = AmmProtocol.PUMPSWAP;

  /** Pool addresses discovered/cached by findPools() or findPoolFromTx(). */
  private knownPools: Map<string, PublicKey> = new Map();

  constructor(connection: Connection) {
    super({
      connection,
      programId: PUMPSWAP_PROGRAM_ID,
    });
  }

  async findPools(tokenMint: PublicKey): Promise<PoolInfo[]> {
    const pools: PoolInfo[] = [];

    // PumpSwap pools use a deterministic PDA
    // Seed: ["pool", base_mint, quote_mint]
    const wsolMint = new PublicKey('So11111111111111111111111111111111111111112');
    
    // Try to find pool with token as base, SOL as quote
    const [poolPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('pool'),
        tokenMint.toBuffer(),
        wsolMint.toBuffer(),
      ],
      this.programId
    );

    const pool = await this.getPool(poolPda);
    if (pool) {
      pools.push(pool);
      // Cache the canonical PDA so parseBuyEvent can resolve it from tx accounts
      this.knownPools.set(poolPda.toBase58(), poolPda);
    }

    // Also search by program accounts for any pools containing this token
    const accounts = await this.getProgramAccounts([
      { dataSize: 324 }, // PumpSwap pool size
    ]);

    for (const { pubkey, data } of accounts) {
      // Skip if we already have this pool
      if (pools.find(p => p.address.equals(pubkey))) continue;

      const parsedPool = await this.parsePool(pubkey, data);
      if (parsedPool &&
          (parsedPool.baseMint.equals(tokenMint) || parsedPool.quoteMint.equals(tokenMint))) {
        pools.push(parsedPool);
        this.knownPools.set(pubkey.toBase58(), pubkey);
      }
    }

    return pools;
  }

  async getPool(poolAddress: PublicKey): Promise<PoolInfo | null> {
    const accountInfo = await this.connection.getAccountInfo(poolAddress);
    if (!accountInfo || accountInfo.owner.toBase58() !== this.programId.toBase58()) {
      return null;
    }
    return this.parsePool(poolAddress, accountInfo.data);
  }

  private async parsePool(address: PublicKey, data: Buffer): Promise<PoolInfo | null> {
    try {
      if (data.length < 324) return null;

      // Parse discriminator (8 bytes)
      const discriminator = new BN(data.slice(0, 8), 'le');
      
      // Parse pool state
      const poolBump = data.readUInt8(8);
      const index = data.readUInt16LE(9);
      const creator = new PublicKey(data.slice(11, 43));
      const baseMint = new PublicKey(data.slice(43, 75));
      const quoteMint = new PublicKey(data.slice(75, 107));
      const lpMint = new PublicKey(data.slice(107, 139));
      const baseVault = new PublicKey(data.slice(139, 171));
      const quoteVault = new PublicKey(data.slice(171, 203));
      const lpSupply = new BN(data.slice(203, 211), 'le');
      const createdAt = new BN(data.slice(275, 283), 'le');
      const tradingEnabled = data.readUInt8(283) === 1;

      if (!tradingEnabled) return null;

      // Fetch current reserves from vault accounts
      const [baseAccount, quoteAccount] = await Promise.all([
        this.connection.getTokenAccountBalance(baseVault),
        this.connection.getTokenAccountBalance(quoteVault),
      ]);

      const baseReserve = new BN(baseAccount.value.amount);
      const quoteReserve = new BN(quoteAccount.value.amount);

      // PumpSwap fee is typically 1% (100 bps)
      const feeBps = 100;

      return {
        address,
        protocol: AmmProtocol.PUMPSWAP,
        baseMint,
        quoteMint,
        baseReserve,
        quoteReserve,
        createdAt: createdAt.toNumber(),
        liquidity: quoteReserve.mul(new BN(2)),
        feeBps,
        lpMint,
        isActive: tradingEnabled,
        extra: {
          creator,
          baseVault,
          quoteVault,
          poolBump,
          index,
        },
      };
    } catch (error) {
      console.error(`Failed to parse PumpSwap pool: ${error}`);
      return null;
    }
  }

  async getSwapQuote(
    pool: PoolInfo,
    amountIn: BN,
    isBuy: boolean,
    slippageBps: number
  ): Promise<SwapQuote> {
    // PumpSwap uses constant product with 1% fee
    const reserveIn = isBuy ? pool.quoteReserve : pool.baseReserve;
    const reserveOut = isBuy ? pool.baseReserve : pool.quoteReserve;

    // Apply fee (1%)
    const amountOut = this.calculateConstantProductOutput(
      amountIn,
      reserveIn,
      reserveOut,
      pool.feeBps
    );

    const minAmountOut = amountOut
      .mul(new BN(10000 - slippageBps))
      .div(new BN(10000));

    const priceImpactBps = this.calculatePriceImpact(amountIn, reserveIn, reserveOut);
    const feeAmount = amountIn.mul(new BN(pool.feeBps)).div(new BN(10000));

    return {
      amountIn,
      amountOut,
      minAmountOut,
      priceImpactBps,
      feeAmount,
      executionPrice: amountOut.mul(new BN(1e9)).div(amountIn),
      pool,
    };
  }

  async buildSwapInstruction(
    quote: SwapQuote,
    user: PublicKey
  ): Promise<TransactionInstruction[]> {
    const { pool } = quote;
    const extra = pool.extra as {
      baseVault: PublicKey;
      quoteVault: PublicKey;
      poolBump: number;
    };

    // Determine swap direction
    const isBuy = true; // Assuming buying base token with quote

    // Build instruction data
    // Format: [discriminator (1), amount_in (8), min_amount_out (8)]
    const data = Buffer.alloc(17);
    data.writeUInt8(PumpSwapInstruction.Swap, 0);
    quote.amountIn.toArrayLike(Buffer, 'le', 8).copy(data, 1);
    quote.minAmountOut.toArrayLike(Buffer, 'le', 8).copy(data, 9);

    // Get user token accounts
    const userQuoteAta = await this.getUserAta(user, pool.quoteMint);
    const userBaseAta = await this.getUserAta(user, pool.baseMint);

    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: pool.address, isSigner: false, isWritable: true },
        { pubkey: user, isSigner: true, isWritable: false },
        { pubkey: userQuoteAta, isSigner: false, isWritable: true },
        { pubkey: userBaseAta, isSigner: false, isWritable: true },
        { pubkey: extra.quoteVault, isSigner: false, isWritable: true },
        { pubkey: extra.baseVault, isSigner: false, isWritable: true },
        { pubkey: pool.quoteMint, isSigner: false, isWritable: false },
        { pubkey: pool.baseMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });

    return [instruction];
  }

  async parseBuyEvent(signature: string): Promise<PoolBuyEvent | null> {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta) return null;

      // Check if this is a PumpSwap transaction
      const programIds = tx.transaction.message.accountKeys.map(k => 
        typeof k === 'string' ? k : k.pubkey.toBase58()
      );
      
      if (!programIds.includes(this.programId.toBase58())) {
        return null;
      }

      // Analyze token balance changes
      const preBalances = tx.meta.preTokenBalances || [];
      const postBalances = tx.meta.postTokenBalances || [];

      for (const pre of preBalances) {
        const post = postBalances.find(p => p.accountIndex === pre.accountIndex);
        if (!post) continue;

        const preAmount = new BN(pre.uiTokenAmount.amount);
        const postAmount = new BN(post.uiTokenAmount.amount);

        // Detect buy: quote vault increased (user deposited SOL)
        if (postAmount.gt(preAmount) && 
            pre.mint === 'So11111111111111111111111111111111111111112') {
          const buyAmount = postAmount.sub(preAmount);

          // Find the pool address from the transaction
          const poolAddress = this.findPoolFromTx(tx);
          if (!poolAddress) continue;

          // Find the token being bought
          const tokenMint = this.findBoughtTokenFromTx(tx, preBalances, postBalances);
          if (!tokenMint) continue;

          return {
            pool: poolAddress,
            protocol: AmmProtocol.PUMPSWAP,
            tokenMint,
            buyAmount,
            signature,
            slot: tx.slot,
            timestamp: tx.blockTime || 0,
          };
        }
      }

      return null;
    } catch (error) {
      console.error(`Failed to parse PumpSwap buy event: ${error}`);
      return null;
    }
  }

  async getSwapAccounts(pool: PoolInfo): Promise<PublicKey[]> {
    const extra = pool.extra as {
      baseVault: PublicKey;
      quoteVault: PublicKey;
    };

    return [
      pool.address,
      extra.baseVault,
      extra.quoteVault,
      pool.baseMint,
      pool.quoteMint,
    ];
  }

  /**
   * Get user's associated token account
   */
  private async getUserAta(user: PublicKey, mint: PublicKey): Promise<PublicKey> {
    const { PublicKey: PK } = await import('@solana/web3.js');
    const [ata] = PK.findProgramAddressSync(
      [user.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      new PK('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );
    return ata;
  }

  /**
   * Extract the pool address from a transaction by matching writable accounts
   * against the set of known PumpSwap pool addresses (populated by findPools).
   *
   * The pool is always a writable, non-signer account owned by PUMPSWAP_PROGRAM_ID.
   * We match against `knownPools` which is populated via findPools() calls.
   */
  private findPoolFromTx(tx: any): PublicKey | null {
    const accountKeys: string[] = tx.transaction.message.accountKeys.map((k: any) =>
      typeof k === 'string' ? k : k.pubkey.toBase58()
    );

    for (const keyStr of accountKeys) {
      if (this.knownPools.has(keyStr)) {
        return this.knownPools.get(keyStr)!;
      }
    }
    return null;
  }

  /**
   * Find the token being bought from balance changes
   */
  private findBoughtTokenFromTx(
    tx: any,
    preBalances: any[],
    postBalances: any[]
  ): PublicKey | null {
    for (const post of postBalances) {
      const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
      if (!pre) continue;

      const preAmount = new BN(pre.uiTokenAmount.amount);
      const postAmount = new BN(post.uiTokenAmount.amount);

      // Token amount decreased in pool vault = bought by user
      if (preAmount.gt(postAmount) && 
          post.mint !== 'So11111111111111111111111111111111111111112') {
        return new PublicKey(post.mint);
      }
    }
    return null;
  }

  /**
   * Check if a token graduated from pump.fun
   */
  async isGraduatedToken(tokenMint: PublicKey): Promise<boolean> {
    // Check if there's a PumpSwap pool for this token
    const pools = await this.findPools(tokenMint);
    return pools.length > 0;
  }

  /**
   * Get pump.fun bonding curve address for a token
   */
  getBondingCurvePda(tokenMint: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), tokenMint.toBuffer()],
      PUMP_FUN_PROGRAM_ID
    );
    return pda;
  }
}
