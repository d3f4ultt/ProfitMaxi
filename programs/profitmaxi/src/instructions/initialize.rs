//! Initialize the ProfitMaxi protocol
//! 
//! This instruction sets up the global configuration account.
//! Can only be called once by the deployer.

use anchor_lang::prelude::*;
use crate::state::Config;
use crate::errors::ProfitMaxiError;
use crate::events::ProtocolInitialized;
use crate::constants::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The protocol admin (deployer)
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The global config account (PDA)
    #[account(
        init,
        payer = admin,
        space = Config::LEN,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    /// System program
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    protocol_fee_bps: u16,
    keeper_fee_bps: u16,
) -> Result<()> {
    // Validate fee parameters
    require!(
        protocol_fee_bps <= MAX_PROTOCOL_FEE_BPS,
        ProfitMaxiError::FeeTooHigh
    );
    require!(
        keeper_fee_bps <= MAX_KEEPER_FEE_BPS,
        ProfitMaxiError::FeeTooHigh
    );

    let config = &mut ctx.accounts.config;
    
    config.admin = ctx.accounts.admin.key();
    config.protocol_fee_bps = protocol_fee_bps;
    config.keeper_fee_bps = keeper_fee_bps;
    config.total_fees_collected = 0;
    config.total_orders = 0;
    config.total_shards_executed = 0;
    config.total_volume = 0;
    config.is_paused = false;
    config.bump = ctx.bumps.config;

    emit!(ProtocolInitialized {
        admin: config.admin,
        protocol_fee_bps: config.protocol_fee_bps,
        keeper_fee_bps: config.keeper_fee_bps,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("ProfitMaxi protocol initialized");
    msg!("Admin: {}", config.admin);
    msg!("Protocol fee: {} bps", config.protocol_fee_bps);
    msg!("Keeper fee: {} bps", config.keeper_fee_bps);

    Ok(())
}
