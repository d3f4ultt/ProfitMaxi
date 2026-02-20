/**
 * Raydium AMM Adapter
 * 
 * Supports Raydium V4 (CPMM), CLMM, and new CPMM pools.
 * 
 * @author Justin Liverman (d3f4ult) - Mezzanine DAO
 */

import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import { BaseAmmAdapter, BaseAdapterConfig } from './base';
import {
  AmmProtocol,
  AMM_PROGRAM_IDS,
  PoolInfo,
  SwapQuote,
  PoolBuyEvent,
} from './types';

/**
 * Raydium V4 Pool Layout
 */
interface RaydiumV4PoolState {
  status: BN;
  nonce: number;
  orderNum: BN;
  depth: BN;
  coinDecimals: number;
  pcDecimals: number;
  state: BN;
  resetFlag: BN;
  minSize: BN;
  volMaxCutRatio: BN;
  amountWaveRatio: BN;
  coinLotSize: BN;
  pcLotSize: BN;
  minPriceMultiplier: BN;
  maxPriceMultiplier: BN;
  systemDecimalsValue: BN;
  minSeparateNumerator: BN;
  minSeparateDenominator: BN;
  tradeFeeNumerator: BN;
  tradeFeeDenominator: BN;
  pnlNumerator: BN;
  pnlDenominator: BN;
  swapFeeNumerator: BN;
  swapFeeDenominator: BN;
  needTakePnlCoin: BN;
  needTakePnlPc: BN;
  totalPnlPc: BN;
  totalPnlCoin: BN;
  poolOpenTime: BN;
  punishPcAmount: BN;
  punishCoinAmount: BN;
  orderbookToInitTime: BN;
  swapCoinInAmount: BN;
  swapPcOutAmount: BN;
  swapCoin2PcFee: BN;
  swapPcInAmount: BN;
  swapCoinOutAmount: BN;
  swapPc2CoinFee: BN;
  poolCoinTokenAccount: PublicKey;
  poolPcTokenAccount: PublicKey;
  coinMintAddress: PublicKey;
  pcMintAddress: PublicKey;
  lpMintAddress: PublicKey;
  ammOpenOrders: PublicKey;
  serumMarket: PublicKey;
  serumProgramId: PublicKey;
  ammTargetOrders: PublicKey;
  poolWithdrawQueue: PublicKey;
  poolTempLpTokenAccount: PublicKey;
  ammOwner: PublicKey;
  pnlOwner: PublicKey;
}

/**
 * Raydium CPMM Pool Layout (new format)
 */
interface RaydiumCpmmPoolState {
  ammConfig: PublicKey;
  poolCreator: PublicKey;
  token0Vault: PublicKey;
  token1Vault: PublicKey;
  lpMint: PublicKey;
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  token0Program: PublicKey;
  token1Program: PublicKey;
  observationKey: PublicKey;
  bump: number;
  status: number;
  lpDecimals: number;
  mint0Decimals: number;
  mint1Decimals: number;
  lpSupply: BN;
  protocolFeesToken0: BN;
  protocolFeesToken1: BN;
  fundFeesToken0: BN;
  fundFeesToken1: BN;
  openTime: BN;
}

/**
 * Raydium V4 Adapter
 */
export class RaydiumV4Adapter extends BaseAmmAdapter {
  readonly protocol = AmmProtocol.RAYDIUM_V4;

  constructor(connection: Connection) {
    super({
      connection,
      programId: AMM_PROGRAM_IDS[AmmProtocol.RAYDIUM_V4],
    });
  }

