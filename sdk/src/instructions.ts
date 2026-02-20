/**
 * Instruction builders for ProfitMaxi
 * 
 * Low-level instruction construction helpers.
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { createHash } from 'crypto';
import BN from 'bn.js';
import { PROFITMAXI_PROGRAM_ID } from './constants';

/**
 * Derive an Anchor instruction discriminator.
 * Anchor uses sha256("global:<snake_case_name>")[0..8].
 */
function discriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

// Instruction discriminators derived programmatically from sha256("global:<name>").
// This matches Anchor's canonical discriminator generation — no hardcoded magic bytes.
export const INSTRUCTION_DISCRIMINATORS = {
  initialize:     discriminator('initialize'),
  createOrder:    discriminator('create_order'),
  executeShard:   discriminator('execute_shard'),
  cancelOrder:    discriminator('cancel_order'),
  updateOrder:    discriminator('update_order'),
  pauseOrder:     discriminator('pause_order'),
  resumeOrder:    discriminator('resume_order'),
  updateConfig:   discriminator('update_config'),
  registerKeeper: discriminator('register_keeper'),
  withdrawFees:   discriminator('withdraw_fees'),
};

/**
 * Build initialize instruction
 */
export function buildInitializeInstruction(
  admin: PublicKey,
  config: PublicKey,
  protocolFeeBps: number,
  keeperFeeBps: number,
  programId: PublicKey = PROFITMAXI_PROGRAM_ID
): TransactionInstruction {
  const data = Buffer.alloc(12);
  INSTRUCTION_DISCRIMINATORS.initialize.copy(data, 0);
  data.writeUInt16LE(protocolFeeBps, 8);
  data.writeUInt16LE(keeperFeeBps, 10);

  return new TransactionInstruction({
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

/**
 * Build create order instruction
 */
export function buildCreateOrderInstruction(
  owner: PublicKey,
  config: PublicKey,
  order: PublicKey,
  tokenMint: PublicKey,
  quoteMint: PublicKey,
  ammPool: PublicKey,
  ammProgram: PublicKey,
  ownerTokenAccount: PublicKey,
  escrowTokenAccount: PublicKey,
  totalSize: BN,
  deltaRatioBps: number,
  minThreshold: BN,
  programId: PublicKey = PROFITMAXI_PROGRAM_ID
): TransactionInstruction {
  const data = Buffer.alloc(26);
  INSTRUCTION_DISCRIMINATORS.createOrder.copy(data, 0);
  totalSize.toArrayLike(Buffer, 'le', 8).copy(data, 8);
  data.writeUInt16LE(deltaRatioBps, 16);
  minThreshold.toArrayLike(Buffer, 'le', 8).copy(data, 18);

  return new TransactionInstruction({
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: quoteMint, isSigner: false, isWritable: false },
      { pubkey: ammPool, isSigner: false, isWritable: false },
      { pubkey: ammProgram, isSigner: false, isWritable: false },
      { pubkey: ownerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

/**
 * Build execute shard instruction
 */
export function buildExecuteShardInstruction(
  keeper: PublicKey,
  keeperAccount: PublicKey,
  config: PublicKey,
  order: PublicKey,
  owner: PublicKey,
  escrowTokenAccount: PublicKey,
  ownerQuoteAccount: PublicKey,
  ammPool: PublicKey,
  ammProgram: PublicKey,
  feeVault: PublicKey,
  triggerBuyLamports: BN,
  minAmountOut: BN,
  programId: PublicKey = PROFITMAXI_PROGRAM_ID
): TransactionInstruction {
  const data = Buffer.alloc(24);
  INSTRUCTION_DISCRIMINATORS.executeShard.copy(data, 0);
  triggerBuyLamports.toArrayLike(Buffer, 'le', 8).copy(data, 8);
  minAmountOut.toArrayLike(Buffer, 'le', 8).copy(data, 16);

  return new TransactionInstruction({
    keys: [
      { pubkey: keeper, isSigner: true, isWritable: true },
      { pubkey: keeperAccount, isSigner: false, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: ownerQuoteAccount, isSigner: false, isWritable: true },
      { pubkey: ammPool, isSigner: false, isWritable: true },
      { pubkey: ammProgram, isSigner: false, isWritable: false },
      { pubkey: feeVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

/**
 * Build cancel order instruction
 */
export function buildCancelOrderInstruction(
  owner: PublicKey,
  order: PublicKey,
  escrowTokenAccount: PublicKey,
  ownerTokenAccount: PublicKey,
  programId: PublicKey = PROFITMAXI_PROGRAM_ID
): TransactionInstruction {
  const data = Buffer.alloc(8);
  INSTRUCTION_DISCRIMINATORS.cancelOrder.copy(data, 0);

  return new TransactionInstruction({
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

/**
 * Build update order instruction
 */
export function buildUpdateOrderInstruction(
  owner: PublicKey,
  order: PublicKey,
  newDeltaRatioBps: number | null,
  newMinThreshold: BN | null,
  programId: PublicKey = PROFITMAXI_PROGRAM_ID
): TransactionInstruction {
  // Variable size based on options
  let dataSize = 8;
  if (newDeltaRatioBps !== null) dataSize += 3; // 1 byte option flag + 2 bytes value
  if (newMinThreshold !== null) dataSize += 9; // 1 byte option flag + 8 bytes value
  
  const data = Buffer.alloc(dataSize);
  INSTRUCTION_DISCRIMINATORS.updateOrder.copy(data, 0);
  
  let offset = 8;
  if (newDeltaRatioBps !== null) {
    data.writeUInt8(1, offset++);
    data.writeUInt16LE(newDeltaRatioBps, offset);
    offset += 2;
  } else {
    data.writeUInt8(0, offset++);
  }
  
  if (newMinThreshold !== null) {
    data.writeUInt8(1, offset++);
    newMinThreshold.toArrayLike(Buffer, 'le', 8).copy(data, offset);
  } else {
    data.writeUInt8(0, offset++);
  }

  return new TransactionInstruction({
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: order, isSigner: false, isWritable: true },
    ],
    programId,
    data,
  });
}

/**
 * Build register keeper instruction
 */
export function buildRegisterKeeperInstruction(
  authority: PublicKey,
  keeper: PublicKey,
  programId: PublicKey = PROFITMAXI_PROGRAM_ID
): TransactionInstruction {
  const data = Buffer.alloc(8);
  INSTRUCTION_DISCRIMINATORS.registerKeeper.copy(data, 0);

  return new TransactionInstruction({
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: keeper, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}
