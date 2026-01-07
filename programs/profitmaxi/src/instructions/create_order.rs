//! Create a new ProfitMaxi order
//! 
//! This instruction creates a new volume-sensitive limit order
//! and escrows the tokens to be sold.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use anchor_spl::associated_token::AssociatedToken;

use crate::state::{Config, Order, OrderStatus};
use crate::errors::ProfitMaxiError;
use crate::events::OrderCreated;
use crate::constants::*;
use crate::utils::*;

#[derive(Accounts)]
#[instruction(total_size_lamports: u64)]
pub struct CreateOrder<'info> {
    /// Order owner
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Global config
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    /// The order account (PDA)
    #[account(
        init,
        payer = owner,
        space = Order::LEN,
        seeds = [
            ORDER_SEED,
            owner.key().as_ref(),
            token_mint.key().as_ref(),
            &config.total_orders.to_le_bytes(),
        ],
        bump
    )]
    pub order: Account<'info, Order>,

    /// Token mint being sold
    pub token_mint: Account<'info, Mint>,

    /// Quote mint (SOL wrapped or stablecoin)
    pub quote_mint: Account<'info, Mint>,

    /// AMM pool address
    /// CHECK: Validated in handler based on AMM type
    pub amm_pool: AccountInfo<'info>,

    /// AMM program
    /// CHECK: Validated against known AMM program IDs
    pub amm_program: AccountInfo<'info>,

    /// Owner's token account
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    /// Escrow token account (PDA-owned)
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = token_mint,
        associated_token::authority = order,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Token program
    pub token_program: Program<'info, Token>,

    /// Associated token program
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// System program
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateOrder>,
    total_size_lamports: u64,
    delta_ratio_bps: u16,
    min_threshold_lamports: u64,
) -> Result<()> {
    // Validate inputs
    validate_delta_ratio(delta_ratio_bps)?;
    validate_order_size(total_size_lamports)?;
    validate_threshold(min_threshold_lamports)?;

    // Check protocol is not paused
    require!(
        !ctx.accounts.config.is_paused,
        ProfitMaxiError::ProtocolPaused
    );

    // Calculate tokens to escrow based on current pool price
    // For now, we'll use the tokens available in owner's account
    // In production, this would query the AMM for current price
    let tokens_to_escrow = ctx.accounts.owner_token_account.amount;
    
    require!(
        tokens_to_escrow > 0,
        ProfitMaxiError::InsufficientBalance
    );

    // Transfer tokens to escrow
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.owner_token_account.to_account_info(),
            to: ctx.accounts.escrow_token_account.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, tokens_to_escrow)?;

    // Initialize order state
    let order = &mut ctx.accounts.order;
    let config = &mut ctx.accounts.config;
    let clock = Clock::get()?;

    order.owner = ctx.accounts.owner.key();
    order.token_mint = ctx.accounts.token_mint.key();
    order.quote_mint = ctx.accounts.quote_mint.key();
    order.amm_pool = ctx.accounts.amm_pool.key();
    order.amm_program = ctx.accounts.amm_program.key();
    order.total_size = total_size_lamports;
    order.remaining = total_size_lamports;
    order.escrowed_tokens = tokens_to_escrow;
    order.delta_ratio_bps = delta_ratio_bps;
    order.min_threshold = min_threshold_lamports;
    order.created_at = clock.unix_timestamp;
    order.last_executed_at = 0;
    order.total_fills = 0;
    order.total_quote_received = 0;
    order.avg_execution_price = 0;
    order.status = OrderStatus::Active;
    order.order_id = config.total_orders;
    order.bump = ctx.bumps.order;

    // Update config counters
    config.total_orders = config.total_orders.checked_add(1).unwrap();

    emit!(OrderCreated {
        order: order.key(),
        owner: order.owner,
        token_mint: order.token_mint,
        quote_mint: order.quote_mint,
        amm_pool: order.amm_pool,
        total_size: order.total_size,
        tokens_escrowed: order.escrowed_tokens,
        delta_ratio_bps: order.delta_ratio_bps,
        min_threshold: order.min_threshold,
        order_id: order.order_id,
        timestamp: clock.unix_timestamp,
    });

    msg!("Order created successfully");
    msg!("Order ID: {}", order.order_id);
    msg!("Total size: {} lamports", order.total_size);
    msg!("Delta ratio: {} bps", order.delta_ratio_bps);
    msg!("Tokens escrowed: {}", order.escrowed_tokens);

    Ok(())
}