  async findPools(tokenMint: PublicKey): Promise<PoolInfo[]> {
    const pools: PoolInfo[] = [];

    // Search by coin mint (base token)
    const coinMintAccounts = await this.getProgramAccounts([
      { dataSize: 752 }, // V4 pool size
      { memcmp: { offset: 400, bytes: tokenMint.toBase58() } }, // coinMintAddress offset
    ]);

    for (const { pubkey, data } of coinMintAccounts) {
      const pool = await this.parseV4Pool(pubkey, data);
      if (pool) pools.push(pool);
    }

    // Search by pc mint (if token is quote)
    const pcMintAccounts = await this.getProgramAccounts([
      { dataSize: 752 },
      { memcmp: { offset: 432, bytes: tokenMint.toBase58() } }, // pcMintAddress offset
    ]);

    for (const { pubkey, data } of pcMintAccounts) {
      const pool = await this.parseV4Pool(pubkey, data);
      if (pool && !pools.find(p => p.address.equals(pubkey))) {
        pools.push(pool);
      }
    }

    return pools;
  }

  async getPool(poolAddress: PublicKey): Promise<PoolInfo | null> {
    const accountInfo = await this.connection.getAccountInfo(poolAddress);
    if (!accountInfo) return null;
    return this.parseV4Pool(poolAddress, accountInfo.data);
  }

  private async parseV4Pool(
    address: PublicKey,
    data: Buffer
  ): Promise<PoolInfo | null> {
    try {
      // Parse pool state (simplified - full parsing requires complete layout)
      const status = new BN(data.slice(0, 8), 'le');
      
      // Check if pool is active (status == 6 for normal operation)
      if (!status.eq(new BN(6))) {
        return null;
      }

      // Extract key fields
      const poolCoinTokenAccount = new PublicKey(data.slice(336, 368));
      const poolPcTokenAccount = new PublicKey(data.slice(368, 400));
      const coinMint = new PublicKey(data.slice(400, 432));
      const pcMint = new PublicKey(data.slice(432, 464));
      const lpMint = new PublicKey(data.slice(464, 496));
      const openTime = new BN(data.slice(224, 232), 'le');

      // Get reserves
      const coinAccount = await this.connection.getTokenAccountBalance(poolCoinTokenAccount);
      const pcAccount = await this.connection.getTokenAccountBalance(poolPcTokenAccount);

      const baseReserve = new BN(coinAccount.value.amount);
      const quoteReserve = new BN(pcAccount.value.amount);

      // Calculate fee (typically 0.25% for Raydium V4)
      const feeBps = 25;

      return {
        address,
        protocol: AmmProtocol.RAYDIUM_V4,
        baseMint: coinMint,
        quoteMint: pcMint,
        baseReserve,
        quoteReserve,
        createdAt: openTime.toNumber(),
        liquidity: quoteReserve.mul(new BN(2)), // Approximate
        feeBps,
        lpMint,
        isActive: true,
        extra: {
          poolCoinTokenAccount,
          poolPcTokenAccount,
        },
      };
    } catch (error) {
      console.error(`Failed to parse Raydium V4 pool: ${error}`);
      return null;
    }
  }

  async getSwapQuote(
    pool: PoolInfo,
    amountIn: BN,
    isBuy: boolean,
    slippageBps: number
  ): Promise<SwapQuote> {
    const reserveIn = isBuy ? pool.quoteReserve : pool.baseReserve;
    const reserveOut = isBuy ? pool.baseReserve : pool.quoteReserve;

    const amountOut = this.calculateConstantProductOutput(
      amountIn,
      reserveIn,
      reserveOut,
      pool.feeBps
    );

    const minAmountOut = amountOut.mul(new BN(10000 - slippageBps)).div(new BN(10000));
    const priceImpactBps = this.calculatePriceImpact(amountIn, reserveIn, reserveOut);
    const feeAmount = amountIn.mul(new BN(pool.feeBps)).div(new BN(10000));
    const executionPrice = amountOut.mul(new BN(1e9)).div(amountIn);

    return {
      amountIn,
      amountOut,
      minAmountOut,
      priceImpactBps,
      feeAmount,
      executionPrice,
      pool,
    };
  }

