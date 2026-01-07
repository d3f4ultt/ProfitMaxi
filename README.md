# ProfitMaxi

> Volume-Sensitive Limit Orders for AMM Liquidity Pools

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Solana](https://img.shields.io/badge/Solana-Mainnet-purple)](https://solana.com)

**ProfitMaxi** is a novel order type that enables large position exits with minimal price impact by matching sell execution proportionally to incoming buy volume.

## 🚀 Key Innovation

Traditional limit orders execute based on **price** or **time**. ProfitMaxi orders execute based on **volume**.

```
Traditional Market Sell (50 SOL position):
├── Single transaction
├── Price impact: -25%
└── Loss: 12.5 SOL

ProfitMaxi Exit (50 SOL position, r=1.0):
├── Multiple shards matched to buys
├── Price impact: -1%
└── Loss: 0.5 SOL
└── Savings: 12 SOL (96% reduction)
```

## 📖 How It Works

### The Delta Ratio (r)

| Delta Ratio | Behavior | Use Case |
|-------------|----------|----------|
| r = 1.0 (100%) | Price neutral | Stealth exit, minimal chart impact |
| r = 0.8 (80%) | +6% positive drift | Balanced approach |
| r = 0.5 (50%) | +22% positive drift | Strong price support |
| r = 0.3 (30%) | +53% positive drift | Maximum pump while exiting |

### Execution Formula

For each qualifying buy of size `B`:
```
sell_amount = min(B × r, remaining_order)
```

Where:
- `B` = incoming buy volume
- `r` = delta ratio (0.01 to 1.0)
- `remaining` = unfilled order size

## 🏗️ Architecture

```
profitmaxi-sol/
├── programs/profitmaxi/     # Anchor smart contract
│   └── src/
│       ├── lib.rs           # Program entry point
│       ├── state.rs         # Account structures
│       ├── instructions/    # Instruction handlers
│       └── utils.rs         # Math utilities
├── sdk/                     # TypeScript SDK
│   └── src/
│       ├── client.ts        # Main client
│       ├── amm/             # Multi-DEX adapters
│       │   ├── raydium.ts   # Raydium V4/CPMM
│       │   ├── pumpswap.ts  # PumpSwap (pump.fun)
│       │   ├── meteora.ts   # Meteora DLMM
│       │   └── aggregator.ts # Pool discovery & ranking
│       └── types.ts
└── keeper/                  # Keeper service
    └── src/
        └── multi-dex-keeper.ts
```

## 🔧 Supported DEXes

ProfitMaxi monitors and executes across multiple AMMs:

| Protocol | Type | Fee | Status |
|----------|------|-----|--------|
| Raydium V4 | CPMM | 0.25% | ✅ Supported |
| Raydium CPMM | CPMM | 0.25% | ✅ Supported |
| PumpSwap | CPMM | 1.0% | ✅ Supported |
| Meteora DLMM | DLMM | Variable | ✅ Supported |
| Orca Whirlpool | CLMM | Variable | 🔜 Coming |

### Primary Pool Selection

For each token, ProfitMaxi automatically selects the primary pool based on:

1. **Liquidity** (40% weight) - Higher liquidity = better execution
2. **Age** (30% weight) - Older pools = more established
3. **Volume** (20% weight) - Higher volume = more active
4. **Fees** (10% weight) - Lower fees = better returns

## 📦 Installation

### Prerequisites

- Rust 1.70+
- Solana CLI 1.17+
- Anchor 0.29+
- Node.js 18+

### Build

```bash
# Clone repository
git clone https://github.com/mezzanine-dao/profitmaxi-sol
cd profitmaxi-sol

# Build Anchor program
anchor build

# Install SDK dependencies
cd sdk && npm install && npm run build

# Install keeper dependencies
cd ../keeper && npm install && npm run build
```

### Deploy

```bash
# Deploy to devnet
anchor deploy --provider.cluster devnet

# Deploy to mainnet
anchor deploy --provider.cluster mainnet
```

## 🎯 Usage

### Create an Order (TypeScript)

```typescript
import { ProfitMaxiClient } from '@profitmaxi/sdk';
import { Connection, Keypair } from '@solana/web3.js';
import BN from 'bn.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const client = new ProfitMaxiClient({ connection });

// Create a volume-sensitive limit order
const tx = await client.createOrder({
  totalSize: new BN(50_000_000_000), // 50 SOL worth
  deltaRatioBps: 8000,               // 80% (r=0.8)
  minThreshold: new BN(100_000_000), // 0.1 SOL minimum buy
  tokenMint: TOKEN_MINT,
  quoteMint: WSOL_MINT,
  ammPool: POOL_ADDRESS,
  ammProgram: RAYDIUM_PROGRAM_ID,
});
```

### Run the Keeper

```bash
# Set environment variables
export RPC_ENDPOINT="https://your-rpc-endpoint.com"
export KEEPER_PRIVATE_KEY="[your,keypair,bytes]"
export DRY_RUN="true"  # Set to false for live execution

# Start keeper
cd keeper && npm run start
```

### Keeper Configuration

```env
# .env
RPC_ENDPOINT=https://api.mainnet-beta.solana.com
KEEPER_PRIVATE_KEY=[...]
POLL_INTERVAL=1000
MIN_PROFIT=10000
DRY_RUN=true
MIN_POOL_LIQUIDITY=100000000000
JITO_ENDPOINT=https://mainnet.block-engine.jito.wtf
```

## 📊 Mathematical Foundation

### Theorem 1: Price Preservation (r = 1.0)

For delta ratio r = 1.0, the net price impact approaches zero:

```
ΔP/P₀ = O(ε²)
```

Where ε = B/y₀ (trade size / pool depth).

### Theorem 2: Positive Drift (r < 1.0)

For r = 1 - δ where δ > 0:

```
ΔP/P₀ ≈ (1-r) × B/y₀ > 0
```

Lower delta ratios create sustained upward price pressure.

### Theorem 3: Fill Guarantee

Given Poisson buy arrivals (rate λ > 0, mean size B̄ > 0), order fills with probability 1:

```
E[t_fill] = T / (r × λ × B̄_θ)
```

## 🔐 Security

### Audit Status

⚠️ **UNAUDITED** - This code is in development. Do not use in production without professional audit.

### Known Considerations

- MEV Protection: Use Jito bundles for execution
- Slippage: Dynamic slippage based on pool depth
- Oracle Risk: No oracle dependency (uses AMM reserves)

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development

```bash
# Run tests
anchor test

# Run SDK tests
cd sdk && npm test

# Lint
npm run lint
```

## 📜 License

MIT License - see [LICENSE](LICENSE)

## 📚 Documentation

- [Whitepaper](docs/WHITEPAPER.md) - Full technical specification
- [API Reference](docs/API.md) - SDK documentation
- [Keeper Guide](docs/KEEPER.md) - Running a keeper node

## 🙏 Acknowledgments

- Built on [Anchor](https://www.anchor-lang.com/)
- Inspired by TradFi POV algorithms
- Community feedback from [Mezzanine DAO](https://)

---

**Author:** Justin Liverman 
**Twitter:** @_d3f4ult
**Organization:** @MezzanineDAO  
**Contact:** d3f4ult@apolloalgo.ai
