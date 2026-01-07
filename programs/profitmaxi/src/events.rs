//! Program events for ProfitMaxi
//! 
//! Events are emitted for indexing and off-chain tracking.
//! Keepers and UIs can subscribe to these events to track order state.

use anchor_lang::prelude::*;

/// Emitted when the protocol is initialized
#[event]
pub struct ProtocolInitialized {
    /// Admin public key
    pub admin: Pubkey,
    /// Protocol fee in basis points
    pub protocol_fee_bps: u16,
    /// Keeper fee in basis points
    pub keeper_fee_bps: u16,
    /// Initialization timestamp
    pub timestamp: i64,
}

/// Emitted when a new order is created
#[event]
pub struct OrderCreated {
    /// Order account public key
    pub order: Pubkey,
    /// Order owner
    pub owner: Pubkey,
    /// Token being sold
    pub token_mint: Pubkey,
    /// Quote currency
    pub quote_mint: Pubkey,
    /// AMM pool for execution
    pub amm_pool: Pubkey,
    /// Total order size in quote value
    pub total_size: u64,
    /// Tokens escrowed
    pub tokens_escrowed: u64,
    /// Delta ratio in basis points
    pub delta_ratio_bps: u16,
    /// Minimum trigger threshold
    pub min_threshold: u64,
    /// Unique order ID
    pub order_id: u64,
    /// Creation timestamp
    pub timestamp: i64,
}

/// Emitted when a shard (partial fill) is executed
#[event]
pub struct ShardExecuted {
    /// Order account public key
    pub order: Pubkey,
    /// Order owner
    pub owner: Pubkey,
    /// Triggering buy amount (in quote)
    pub trigger_buy: u64,
    /// Amount sold (in quote value)
    pub sell_amount: u64,
    /// Tokens sold
    pub tokens_sold: u64,
    /// Quote received
    pub quote_received: u64,
    /// Execution price (quote per token, scaled by 1e9)
    pub execution_price: u64,
    /// Remaining order size
    pub remaining: u64,
    /// Keeper who executed
    pub keeper: Pubkey,
    /// Keeper fee paid
    pub keeper_fee: u64,
    /// Protocol fee paid
    pub protocol_fee: u64,
    /// Fill number (1-indexed)
    pub fill_number: u32,
    /// Execution timestamp
    pub timestamp: i64,
}

/// Emitted when an order is fully filled
#[event]
pub struct OrderFilled {
    /// Order account public key
    pub order: Pubkey,
    /// Order owner
    pub owner: Pubkey,
    /// Total size filled
    pub total_size: u64,
    /// Total quote received
    pub total_quote_received: u64,
    /// Average execution price
    pub avg_execution_price: u64,
    /// Total number of fills
    pub total_fills: u32,
    /// Time from creation to fill (seconds)
    pub fill_duration: i64,
    /// Completion timestamp
    pub timestamp: i64,
}

/// Emitted when an order is cancelled
#[event]
pub struct OrderCancelled {
    /// Order account public key
    pub order: Pubkey,
    /// Order owner
    pub owner: Pubkey,
    /// Tokens returned to owner
    pub tokens_returned: u64,
    /// Amount filled before cancellation
    pub amount_filled: u64,
    /// Quote received before cancellation
    pub quote_received: u64,
    /// Cancellation timestamp
    pub timestamp: i64,
}

/// Emitted when an order is updated
#[event]
pub struct OrderUpdated {
    /// Order account public key
    pub order: Pubkey,
    /// Order owner
    pub owner: Pubkey,
    /// New delta ratio (if changed)
    pub delta_ratio_bps: u16,
    /// New minimum threshold (if changed)
    pub min_threshold: u64,
    /// Update timestamp
    pub timestamp: i64,
}

/// Emitted when an order is paused
#[event]
pub struct OrderPaused {
    /// Order account public key
    pub order: Pubkey,
    /// Order owner
    pub owner: Pubkey,
    /// Remaining size at pause
    pub remaining: u64,
    /// Pause timestamp
    pub timestamp: i64,
}

/// Emitted when an order is resumed
#[event]
pub struct OrderResumed {
    /// Order account public key
    pub order: Pubkey,
    /// Order owner
    pub owner: Pubkey,
    /// Remaining size at resume
    pub remaining: u64,
    /// Resume timestamp
    pub timestamp: i64,
}

/// Emitted when a keeper is registered
#[event]
pub struct KeeperRegistered {
    /// Keeper account public key
    pub keeper: Pubkey,
    /// Keeper authority (wallet)
    pub authority: Pubkey,
    /// Registration timestamp
    pub timestamp: i64,
}

/// Emitted when protocol config is updated
#[event]
pub struct ConfigUpdated {
    /// New admin (if changed)
    pub admin: Pubkey,
    /// New protocol fee (if changed)
    pub protocol_fee_bps: u16,
    /// New keeper fee (if changed)
    pub keeper_fee_bps: u16,
    /// Update timestamp
    pub timestamp: i64,
}

/// Emitted when protocol fees are withdrawn
#[event]
pub struct FeesWithdrawn {
    /// Admin who withdrew
    pub admin: Pubkey,
    /// Amount withdrawn
    pub amount: u64,
    /// Remaining fees
    pub remaining_fees: u64,
    /// Withdrawal timestamp
    pub timestamp: i64,
}
