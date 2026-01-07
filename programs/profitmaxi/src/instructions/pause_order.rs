//! Pause an active ProfitMaxi order
//! 
//! This instruction pauses execution without cancelling the order.

use anchor_lang::prelude::*;

use crate::state::{Order, OrderStatus};
use crate::errors::ProfitMaxiError;
use crate::events::OrderPaused;

#[derive(Accounts)]
pub struct PauseOrder<'info> {
    /// Order owner (must sign)
    pub owner: Signer<'info>,

    /// The order being paused
    #[account(
        mut,
        constraint = order.owner == owner.key() @ ProfitMaxiError::NotOrderOwner,
        constraint = order.status == OrderStatus::Active @ ProfitMaxiError::OrderAlreadyPaused,
    )]
    pub order: Account<'info, Order>,
}

pub fn handler(ctx: Context<PauseOrder>) -> Result<()> {
    let order = &mut ctx.accounts.order;
    let clock = Clock::get()?;

    order.status = OrderStatus::Paused;

    emit!(OrderPaused {
        order: order.key(),
        owner: order.owner,
        remaining: order.remaining,
        timestamp: clock.unix_timestamp,
    });

    msg!("Order paused successfully");
    msg!("Remaining: {} lamports", order.remaining);

    Ok(())
}