  async buildSwapInstruction(
    quote: SwapQuote,
    user: PublicKey
  ): Promise<TransactionInstruction[]> {
    // Build Raydium V4 swap instruction
    const { pool } = quote;
    const extra = pool.extra as {
      poolCoinTokenAccount: PublicKey;
      poolPcTokenAccount: PublicKey;
    };

    // Instruction data layout for swap
    const data = Buffer.alloc(17);
    data.writeUInt8(9, 0); // Swap instruction discriminator
    quote.amountIn.toArrayLike(Buffer, 'le', 8).copy(data, 1);
    quote.minAmountOut.toArrayLike(Buffer, 'le', 8).copy(data, 9);

    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        // Full account list for Raydium V4 swap
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: pool.address, isSigner: false, isWritable: true },
        // ... additional accounts
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

      const preBalances = tx.meta.preTokenBalances || [];
      const postBalances = tx.meta.postTokenBalances || [];
      const WSOL_MINT = 'So11111111111111111111111111111111111111112';

      // Step 1: confirm wSOL (quote) increased in a pool vault → this is a buy
      let buyAmount: BN | null = null;
      let poolAddress: PublicKey | null = null;

      for (const pre of preBalances) {
        if (pre.mint !== WSOL_MINT) continue;
        const post = postBalances.find(p => p.accountIndex === pre.accountIndex);
        if (!post) continue;

        const preAmt = new BN(pre.uiTokenAmount.amount);
        const postAmt = new BN(post.uiTokenAmount.amount);

        if (postAmt.gt(preAmt)) {
          buyAmount = postAmt.sub(preAmt);
          // Resolve the pool PDA: scan account keys for an account owned by this program
          const accountKeys: string[] = tx.transaction.message.accountKeys.map((k: any) =>
            typeof k === 'string' ? k : k.pubkey.toBase58()
          );
          for (const keyStr of accountKeys) {
            try {
              const info = await this.connection.getAccountInfo(new PublicKey(keyStr));
              if (info && info.owner.toBase58() === this.programId.toBase58() &&
                  info.data.length === 752) { // Raydium V4 pool size
                poolAddress = new PublicKey(keyStr);
                break;
              }
            } catch {
              // skip
            }
          }
          break;
        }
      }

      if (!buyAmount || !poolAddress) return null;

      // Step 2: find the base token that DECREASED (sold by pool to buyer)
      const soldToken = postBalances.find(post => {
        const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
        if (!pre || post.mint === WSOL_MINT) return false;
        return new BN(pre.uiTokenAmount.amount).gt(new BN(post.uiTokenAmount.amount));
      });

      if (!soldToken) return null;

      return {
        pool: poolAddress,
        protocol: AmmProtocol.RAYDIUM_V4,
        tokenMint: new PublicKey(soldToken.mint),
        buyAmount,
        signature,
        slot: tx.slot,
        timestamp: tx.blockTime || 0,
      };
    } catch {
      return null;
    }
  }

  async getSwapAccounts(pool: PoolInfo): Promise<PublicKey[]> {
    const extra = pool.extra as {
      poolCoinTokenAccount: PublicKey;
      poolPcTokenAccount: PublicKey;
    };

    return [
      pool.address,
      extra.poolCoinTokenAccount,
      extra.poolPcTokenAccount,
      pool.baseMint,
      pool.quoteMint,
    ];
  }
}

/**
 * Raydium CPMM Adapter (new pools)
 */
export class RaydiumCpmmAdapter extends BaseAmmAdapter {
  readonly protocol = AmmProtocol.RAYDIUM_CPMM;

  constructor(connection: Connection) {
    super({
      connection,
      programId: AMM_PROGRAM_IDS[AmmProtocol.RAYDIUM_CPMM],
    });
  }

