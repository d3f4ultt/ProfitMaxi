//! # ProfitMaxi
//! 
//! Volume-Sensitive Limit Orders for AMM Liquidity Pools
//! 
//! ## Overview
//! 
//! ProfitMaxi introduces a novel order type that responds dynamically to incoming
//! buy volume, matching sell execution proportionally to market demand. This enables
//! large position exits with minimal price impact and configurable positive drift.
//! 
//! ## Key Features
//! 
//! - **Delta Ratio (r)**: Configurable participation rate (0-100%)
//! - **Minimum Threshold (θ)**: Filter for dust transactions
//! - **Atomic Execution**: Keeper-triggered partial fills via CPI
//! - **Price Preservation**: Mathematical guarantees on market impact
//! 
//! ## Author
//! 
//! Justin Liverman (d3f4ult) - Mezzanine DAO
//! 
//! ## License
//! 
//! MIT License

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("PrftMx1111111111111111111111111111111111111");

#[program]
pub mod profitmaxi {
    use super::*;

    /// Initialize the protocol configuration
    /// Only callable once by the deployer
    pub fn initialize(
        ctx: Context<Initialize>,
        protocol_fee_bps: u16,
        keeper_fee_bps: u16,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, protocol_fee_bps, keeper_fee_bps)
    }

    /// Create a new ProfitMaxi order
    /// 
    /// # Arguments
    /// 
    /// * `total_size_lamports` - Total order size in token lamports
    /// * `delta_ratio_bps` - Delta ratio in basis points (1-10000)
    /// * `min_threshold_lamports` - Minimum buy size to trigger execution
    /// 
    /// # Returns
    /// 
    /// The created order account
    pub fn create_order(
        ctx: Context<CreateOrder>,
        total_size_lamports: u64,
        delta_ratio_bps: u16,
        min_threshold_lamports: u64,
    ) -> Result<()> {
        instructions::create_order::handler(
            ctx,
            total_size_lamports,
            delta_ratio_bps,
            min_threshold_lamports,
        )
    }

    /// Execute a shard (partial fill) of an order
    /// Called by keepers when a qualifying buy is detected
    /// 
    /// # Arguments
    /// 
    /// * `trigger_buy_lamports` - Size of the triggering buy in quote lamports
    /// * `min_amount_out` - Minimum tokens to receive (slippage protection)
    pub fn execute_shard(
        ctx: Context<ExecuteShard>,
        trigger_buy_lamports: u64,
        min_amount_out: u64,
    ) -> Result<()> {
        instructions::execute_shard::handler(ctx, trigger_buy_lamports, min_amount_out)
    }

    /// Cancel an active order and return escrowed tokens
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        instructions::cancel_order::handler(ctx)
    }

    /// Update order parameters
    /// 
    /// # Arguments
    /// 
    /// * `new_delta_ratio_bps` - Optional new delta ratio
    /// * `new_min_threshold` - Optional new minimum threshold
    pub fn update_order(
        ctx: Context<UpdateOrder>,
        new_delta_ratio_bps: Option<u16>,
        new_min_threshold: Option<u64>,
    ) -> Result<()> {
        instructions::update_order::handler(ctx, new_delta_ratio_bps, new_min_threshold)
    }

    /// Pause an active order (stops execution but retains escrow)
    pub fn pause_order(ctx: Context<PauseOrder>) -> Result<()> {
        instructions::pause_order::handler(ctx)
    }

    /// Resume a paused order
    pub fn resume_order(ctx: Context<ResumeOrder>) -> Result<()> {
        instructions::resume_order::handler(ctx)
    }

    /// Update protocol configuration (admin only)
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_protocol_fee_bps: Option<u16>,
        new_keeper_fee_bps: Option<u16>,
        new_admin: Option<Pubkey>,
    ) -> Result<()> {
        instructions::update_config::handler(
            ctx,
            new_protocol_fee_bps,
            new_keeper_fee_bps,
            new_admin,
        )
    }

    /// Register a keeper (for fee tracking and reputation)
    pub fn register_keeper(ctx: Context<RegisterKeeper>) -> Result<()> {
        instructions::register_keeper::handler(ctx)
    }

    /// Withdraw accumulated protocol fees (admin only)
    pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
        instructions::withdraw_fees::handler(ctx, amount)
    }
}
