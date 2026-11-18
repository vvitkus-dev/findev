//! Simulated market-update producer, compiled to WebAssembly and run inside a Web Worker.
//!
//! The JavaScript side talks to this crate through a raw C ABI (no `wasm-bindgen`):
//! the producer writes fixed-size records of little-endian `u32` words into its own
//! linear memory and JavaScript reads them through a `Uint32Array` view.
//! See `docs/IMPLEMENTATION_PLAN.md` §3.1 for the full ABI contract.

mod abi;
pub mod model;
pub mod producer;
pub mod rng;

pub use abi::{
    ABI_VERSION, RECORD_WORDS_U32, abi_version, producer_create, producer_destroy,
    producer_generate, record_words,
};
pub use producer::{MAX_BATCH, MAX_INSTRUMENTS};
