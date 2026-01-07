# Contributing to ProfitMaxi

Thank you for your interest in contributing to ProfitMaxi! This document provides guidelines and information for contributors.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Style Guidelines](#style-guidelines)
- [Research Contributions](#research-contributions)

## Code of Conduct

This project adheres to a Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to d3f4ult@mezzanine.dao.

## Getting Started

### Prerequisites

- **Rust** 1.70+ with `rustfmt` and `clippy`
- **Solana CLI** 1.17+
- **Anchor** 0.29+
- **Node.js** 18+ with Yarn
- **Git** with GPG signing (recommended)

### Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/profitmaxi-sol.git
cd profitmaxi-sol
git remote add upstream https://github.com/mezzanine-dao/profitmaxi-sol.git
```

## Development Setup

### Install Dependencies

```bash
# Install Rust dependencies
cargo build

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# Install Node dependencies
yarn install

# Build everything
anchor build
cd sdk && yarn build
cd ../keeper && yarn build
```

### Environment Setup

```bash
# Configure Solana for devnet
solana config set --url devnet

# Create a test wallet (if needed)
solana-keygen new --outfile ~/.config/solana/devnet.json

# Airdrop SOL for testing
solana airdrop 2
```

### Running Local Validator

```bash
# Start local validator with cloned programs
solana-test-validator \
  --clone 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 \
  --clone whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc \
  --url mainnet-beta
```

## Project Structure

```
profitmaxi-sol/
├── programs/profitmaxi/     # On-chain program (Rust/Anchor)
│   ├── src/
│   │   ├── lib.rs           # Entry point and instruction routing
│   │   ├── state.rs         # Account structures
│   │   ├── instructions/    # Instruction handlers
│   │   ├── errors.rs        # Custom error codes
│   │   ├── events.rs        # Event definitions
│   │   ├── constants.rs     # Program constants
│   │   └── utils.rs         # Helper functions
│   └── Cargo.toml
├── sdk/                     # TypeScript SDK
│   ├── src/
│   │   ├── client.ts        # Main client class
│   │   ├── types.ts         # Type definitions
│   │   ├── constants.ts     # SDK constants
│   │   ├── utils.ts         # Utility functions
│   │   └── instructions.ts  # Instruction builders
│   └── package.json
├── keeper/                  # Keeper service
│   └── src/
│       └── index.ts         # Keeper implementation
├── tests/                   # Integration tests
├── docs/                    # Documentation
├── scripts/                 # Deployment and utility scripts
└── .github/workflows/       # CI/CD pipelines
```

## Making Changes

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring
- `test/description` - Test additions/changes

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
```
feat(program): add pause/resume order functionality
fix(sdk): correct PDA derivation for escrow accounts
docs(readme): add deployment instructions
test(keeper): add unit tests for buy detection
```

## Testing

### Rust Tests

```bash
# Run all Rust tests
cargo test

# Run specific test
cargo test test_calculate_sell_amount

# Run with output
cargo test -- --nocapture
```

### Anchor Tests

```bash
# Run integration tests
anchor test

# Run specific test file
anchor test --skip-build tests/create_order.ts
```

### SDK Tests

```bash
cd sdk
yarn test

# With coverage
yarn test --coverage
```

### Writing Tests

#### Rust Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_sell_amount() {
        // r = 1.0 (100%)
        assert_eq!(calculate_sell_amount(100, 10000, 1000).unwrap(), 100);
        
        // r = 0.8 (80%)
        assert_eq!(calculate_sell_amount(100, 8000, 1000).unwrap(), 80);
    }
}
```

#### TypeScript Integration Tests

```typescript
import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';

describe('ProfitMaxi', () => {
  it('creates an order', async () => {
    const tx = await program.methods
      .createOrder(totalSize, deltaRatio, minThreshold)
      .accounts({ ... })
      .rpc();
    
    const order = await program.account.order.fetch(orderPda);
    expect(order.totalSize.toNumber()).to.equal(totalSize.toNumber());
  });
});
```

## Submitting Changes

### Pull Request Process

1. **Update your fork**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Create a branch**
   ```bash
   git checkout -b feature/my-feature
   ```

3. **Make changes and commit**
   ```bash
   git add .
   git commit -m "feat(scope): description"
   ```

4. **Push and create PR**
   ```bash
   git push origin feature/my-feature
   ```

5. **PR Requirements**
   - Clear description of changes
   - Link to related issues
   - Tests for new functionality
   - Documentation updates
   - Passing CI checks

### Review Process

- At least one maintainer approval required
- All CI checks must pass
- No merge conflicts
- Squash and merge preferred

## Style Guidelines

### Rust

- Follow `rustfmt` defaults
- Use `clippy` with no warnings
- Document public APIs with `///`
- Use meaningful variable names

```rust
/// Calculate the sell amount based on trigger buy and delta ratio
///
/// # Arguments
/// * `trigger_buy` - The incoming buy amount
/// * `delta_ratio_bps` - Delta ratio in basis points
/// * `remaining` - Remaining order size
///
/// # Returns
/// The calculated sell amount
pub fn calculate_sell_amount(
    trigger_buy: u64,
    delta_ratio_bps: u16,
    remaining: u64,
) -> Result<u64> {
    // Implementation
}
```

### TypeScript

- Use TypeScript strict mode
- Follow ESLint configuration
- Document with JSDoc
- Use descriptive names

```typescript
/**
 * Calculate the expected output from an AMM swap
 * 
 * @param amountIn - Input token amount
 * @param reserveIn - Reserve of input token
 * @param reserveOut - Reserve of output token
 * @returns Expected output amount
 */
export function calculateAmmOutput(
  amountIn: BN,
  reserveIn: BN,
  reserveOut: BN
): BN {
  // Implementation
}
```

## Research Contributions

We welcome academic and research contributions:

### Areas of Interest

- **Mathematical Analysis**: Proving additional properties
- **Simulation**: Extending Monte Carlo analysis
- **Game Theory**: MEV resistance analysis
- **Economic Models**: Fee optimization

### Submitting Research

1. Open an issue describing the research
2. Include methodology and preliminary results
3. Submit paper/analysis as PR to `docs/research/`
4. Present findings in discussion

### Citation

If you use ProfitMaxi in research, please cite:

```bibtex
@misc{profitmaxi2024,
  author = {Liverman, Justin},
  title = {ProfitMaxi: Volume-Sensitive Limit Orders for AMM Liquidity Pools},
  year = {2024},
  publisher = {GitHub},
  url = {https://github.com/mezzanine-dao/profitmaxi-sol}
}
```

## Questions?

- Open a GitHub issue
- Join our Discord (coming soon)
- Email: d3f4ult@mezzanine.dao

---

Thank you for contributing to ProfitMaxi! 🚀
