//! Custom error codes for ProfitMaxi
//! 
//! Error codes are organized by category:
//! - 6000-6099: Validation errors
//! - 6100-6199: Authorization errors
//! - 6200-6299: State errors
//! - 6300-6399: Execution errors
//! - 6400-6499: AMM integration errors

use anchor_lang::prelude::*;

#[error_code]
pub enum ProfitMaxiError {
    // =========================================================================
    // Validation Errors (6000-6099)
    // =========================================================================
    
    /// Delta ratio must be between 1 and 10000 basis points (0.01% to 100%)
    #[msg("Delta ratio must be between 1 and 10000 basis points")]
    InvalidDeltaRatio,

    /// Order size must be greater than 0
    #[msg("Order size must be greater than 0")]
    InvalidOrderSize,

    /// Minimum threshold must be greater than 0
    #[msg("Minimum threshold must be greater than 0")]
    InvalidThreshold,

    /// Fee basis points exceed maximum allowed (1000 = 10%)
    #[msg("Fee exceeds maximum allowed (10%)")]
    FeeTooHigh,

    /// Invalid AMM pool configuration
    #[msg("Invalid AMM pool configuration")]
    InvalidAmmPool,

    /// Token mint mismatch
    #[msg("Token mint does not match order")]
    TokenMintMismatch,

    /// Quote mint mismatch
    #[msg("Quote mint does not match order")]
    QuoteMintMismatch,

    /// Insufficient token balance for order
    #[msg("Insufficient token balance for order")]
    InsufficientBalance,

    /// Invalid slippage tolerance
    #[msg("Slippage tolerance must be between 0 and 10000 bps")]
    InvalidSlippage,

    // =========================================================================
    // Authorization Errors (6100-6199)
    // =========================================================================

    /// Signer is not the order owner
    #[msg("Unauthorized: not the order owner")]
    NotOrderOwner,

    /// Signer is not the protocol admin
    #[msg("Unauthorized: not the protocol admin")]
    NotAdmin,

    /// Signer is not a registered keeper
    #[msg("Unauthorized: not a registered keeper")]
    NotRegisteredKeeper,

    /// Keeper is not active
    #[msg("Keeper is not active")]
    KeeperNotActive,

    // =========================================================================
    // State Errors (6200-6299)
    // =========================================================================

    /// Order is not in active status
    #[msg("Order is not active")]
    OrderNotActive,

    /// Order is already filled
    #[msg("Order is already completely filled")]
    OrderAlreadyFilled,

    /// Order is paused
    #[msg("Order is currently paused")]
    OrderPaused,

    /// Order is already paused
    #[msg("Order is already paused")]
    OrderAlreadyPaused,

    /// Order is not paused
    #[msg("Order is not paused")]
    OrderNotPaused,

    /// Protocol is paused
    #[msg("Protocol is currently paused")]
    ProtocolPaused,

    /// Config already initialized
    #[msg("Protocol config is already initialized")]
    ConfigAlreadyInitialized,

    /// Keeper already registered
    #[msg("Keeper is already registered")]
    KeeperAlreadyRegistered,

    // =========================================================================
    // Execution Errors (6300-6399)
    // =========================================================================

    /// Trigger buy amount is below the minimum threshold
    #[msg("Trigger buy amount is below minimum threshold")]
    BelowThreshold,

    /// Calculated sell amount is zero
    #[msg("Calculated sell amount is zero")]
    ZeroSellAmount,

    /// Slippage exceeded
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    /// No tokens remaining to sell
    #[msg("No tokens remaining in escrow")]
    NoTokensRemaining,

    /// Arithmetic overflow in calculation
    #[msg("Arithmetic overflow in calculation")]
    MathOverflow,

    /// Arithmetic underflow in calculation
    #[msg("Arithmetic underflow in calculation")]
    MathUnderflow,

    // =========================================================================
    // AMM Integration Errors (6400-6499)
    // =========================================================================

    /// AMM swap failed
    #[msg("AMM swap execution failed")]
    AmmSwapFailed,

    /// AMM program mismatch
    #[msg("AMM program does not match order configuration")]
    AmmProgramMismatch,

    /// AMM pool has insufficient liquidity
    #[msg("AMM pool has insufficient liquidity")]
    InsufficientLiquidity,

    /// Unsupported AMM type
    #[msg("Unsupported AMM type")]
    UnsupportedAmm,

    /// Invalid AMM accounts provided
    #[msg("Invalid AMM accounts provided")]
    InvalidAmmAccounts,

    /// AMM pool is not active
    #[msg("AMM pool is not active")]
    AmmPoolNotActive,
}
