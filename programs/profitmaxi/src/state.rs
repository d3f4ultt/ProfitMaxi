//! Account state definitions for ProfitMaxi
//! 
//! This module contains all on-chain account structures used by the protocol.

use anchor_lang::prelude::*;

/// Protocol configuration account
/// Stores global settings and admin controls
#[account]
#[derive(Default)]
pub struct Config {
    /// Protocol admin who can update config
    pub admin: Pubkey,
    /// Protocol fee in basis points (taken from each shard execution)
    pub protocol_fee_bps: u16,
    /// Keeper fee in basis points (reward for executing shards)
    pub keeper_fee_bps: u16,
    /// Total fees collected (in lamports)
    pub total_fees_collected: u64,
    /// Total orders created
    pub total_orders: u64,
    /// Total shards executed
    pub total_shards_executed: u64,
    /// Total volume processed (in lamports)
    pub total_volume: u64,
    /// Whether protocol is paused
    pub is_paused: bool,
    /// Bump seed for PDA derivation
    pub bump: u8,
    /// Reserved for future use
    pub _reserved: [u8; 64],
}

impl Config {
    pub const LEN: usize = 8 + // discriminator
        32 + // admin
        2 +  // protocol_fee_bps
        2 +  // keeper_fee_bps
        8 +  // total_fees_collected
        8 +  // total_orders
        8 +  // total_shards_executed
        8 +  // total_volume
        1 +  // is_paused
        1 +  // bump
        64;  // reserved
}

/// ProfitMaxi order account
/// Represents a single volume-sensitive limit order
#[account]
#[derive(Default)]
pub struct Order {
    /// Owner of the order (can cancel/update)
    pub owner: Pubkey,
    /// Token mint being sold
    pub token_mint: Pubkey,
    /// Quote mint (typically SOL or USDC)
    pub quote_mint: Pubkey,
    /// AMM pool address for execution
    pub amm_pool: Pubkey,
    /// AMM program ID (Raydium, Orca, etc.)
    pub amm_program: Pubkey,
    /// Total order size in quote value (lamports)
    pub total_size: u64,
    /// Remaining unfilled amount in quote value
    pub remaining: u64,
    /// Tokens currently escrowed
    pub escrowed_tokens: u64,
    /// Delta ratio in basis points (1-10000)
    /// 10000 = 100% = r=1.0 (price neutral)
    /// 8000 = 80% = r=0.8 (20% positive drift)
    pub delta_ratio_bps: u16,
    /// Minimum buy size to trigger execution (in quote lamports)
    pub min_threshold: u64,
    /// Order creation timestamp
    pub created_at: i64,
    /// Last execution timestamp
    pub last_executed_at: i64,
    /// Number of partial fills (shards) executed
    pub total_fills: u32,
    /// Total quote received from fills
    pub total_quote_received: u64,
    /// Average execution price (weighted)
    pub avg_execution_price: u64,
    /// Current order status
    pub status: OrderStatus,
    /// Unique order ID (incrementing)
    pub order_id: u64,
    /// Bump seed for PDA derivation
    pub bump: u8,
    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl Order {
    pub const LEN: usize = 8 +  // discriminator
        32 + // owner
        32 + // token_mint
        32 + // quote_mint
        32 + // amm_pool
        32 + // amm_program
        8 +  // total_size
        8 +  // remaining
        8 +  // escrowed_tokens
        2 +  // delta_ratio_bps
        8 +  // min_threshold
        8 +  // created_at
        8 +  // last_executed_at
        4 +  // total_fills
        8 +  // total_quote_received
        8 +  // avg_execution_price
        1 +  // status
        8 +  // order_id
        1 +  // bump
        32;  // reserved

    /// Calculate the fill percentage
    pub fn fill_percentage(&self) -> u64 {
        if self.total_size == 0 {
            return 0;
        }
        ((self.total_size - self.remaining) * 10000) / self.total_size
    }

    /// Check if order is complete
    pub fn is_complete(&self) -> bool {
        self.remaining == 0 || self.status == OrderStatus::Filled
    }

    /// Check if order can be executed
    pub fn can_execute(&self) -> bool {
        self.status == OrderStatus::Active && self.remaining > 0
    }
}

/// Order status enumeration
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum OrderStatus {
    /// Order is active and can be executed
    #[default]
    Active,
    /// Order is paused (no execution, but not cancelled)
    Paused,
    /// Order is completely filled
    Filled,
    /// Order was cancelled by owner
    Cancelled,
}

/// Keeper registration account
/// Tracks keeper performance and fees
#[account]
#[derive(Default)]
pub struct Keeper {
    /// Keeper's wallet address
    pub authority: Pubkey,
    /// Total shards executed by this keeper
    pub shards_executed: u64,
    /// Total volume processed
    pub volume_processed: u64,
    /// Total fees earned
    pub fees_earned: u64,
    /// Registration timestamp
    pub registered_at: i64,
    /// Last activity timestamp
    pub last_active_at: i64,
    /// Keeper status
    pub is_active: bool,
    /// Bump seed
    pub bump: u8,
    /// Reserved
    pub _reserved: [u8; 32],
}

impl Keeper {
    pub const LEN: usize = 8 +  // discriminator
        32 + // authority
        8 +  // shards_executed
        8 +  // volume_processed
        8 +  // fees_earned
        8 +  // registered_at
        8 +  // last_active_at
        1 +  // is_active
        1 +  // bump
        32;  // reserved
}

/// Order escrow account (token holding)
/// PDA that holds tokens for an order
#[account]
pub struct OrderEscrow {
    /// Associated order
    pub order: Pubkey,
    /// Token mint
    pub token_mint: Pubkey,
    /// Current balance
    pub balance: u64,
    /// Bump seed
    pub bump: u8,
}

impl OrderEscrow {
    pub const LEN: usize = 8 +  // discriminator
        32 + // order
        32 + // token_mint
        8 +  // balance
        1;   // bump
}

#[cfg(test)]
mod size_tests {
    use super::*;

