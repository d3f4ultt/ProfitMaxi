//! Resume a paused ProfitMaxi order
//! 
//! This instruction resumes execution of a paused order.

use anchor_lang::prelude::*;

use crate::state::{Order, OrderStatus};
use crate::errors::ProfitMaxiError;
use crate::events::OrderResumed;

#[derive(Accounts)]
pub struct ResumeOrder<'info> {
    /// Order owner (must sign)
    pub owner: Signer<'info>,

    /// The order being resumed
    #[account(
        mut,
        constraint = order.owner == owner.key() @ ProfitMaxiError::NotOrderOwner,
        constraint = order.status == OrderStatus::Paused @ ProfitMaxiError::OrderNotPaused,
    )]
    pub order: Account<'info, Order>,
}

pub fn handler(ctx: Context<ResumeOrder>) -> Result<()> {
    let order = &mut ctx.accounts.order;
    let clock = Clock::get()?;

    order.status = OrderStatus::Active;

    emit!(OrderResumed {
        order: order.key(),
        owner: order.owner,
        remaining: order.remaining,
        timestamp: clock.unix_timestamp,
    });

    msg!("Order resumed successfully");
    msg!("Remaining: {} lamports", order.remaining);

    Ok(())
}
