//! Instruction handlers for ProfitMaxi
//! 
//! Each instruction is in its own module for organization.

pub mod initialize;
pub mod create_order;
pub mod execute_shard;
pub mod cancel_order;
pub mod update_order;
pub mod pause_order;
pub mod resume_order;
pub mod update_config;
pub mod register_keeper;
pub mod withdraw_fees;

pub use initialize::*;
pub use create_order::*;
pub use execute_shard::*;
pub use cancel_order::*;
pub use update_order::*;
pub use pause_order::*;
pub use resume_order::*;
pub use update_config::*;
pub use register_keeper::*;
pub use withdraw_fees::*;
