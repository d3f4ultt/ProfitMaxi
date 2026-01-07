//! Update an active ProfitMaxi order
//! 
//! This instruction allows the owner to modify order parameters.

use anchor_lang::prelude::*;

use crate::state::{Order, OrderStatus};
use crate::errors::ProfitMaxiError;
use crate::events::OrderUpdated;
use crate::utils::*;

#[derive(Accounts)]
pub struct UpdateOrder<'info> {
    /// Order owner (must sign)
    pub owner: Signer<'info>,

    /// The order being updated
    #[account(
        mut,
        constraint = order.owner == owner.key() @ ProfitMaxiError::NotOrderOwner,
        constraint = order.status == OrderStatus::Active || order.status == OrderStatus::Paused @ ProfitMaxiError::OrderNotActive,
    )]
    pub order: Account<'info, Order>,
}

pub fn handler(
    ctx: Context<UpdateOrder>,
    new_delta_ratio_bps: Option<u16>,
    new_min_threshold: Option<u64>,
) -> Result<()> {
    let order = &mut ctx.accounts.order;
    let clock = Clock::get()?;

    // Update delta ratio if provided
    if let Some(ratio) = new_delta_ratio_bps {
        validate_delta_ratio(ratio)?;
        order.delta_ratio_bps = ratio;
        msg!("Delta ratio updated to: {} bps", ratio);
    }

    // Update threshold if provided
    if let Some(threshold) = new_min_threshold {
        validate_threshold(threshold)?;
        order.min_threshold = threshold;
        msg!("Min threshold updated to: {} lamports", threshold);
    }

    emit!(OrderUpdated {
        order: order.key(),
        owner: order.owner,
        delta_ratio_bps: order.delta_ratio_bps,
        min_threshold: order.min_threshold,
        timestamp: clock.unix_timestamp,
    });

    msg!("Order updated successfully");

    Ok(())
}
