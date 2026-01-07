//! Execute a shard (partial fill) of a ProfitMaxi order
//! 
//! This instruction is called by keepers when a qualifying buy is detected.
//! It calculates the proportional sell amount and executes the swap via CPI.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::{Config, Order, OrderStatus, Keeper};
use crate::errors::ProfitMaxiError;
use crate::events::{ShardExecuted, OrderFilled};
use crate::constants::*;
use crate::utils::*;

#[derive(Accounts)]
pub struct ExecuteShard<'info> {
    /// Keeper executing the shard
    #[account(mut)]
    pub keeper: Signer<'info>,

    /// Keeper registration account
    #[account(
        mut,
        seeds = [KEEPER_SEED, keeper.key().as_ref()],
        bump = keeper_account.bump,
        constraint = keeper_account.is_active @ ProfitMaxiError::KeeperNotActive,
    )]
    pub keeper_account: Account<'info, Keeper>,

    /// Global config
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    /// The order being executed
    #[account(
        mut,
        constraint = order.status == OrderStatus::Active @ ProfitMaxiError::OrderNotActive,
        constraint = order.remaining > 0 @ ProfitMaxiError::OrderAlreadyFilled,
    )]
    pub order: Account<'info, Order>,

    /// Order owner (for receiving quote tokens)
    /// CHECK: Validated against order.owner
    #[account(
        mut,
        constraint = owner.key() == order.owner @ ProfitMaxiError::NotOrderOwner,
    )]
    pub owner: AccountInfo<'info>,

    /// Escrow token account
    #[account(
        mut,
        associated_token::mint = order.token_mint,
        associated_token::authority = order,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Owner's quote token account (receives SOL/USDC)
    #[account(
        mut,
        constraint = owner_quote_account.owner == order.owner,
    )]
    pub owner_quote_account: Account<'info, TokenAccount>,

    /// AMM pool account
    /// CHECK: Validated against order.amm_pool
    #[account(
        mut,
        constraint = amm_pool.key() == order.amm_pool @ ProfitMaxiError::AmmProgramMismatch,
    )]
    pub amm_pool: AccountInfo<'info>,

    /// AMM program
    /// CHECK: Validated against order.amm_program
    #[account(
        constraint = amm_program.key() == order.amm_program @ ProfitMaxiError::AmmProgramMismatch,
    )]
    pub amm_program: AccountInfo<'info>,

    // AMM-specific accounts would go here
    // These vary by AMM (Raydium, Orca, etc.)
    // Using remaining_accounts for flexibility

    /// Protocol fee vault
    #[account(
        mut,
        seeds = [FEE_VAULT_SEED],
        bump,
    )]
    pub fee_vault: AccountInfo<'info>,

    /// Token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ExecuteShard>,
    trigger_buy_lamports: u64,
    min_amount_out: u64,
) -> Result<()> {
    let order = &ctx.accounts.order;
    let config = &ctx.accounts.config;

    // Validate trigger is above threshold
    require!(
        trigger_buy_lamports >= order.min_threshold,
        ProfitMaxiError::BelowThreshold
    );

    // Check protocol is not paused
    require!(
        !config.is_paused,
        ProfitMaxiError::ProtocolPaused
    );

    // Calculate sell amount based on delta ratio
    let sell_amount = calculate_sell_amount(
        trigger_buy_lamports,
        order.delta_ratio_bps,
        order.remaining,
    )?;

    require!(sell_amount > 0, ProfitMaxiError::ZeroSellAmount);

    // Calculate tokens to sell (proportional to remaining escrow)
    // tokens_to_sell = escrowed_tokens * (sell_amount / remaining)
    let tokens_to_sell = (ctx.accounts.order.escrowed_tokens as u128)
        .checked_mul(sell_amount as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?
        .checked_div(ctx.accounts.order.remaining as u128)
        .ok_or(ProfitMaxiError::MathOverflow)? as u64;

    require!(
        tokens_to_sell <= ctx.accounts.escrow_token_account.amount,
        ProfitMaxiError::NoTokensRemaining
    );

    // Build PDA signer seeds for escrow transfer
    let order_id_bytes = ctx.accounts.order.order_id.to_le_bytes();
    let seeds = &[
        ORDER_SEED,
        ctx.accounts.order.owner.as_ref(),
        ctx.accounts.order.token_mint.as_ref(),
        &order_id_bytes,
        &[ctx.accounts.order.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    // Execute AMM swap via CPI
    // This is a simplified version - real implementation would have
    // AMM-specific CPI calls (Raydium, Orca, etc.)
    let quote_received = execute_amm_swap_cpi(
        &ctx,
        tokens_to_sell,
        min_amount_out,
        signer_seeds,
    )?;

    // Validate slippage
    require!(
        quote_received >= min_amount_out,
        ProfitMaxiError::SlippageExceeded
    );

    // Calculate fees
    let keeper_fee = calculate_keeper_fee(quote_received, config.keeper_fee_bps)?;
    let protocol_fee = calculate_protocol_fee(quote_received, config.protocol_fee_bps)?;
    let net_quote = quote_received
        .checked_sub(keeper_fee)
        .ok_or(ProfitMaxiError::MathUnderflow)?
        .checked_sub(protocol_fee)
        .ok_or(ProfitMaxiError::MathUnderflow)?;

    // Calculate execution price (scaled by 1e9)
    let execution_price = if tokens_to_sell > 0 {
        (quote_received as u128)
            .checked_mul(PRICE_PRECISION as u128)
            .ok_or(ProfitMaxiError::MathOverflow)?
            .checked_div(tokens_to_sell as u128)
            .ok_or(ProfitMaxiError::MathOverflow)? as u64
    } else {
        0
    };

    // Update order state
    let order = &mut ctx.accounts.order;
    let clock = Clock::get()?;

    let prev_quote_received = order.total_quote_received;
    
    order.remaining = order.remaining
        .checked_sub(sell_amount)
        .ok_or(ProfitMaxiError::MathUnderflow)?;
    
    order.escrowed_tokens = order.escrowed_tokens
        .checked_sub(tokens_to_sell)
        .ok_or(ProfitMaxiError::MathUnderflow)?;
    
    order.total_fills = order.total_fills
        .checked_add(1)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    
    order.total_quote_received = order.total_quote_received
        .checked_add(net_quote)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    
    order.avg_execution_price = calculate_weighted_avg_price(
        order.avg_execution_price,
        prev_quote_received,
        execution_price,
        net_quote,
    )?;
    
    order.last_executed_at = clock.unix_timestamp;

    // Check if order is now complete
    let is_filled = order.remaining == 0;
    if is_filled {
        order.status = OrderStatus::Filled;
    }

    // Update config stats
    let config = &mut ctx.accounts.config;
    config.total_shards_executed = config.total_shards_executed
        .checked_add(1)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    config.total_volume = config.total_volume
        .checked_add(sell_amount)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    config.total_fees_collected = config.total_fees_collected
        .checked_add(protocol_fee)
        .ok_or(ProfitMaxiError::MathOverflow)?;

    // Update keeper stats
    let keeper_account = &mut ctx.accounts.keeper_account;
    keeper_account.shards_executed = keeper_account.shards_executed
        .checked_add(1)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    keeper_account.volume_processed = keeper_account.volume_processed
        .checked_add(sell_amount)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    keeper_account.fees_earned = keeper_account.fees_earned
        .checked_add(keeper_fee)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    keeper_account.last_active_at = clock.unix_timestamp;

    // Emit shard executed event
    emit!(ShardExecuted {
        order: ctx.accounts.order.key(),
        owner: ctx.accounts.order.owner,
        trigger_buy: trigger_buy_lamports,
        sell_amount,
        tokens_sold: tokens_to_sell,
        quote_received: net_quote,
        execution_price,
        remaining: ctx.accounts.order.remaining,
        keeper: ctx.accounts.keeper.key(),
        keeper_fee,
        protocol_fee,
        fill_number: ctx.accounts.order.total_fills,
        timestamp: clock.unix_timestamp,
    });

    // Emit filled event if complete
    if is_filled {
        let fill_duration = clock.unix_timestamp - ctx.accounts.order.created_at;
        
        emit!(OrderFilled {
            order: ctx.accounts.order.key(),
            owner: ctx.accounts.order.owner,
            total_size: ctx.accounts.order.total_size,
            total_quote_received: ctx.accounts.order.total_quote_received,
            avg_execution_price: ctx.accounts.order.avg_execution_price,
            total_fills: ctx.accounts.order.total_fills,
            fill_duration,
            timestamp: clock.unix_timestamp,
        });
    }

    msg!("Shard executed successfully");
    msg!("Trigger buy: {} lamports", trigger_buy_lamports);
    msg!("Sell amount: {} lamports", sell_amount);
    msg!("Tokens sold: {}", tokens_to_sell);
    msg!("Quote received: {} (net: {})", quote_received, net_quote);
    msg!("Remaining: {} lamports", ctx.accounts.order.remaining);

    Ok(())
}

/// Execute AMM swap via CPI
/// 
/// This is a placeholder - real implementation would have
/// specific CPI calls for each supported AMM.
fn execute_amm_swap_cpi(
    ctx: &Context<ExecuteShard>,
    tokens_to_sell: u64,
    min_amount_out: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<u64> {
    // In production, this would:
    // 1. Determine AMM type from order.amm_program
    // 2. Build appropriate CPI call (Raydium, Orca, etc.)
    // 3. Execute swap and return quote received
    
    // For now, simulate a successful swap
    // Real implementation would use remaining_accounts for AMM-specific accounts
    
    msg!("Executing AMM swap CPI...");
    msg!("Tokens to sell: {}", tokens_to_sell);
    msg!("Min amount out: {}", min_amount_out);
    
    // Transfer tokens from escrow to AMM (placeholder)
    // In real implementation, this is handled by AMM CPI
    
    // Simulated output (in production, this comes from AMM)
    let quote_received = tokens_to_sell; // 1:1 for testing
    
    Ok(quote_received)
}
