//! Simulated market-update producer, compiled to WebAssembly and run inside a Web Worker.
//!
//! The JavaScript side talks to this crate through a raw C ABI (no `wasm-bindgen`):
//! the producer writes fixed-size records of little-endian `u32` words into its own
//! linear memory and JavaScript reads them through a `Uint32Array` view.
//! See `docs/IMPLEMENTATION_PLAN.md` §3.1 for the full ABI contract.

/// Version of the JS ↔ Wasm ABI. Bump on any change to exports or record layout;
/// the TypeScript adapter refuses to run against a mismatching module.
pub const ABI_VERSION: u32 = 1;

/// Returns [`ABI_VERSION`] so the TypeScript adapter can verify the module it loaded.
#[unsafe(no_mangle)]
pub extern "C" fn abi_version() -> u32 {
    ABI_VERSION
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abi_version_export_matches_constant() {
        // Act
        let version = abi_version();

        // Assert
        assert_eq!(version, ABI_VERSION);
    }
}