  async findPools(tokenMint: PublicKey): Promise<PoolInfo[]> {
    const pools: PoolInfo[] = [];

    // Use memcmp filters to avoid fetching ALL CPMM accounts (can be thousands).
    // token0Mint is at offset 168, token1Mint at offset 200 in the CPMM pool layout.
    const [token0Accounts, token1Accounts] = await Promise.all([
      this.getProgramAccounts([
        { dataSize: 637 },
        { memcmp: { offset: 168, bytes: tokenMint.toBase58() } },
      ]),
      this.getProgramAccounts([
        { dataSize: 637 },
        { memcmp: { offset: 200, bytes: tokenMint.toBase58() } },
      ]),
    ]);

    const seen = new Set<string>();
    for (const { pubkey, data } of [...token0Accounts, ...token1Accounts]) {
      const key = pubkey.toBase58();
      if (seen.has(key)) continue;
      seen.add(key);

      const pool = await this.parseCpmmPool(pubkey, data);
      if (pool) pools.push(pool);
    }

    return pools;
  }

  async getPool(poolAddress: PublicKey): Promise<PoolInfo | null> {
    const accountInfo = await this.connection.getAccountInfo(poolAddress);
    if (!accountInfo) return null;
    return this.parseCpmmPool(poolAddress, accountInfo.data);
  }

  private async parseCpmmPool(
    address: PublicKey,
    data: Buffer
  ): Promise<PoolInfo | null> {
    try {
      // Parse CPMM pool state
      const token0Vault = new PublicKey(data.slice(72, 104));
      const token1Vault = new PublicKey(data.slice(104, 136));
      const token0Mint = new PublicKey(data.slice(168, 200));
      const token1Mint = new PublicKey(data.slice(200, 232));
      const lpMint = new PublicKey(data.slice(136, 168));
      const status = data.readUInt8(297);
      const openTime = new BN(data.slice(329, 337), 'le');

      if (status !== 0) return null; // Not active

      // Get reserves
      const token0Account = await this.connection.getTokenAccountBalance(token0Vault);
      const token1Account = await this.connection.getTokenAccountBalance(token1Vault);

      return {
        address,
        protocol: AmmProtocol.RAYDIUM_CPMM,
        baseMint: token0Mint,
        quoteMint: token1Mint,
        baseReserve: new BN(token0Account.value.amount),
        quoteReserve: new BN(token1Account.value.amount),
        createdAt: openTime.toNumber(),
        liquidity: new BN(token1Account.value.amount).mul(new BN(2)),
        feeBps: 25, // Default fee
        lpMint,
        isActive: true,
        extra: { token0Vault, token1Vault },
      };
    } catch {
      return null;
    }
  }

  async getSwapQuote(
    pool: PoolInfo,
    amountIn: BN,
    isBuy: boolean,
    slippageBps: number
  ): Promise<SwapQuote> {
    const reserveIn = isBuy ? pool.quoteReserve : pool.baseReserve;
    const reserveOut = isBuy ? pool.baseReserve : pool.quoteReserve;

    const amountOut = this.calculateConstantProductOutput(
      amountIn,
      reserveIn,
      reserveOut,
      pool.feeBps
    );

    return {
      amountIn,
      amountOut,
      minAmountOut: amountOut.mul(new BN(10000 - slippageBps)).div(new BN(10000)),
      priceImpactBps: this.calculatePriceImpact(amountIn, reserveIn, reserveOut),
      feeAmount: amountIn.mul(new BN(pool.feeBps)).div(new BN(10000)),
      executionPrice: amountOut.mul(new BN(1e9)).div(amountIn),
      pool,
    };
  }

  async buildSwapInstruction(
    quote: SwapQuote,
    user: PublicKey
  ): Promise<TransactionInstruction[]> {
    // Build CPMM swap instruction
    return [];
  }

  async parseBuyEvent(signature: string): Promise<PoolBuyEvent | null> {
    // Similar to V4 parsing
    return null;
  }

  async getSwapAccounts(pool: PoolInfo): Promise<PublicKey[]> {
    return [pool.address];
  }
}
