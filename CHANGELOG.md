# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial Solana program implementation
- TypeScript SDK with client and utilities
- Keeper service framework
- Monte Carlo simulation validation
- Comprehensive documentation

## [0.1.0] - 2024-XX-XX

### Added

#### Smart Contract
- `initialize` instruction for protocol setup
- `create_order` instruction for volume-sensitive limit orders
- `execute_shard` instruction for keeper-triggered partial fills
- `cancel_order` instruction with token return
- `update_order` instruction for parameter modification
- `pause_order` and `resume_order` instructions
- `register_keeper` instruction for keeper registration
- `update_config` and `withdraw_fees` admin instructions
- Custom error codes for all failure modes
- Event emissions for indexing and tracking

#### SDK
- `ProfitMaxiClient` class with full protocol interaction
- PDA derivation utilities
- Order simulation and analytics
- Event subscription helpers
- Math utilities matching on-chain calculations

#### Keeper
- Pool monitoring via WebSocket and polling
- Buy event detection
- Profitability calculation
- Automated shard execution
- Jito bundle support (placeholder)

#### Documentation
- Whitepaper with mathematical proofs
- SDK reference documentation
- Keeper operation guide
- Integration examples

### Security
- Input validation on all instructions
- Owner authorization checks
- Admin-only function protection
- Arithmetic overflow protection

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.1.0   | TBD  | Initial release |

## Upcoming

### v0.2.0 (Planned)
- Raydium V4 integration
- Orca Whirlpool integration
- Enhanced keeper monitoring
- Web UI for order management

### v0.3.0 (Planned)
- Security audit completion
- Mainnet deployment
- Multi-AMM support
- Advanced analytics

### v1.0.0 (Planned)
- Production-ready release
- EVM implementation (Ethereum, BSC)
- Cross-chain support
