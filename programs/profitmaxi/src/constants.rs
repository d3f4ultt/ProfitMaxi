//! Program constants for ProfitMaxi
//! 
//! Centralized location for all magic numbers and configuration values.

use anchor_lang::prelude::*;

// =============================================================================
// Seeds for PDA derivation
// =============================================================================

/// Seed for the protocol config PDA
pub const CONFIG_SEED: &[u8] = b"config";

/// Seed for order PDAs
pub const ORDER_SEED: &[u8] = b"order";

/// Seed for order escrow PDAs
pub const ESCROW_SEED: &[u8] = b"escrow";

/// Seed for keeper PDAs
pub const KEEPER_SEED: &[u8] = b"keeper";

/// Seed for fee vault PDA
pub const FEE_VAULT_SEED: &[u8] = b"fee_vault";

// =============================================================================
// Basis Points Constants
// =============================================================================

/// Basis points denominator (100% = 10000 bps)
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Minimum delta ratio (0.01%)
pub const MIN_DELTA_RATIO_BPS: u16 = 1;

/// Maximum delta ratio (100%)
pub const MAX_DELTA_RATIO_BPS: u16 = 10_000;

/// Maximum protocol fee (10%)
pub const MAX_PROTOCOL_FEE_BPS: u16 = 1_000;

/// Maximum keeper fee (5%)
pub const MAX_KEEPER_FEE_BPS: u16 = 500;

/// Default protocol fee (0.1%)
pub const DEFAULT_PROTOCOL_FEE_BPS: u16 = 10;

/// Default keeper fee (0.1%)
pub const DEFAULT_KEEPER_FEE_BPS: u16 = 10;

// =============================================================================
// Price Scaling
// =============================================================================

/// Price precision (1e9 for 9 decimal places)
pub const PRICE_PRECISION: u64 = 1_000_000_000;

/// Token amount precision for calculations
pub const TOKEN_PRECISION: u64 = 1_000_000_000;

// =============================================================================
// Limits
// =============================================================================

/// Minimum order size in lamports (0.001 SOL worth)
pub const MIN_ORDER_SIZE: u64 = 1_000_000;

/// Maximum order size in lamports (1,000,000 SOL worth)
pub const MAX_ORDER_SIZE: u64 = 1_000_000_000_000_000;

/// Minimum threshold in lamports (0.0001 SOL)
pub const MIN_THRESHOLD: u64 = 100_000;

/// Maximum fills per order (sanity check)
pub const MAX_FILLS_PER_ORDER: u32 = 1_000_000;

// =============================================================================
// AMM Program IDs
// =============================================================================

/// Raydium AMM V4 Program ID
pub const RAYDIUM_AMM_V4: &str = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

/// Raydium CLMM Program ID
pub const RAYDIUM_CLMM: &str = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";

/// Orca Whirlpool Program ID
pub const ORCA_WHIRLPOOL: &str = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";

/// Meteora DLMM Program ID
pub const METEORA_DLMM: &str = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

// =============================================================================
// Native Mints
// =============================================================================

/// Wrapped SOL mint
pub const WSOL_MINT: &str = "So11111111111111111111111111111111111111112";

/// USDC mint (mainnet)
pub const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/// USDT mint (mainnet)
pub const USDT_MINT: &str = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

// =============================================================================
// Compute Budget
// =============================================================================

/// Compute units for create_order
pub const CU_CREATE_ORDER: u32 = 100_000;

/// Compute units for execute_shard (with AMM CPI)
pub const CU_EXECUTE_SHARD: u32 = 300_000;

/// Compute units for cancel_order
pub const CU_CANCEL_ORDER: u32 = 50_000;
