//! Utility functions for ProfitMaxi
//! 
//! Helper functions for math operations, price calculations, and validation.

use anchor_lang::prelude::*;
use crate::errors::ProfitMaxiError;
use crate::constants::*;

/// Calculate the sell amount based on trigger buy and delta ratio
/// 
/// Formula: sell_amount = (trigger_buy * delta_ratio_bps) / 10000
/// 
/// # Arguments
/// 
/// * `trigger_buy` - The incoming buy amount in quote currency
/// * `delta_ratio_bps` - Delta ratio in basis points (1-10000)
/// * `remaining` - Remaining order size
/// 
/// # Returns
/// 
/// The calculated sell amount, capped at remaining
pub fn calculate_sell_amount(
    trigger_buy: u64,
    delta_ratio_bps: u16,
    remaining: u64,
) -> Result<u64> {
    // sell = trigger * (delta_ratio / 10000)
    let proportional = (trigger_buy as u128)
        .checked_mul(delta_ratio_bps as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(ProfitMaxiError::MathOverflow)? as u64;
    
    // Cap at remaining
    Ok(std::cmp::min(proportional, remaining))
}

/// Calculate tokens to sell for a given quote value
/// 
/// Uses AMM spot price: tokens = quote_value / price
/// 
/// # Arguments
/// 
/// * `quote_value` - Value in quote currency (lamports)
/// * `token_reserve` - Current token reserve in pool
/// * `quote_reserve` - Current quote reserve in pool
/// 
/// # Returns
/// 
/// Number of tokens to sell
pub fn calculate_tokens_for_quote(
    quote_value: u64,
    token_reserve: u64,
    quote_reserve: u64,
) -> Result<u64> {
    if quote_reserve == 0 {
        return Err(ProfitMaxiError::InsufficientLiquidity.into());
    }
    
    // price = quote_reserve / token_reserve
    // tokens = quote_value / price = quote_value * token_reserve / quote_reserve
    let tokens = (quote_value as u128)
        .checked_mul(token_reserve as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?
        .checked_div(quote_reserve as u128)
        .ok_or(ProfitMaxiError::MathOverflow)? as u64;
    
    Ok(tokens)
}

/// Calculate the expected output from an AMM swap
/// 
/// Uses constant product formula: (x + dx)(y - dy) = xy
/// Solving for dy: dy = y * dx / (x + dx)
/// 
/// # Arguments
/// 
/// * `amount_in` - Input token amount
/// * `reserve_in` - Reserve of input token
/// * `reserve_out` - Reserve of output token
/// * `fee_bps` - AMM fee in basis points (typically 25-30)
/// 
/// # Returns
/// 
/// Expected output amount
pub fn calculate_amm_output(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_bps: u16,
) -> Result<u64> {
    if reserve_in == 0 || reserve_out == 0 {
        return Err(ProfitMaxiError::InsufficientLiquidity.into());
    }
    
    // Apply fee: amount_in_with_fee = amount_in * (10000 - fee_bps) / 10000
    let amount_in_with_fee = (amount_in as u128)
        .checked_mul((BPS_DENOMINATOR as u16 - fee_bps) as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    
    // dy = y * dx / (x + dx)
    let numerator = amount_in_with_fee
        .checked_mul(reserve_out as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    
    let denominator = (reserve_in as u128)
        .checked_mul(BPS_DENOMINATOR as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?
        .checked_add(amount_in_with_fee)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    
    let amount_out = numerator
        .checked_div(denominator)
        .ok_or(ProfitMaxiError::MathOverflow)? as u64;
    
    Ok(amount_out)
}

/// Calculate the price impact of a trade
/// 
/// Returns impact in basis points (100 = 1%)
/// 
/// # Arguments
/// 
/// * `amount_in` - Input amount
/// * `reserve_in` - Reserve of input token
/// * `reserve_out` - Reserve of output token
/// 
/// # Returns
/// 
/// Price impact in basis points
pub fn calculate_price_impact(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
) -> Result<u64> {
    if reserve_in == 0 || reserve_out == 0 {
        return Err(ProfitMaxiError::InsufficientLiquidity.into());
    }
    
    // Spot price before: reserve_out / reserve_in
    // Spot price after: (reserve_out - amount_out) / (reserve_in + amount_in)
    // Impact = (price_after - price_before) / price_before * 10000
    
    let amount_out = calculate_amm_output(amount_in, reserve_in, reserve_out, 0)?;
    
    let price_before = (reserve_out as u128)
        .checked_mul(PRICE_PRECISION as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?
        .checked_div(reserve_in as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    
    let new_reserve_out = reserve_out.saturating_sub(amount_out);
    let new_reserve_in = reserve_in.saturating_add(amount_in);
    
    let price_after = (new_reserve_out as u128)
        .checked_mul(PRICE_PRECISION as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?
        .checked_div(new_reserve_in as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    
    // Impact in bps
    let impact = if price_before > price_after {
        ((price_before - price_after) * BPS_DENOMINATOR as u128 / price_before) as u64
    } else {
        0
    };
    
    Ok(impact)
}

/// Calculate weighted average execution price
/// 
/// # Arguments
/// 
/// * `prev_avg` - Previous average price
/// * `prev_volume` - Previous total volume
/// * `new_price` - New execution price
/// * `new_volume` - New execution volume
/// 
/// # Returns
/// 
/// Updated weighted average price
pub fn calculate_weighted_avg_price(
    prev_avg: u64,
    prev_volume: u64,
    new_price: u64,
    new_volume: u64,
) -> Result<u64> {
    let total_volume = prev_volume
        .checked_add(new_volume)
        .ok_or(ProfitMaxiError::MathOverflow)?;
    
    if total_volume == 0 {
        return Ok(0);
    }
    
    let weighted_sum = (prev_avg as u128)
        .checked_mul(prev_volume as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?
        .checked_add(
            (new_price as u128)
                .checked_mul(new_volume as u128)
                .ok_or(ProfitMaxiError::MathOverflow)?
        )
        .ok_or(ProfitMaxiError::MathOverflow)?;
    
    let avg = weighted_sum
        .checked_div(total_volume as u128)
        .ok_or(ProfitMaxiError::MathOverflow)? as u64;
    
    Ok(avg)
}

/// Calculate keeper fee from sell amount
/// 
/// # Arguments
/// 
/// * `sell_amount` - The sell amount in quote currency
/// * `keeper_fee_bps` - Keeper fee in basis points
/// 
/// # Returns
/// 
/// Keeper fee amount
pub fn calculate_keeper_fee(sell_amount: u64, keeper_fee_bps: u16) -> Result<u64> {
    let fee = (sell_amount as u128)
        .checked_mul(keeper_fee_bps as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(ProfitMaxiError::MathOverflow)? as u64;
    
    Ok(fee)
}

/// Calculate protocol fee from sell amount
/// 
/// # Arguments
/// 
/// * `sell_amount` - The sell amount in quote currency
/// * `protocol_fee_bps` - Protocol fee in basis points
/// 
/// # Returns
/// 
/// Protocol fee amount
pub fn calculate_protocol_fee(sell_amount: u64, protocol_fee_bps: u16) -> Result<u64> {
    let fee = (sell_amount as u128)
        .checked_mul(protocol_fee_bps as u128)
        .ok_or(ProfitMaxiError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(ProfitMaxiError::MathOverflow)? as u64;
    
    Ok(fee)
}

/// Validate delta ratio is within bounds
pub fn validate_delta_ratio(delta_ratio_bps: u16) -> Result<()> {
    require!(
        delta_ratio_bps >= MIN_DELTA_RATIO_BPS && delta_ratio_bps <= MAX_DELTA_RATIO_BPS,
        ProfitMaxiError::InvalidDeltaRatio
    );
    Ok(())
}

/// Validate order size is within bounds
pub fn validate_order_size(size: u64) -> Result<()> {
    require!(
        size >= MIN_ORDER_SIZE && size <= MAX_ORDER_SIZE,
        ProfitMaxiError::InvalidOrderSize
    );
    Ok(())
}

/// Validate threshold is above minimum
pub fn validate_threshold(threshold: u64) -> Result<()> {
    require!(
        threshold >= MIN_THRESHOLD,
        ProfitMaxiError::InvalidThreshold
    );
    Ok(())
}

/// Get current Unix timestamp
pub fn get_timestamp() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_sell_amount() {
        // r = 1.0 (100%)
        assert_eq!(calculate_sell_amount(100, 10000, 1000).unwrap(), 100);
        
        // r = 0.8 (80%)
        assert_eq!(calculate_sell_amount(100, 8000, 1000).unwrap(), 80);
        
        // r = 0.5 (50%)
        assert_eq!(calculate_sell_amount(100, 5000, 1000).unwrap(), 50);
        
        // Capped at remaining
        assert_eq!(calculate_sell_amount(100, 10000, 50).unwrap(), 50);
    }

    #[test]
    fn test_calculate_amm_output() {
        // Simple pool: 1000 tokens, 1000 SOL
        // Swap 10 SOL for tokens (0% fee)
        let output = calculate_amm_output(10, 1000, 1000, 0).unwrap();
        // Expected: 1000 * 10 / (1000 + 10) = 9.9009...
        assert!(output >= 9 && output <= 10);
        
        // With 0.3% fee (30 bps)
        let output_with_fee = calculate_amm_output(10, 1000, 1000, 30).unwrap();
        assert!(output_with_fee < output);
    }

    #[test]
    fn test_calculate_weighted_avg_price() {
        // First trade: 100 @ price 10
        let avg1 = calculate_weighted_avg_price(0, 0, 10, 100).unwrap();
        assert_eq!(avg1, 10);
        
        // Second trade: 100 @ price 20
        let avg2 = calculate_weighted_avg_price(10, 100, 20, 100).unwrap();
        assert_eq!(avg2, 15); // (10*100 + 20*100) / 200 = 15
    }
}
