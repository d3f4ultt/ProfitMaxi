//! Register a new keeper
//! 
//! Keepers must be registered to execute shards and earn fees.

use anchor_lang::prelude::*;

use crate::state::Keeper;
use crate::events::KeeperRegistered;
use crate::constants::*;

#[derive(Accounts)]
pub struct RegisterKeeper<'info> {
    /// Keeper authority (must sign)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Keeper account (PDA)
    #[account(
        init,
        payer = authority,
        space = Keeper::LEN,
        seeds = [KEEPER_SEED, authority.key().as_ref()],
        bump
    )]
    pub keeper: Account<'info, Keeper>,

    /// System program
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterKeeper>) -> Result<()> {
    let keeper = &mut ctx.accounts.keeper;
    let clock = Clock::get()?;

    keeper.authority = ctx.accounts.authority.key();
    keeper.shards_executed = 0;
    keeper.volume_processed = 0;
    keeper.fees_earned = 0;
    keeper.registered_at = clock.unix_timestamp;
    keeper.last_active_at = clock.unix_timestamp;
    keeper.is_active = true;
    keeper.bump = ctx.bumps.keeper;

    emit!(KeeperRegistered {
        keeper: keeper.key(),
        authority: keeper.authority,
        timestamp: clock.unix_timestamp,
    });

    msg!("Keeper registered successfully");
    msg!("Authority: {}", keeper.authority);

    Ok(())
}
