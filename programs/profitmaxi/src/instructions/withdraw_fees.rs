//! Withdraw accumulated protocol fees (admin only)

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::state::Config;
use crate::errors::ProfitMaxiError;
use crate::events::FeesWithdrawn;
use crate::constants::*;

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    /// Protocol admin (must sign)
    #[account(
        mut,
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

    /// Fee vault (holds accumulated fees)
    #[account(
        mut,
        seeds = [FEE_VAULT_SEED],
        bump,
    )]
    pub fee_vault: SystemAccount<'info>,

    /// System program
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let clock = Clock::get()?;

    // Validate amount
    let available = ctx.accounts.fee_vault.lamports();
    require!(amount <= available, ProfitMaxiError::InsufficientBalance);

    // Transfer fees to admin
    let fee_vault_seeds = &[
        FEE_VAULT_SEED,
        &[ctx.bumps.fee_vault],
    ];
    let signer_seeds = &[&fee_vault_seeds[..]];

    // Transfer lamports from fee vault to admin
    **ctx.accounts.fee_vault.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.admin.try_borrow_mut_lamports()? += amount;

    let remaining = ctx.accounts.fee_vault.lamports();

    emit!(FeesWithdrawn {
        admin: ctx.accounts.admin.key(),
        amount,
        remaining_fees: remaining,
        timestamp: clock.unix_timestamp,
    });

    msg!("Fees withdrawn successfully");
    msg!("Amount: {} lamports", amount);
    msg!("Remaining: {} lamports", remaining);

    Ok(())
}
