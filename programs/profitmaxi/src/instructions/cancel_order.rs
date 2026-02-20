//! Cancel an active ProfitMaxi order
//! 
//! This instruction cancels an order and returns all escrowed tokens to the owner.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::{Order, OrderStatus};
use crate::errors::ProfitMaxiError;
use crate::events::OrderCancelled;
use crate::constants::*;

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    /// Order owner (must sign)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The order being cancelled — closed on cancel, rent returned to owner
    #[account(
        mut,
        close = owner,
        constraint = order.owner == owner.key() @ ProfitMaxiError::NotOrderOwner,
        constraint = order.status == OrderStatus::Active || order.status == OrderStatus::Paused @ ProfitMaxiError::OrderNotActive,
    )]
    pub order: Account<'info, Order>,

    /// System program required for account closure
    pub system_program: Program<'info, System>,

    /// Escrow token account
    #[account(
        mut,
        associated_token::mint = order.token_mint,
        associated_token::authority = order,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Owner's token account (receives returned tokens)
    #[account(
        mut,
        constraint = owner_token_account.owner == owner.key(),
        constraint = owner_token_account.mint == order.token_mint,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    /// Token program
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CancelOrder>) -> Result<()> {
    let order = &ctx.accounts.order;
    let clock = Clock::get()?;

    // Get tokens to return
    let tokens_to_return = ctx.accounts.escrow_token_account.amount;

    // Build PDA signer seeds
    let order_id_bytes = order.order_id.to_le_bytes();
    let seeds = &[
        ORDER_SEED,
        order.owner.as_ref(),
        order.token_mint.as_ref(),
        &order_id_bytes,
        &[order.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    // Transfer tokens back to owner
    if tokens_to_return > 0 {
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.escrow_token_account.to_account_info(),
                to: ctx.accounts.owner_token_account.to_account_info(),
                authority: ctx.accounts.order.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, tokens_to_return)?;
    }

    // Update order state
    let order = &mut ctx.accounts.order;
    let amount_filled = order.total_size.saturating_sub(order.remaining);
    
    order.status = OrderStatus::Cancelled;
    order.escrowed_tokens = 0;

    emit!(OrderCancelled {
        order: order.key(),
        owner: order.owner,
        tokens_returned: tokens_to_return,
        amount_filled,
        quote_received: order.total_quote_received,
        timestamp: clock.unix_timestamp,
    });

    msg!("Order cancelled successfully");
    msg!("Tokens returned: {}", tokens_to_return);
    msg!("Amount filled before cancellation: {} lamports", amount_filled);

    Ok(())
}