    #[test]
    fn order_len_correct() {
        // Manually sum field sizes and compare to Order::LEN.
        // If this fails, update Order::LEN to match the struct definition.
        let expected: usize =
            8 +   // discriminator
            32 +  // owner
            32 +  // token_mint
            32 +  // quote_mint
            32 +  // amm_pool
            32 +  // amm_program
            8 +   // total_size
            8 +   // remaining
            8 +   // escrowed_tokens
            2 +   // delta_ratio_bps
            8 +   // min_threshold
            8 +   // created_at
            8 +   // last_executed_at
            4 +   // total_fills
            8 +   // total_quote_received
            8 +   // avg_execution_price
            1 +   // status
            8 +   // order_id
            1 +   // bump
            32;   // _reserved
        assert_eq!(Order::LEN, expected, "Order::LEN mismatch — update the constant if the struct changed");
    }

    #[test]
    fn config_len_correct() {
        let expected: usize =
            8 +   // discriminator
            32 +  // admin
            2 +   // protocol_fee_bps
            2 +   // keeper_fee_bps
            8 +   // total_fees_collected
            8 +   // total_orders
            8 +   // total_shards_executed
            8 +   // total_volume
            1 +   // is_paused
            1 +   // bump
            64;   // reserved
        assert_eq!(Config::LEN, expected, "Config::LEN mismatch");
    }
}

/// Supported AMM types for execution routing
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum AmmType {
    /// Raydium AMM v4
    RaydiumV4,
    /// Raydium CLMM (concentrated liquidity)
    RaydiumClmm,
    /// Orca Whirlpool
    OrcaWhirlpool,
    /// Meteora DLMM
    MeteoraDlmm,
    /// Generic CPMM (for testing)
    GenericCpmm,
}

impl Default for AmmType {
    fn default() -> Self {
        AmmType::RaydiumV4
    }
}
