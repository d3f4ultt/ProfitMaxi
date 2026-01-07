//! Update protocol configuration (admin only)

use anchor_lang::prelude::*;

use crate::state::Config;
use crate::errors::ProfitMaxiError;
use crate::events::ConfigUpdated;
use crate::constants::*;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    /// Protocol admin (must sign)
    #[account(
        constraint = admin.key() == config.admin @ ProfitMaxiError::NotAdmin,
    )]
    pub admin: Signer<'info>,

    /// Global config
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
}

pub fn handler(
    ctx: Context<UpdateConfig>,
    new_protocol_fee_bps: Option<u16>,
    new_keeper_fee_bps: Option<u16>,
    new_admin: Option<Pubkey>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let clock = Clock::get()?;

    // Update protocol fee if provided
    if let Some(fee) = new_protocol_fee_bps {
        require!(fee <= MAX_PROTOCOL_FEE_BPS, ProfitMaxiError::FeeTooHigh);
        config.protocol_fee_bps = fee;
        msg!("Protocol fee updated to: {} bps", fee);
    }

    // Update keeper fee if provided
    if let Some(fee) = new_keeper_fee_bps {
        require!(fee <= MAX_KEEPER_FEE_BPS, ProfitMaxiError::FeeTooHigh);
        config.keeper_fee_bps = fee;
        msg!("Keeper fee updated to: {} bps", fee);
    }

    // Update admin if provided
    if let Some(admin) = new_admin {
        config.admin = admin;
        msg!("Admin updated to: {}", admin);
    }

    emit!(ConfigUpdated {
        admin: config.admin,
        protocol_fee_bps: config.protocol_fee_bps,
        keeper_fee_bps: config.keeper_fee_bps,
        timestamp: clock.unix_timestamp,
    });

    msg!("Config updated successfully");

    Ok(())
}
