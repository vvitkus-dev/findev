//! The raw C ABI that JavaScript calls (see `specs/market-dashboard/design.md` §3.1).
//!
//! Pointers cross the boundary as plain integers. A producer pointer is created only by
//! [`producer_create`] (a leaked `Box`) and released only by [`producer_destroy`]. Every invalid
//! input returns null (0) instead of trapping, so JavaScript can report a clean error.

use core::ptr;

use crate::model::RECORD_WORDS;
use crate::producer::Producer;

/// Version of the JS ↔ Wasm ABI. Bump on any change to exports or record layout;
/// the TypeScript adapter refuses to run against a mismatching module.
pub const ABI_VERSION: u32 = 1;
/// `u32` words per record, as exported to JavaScript.
pub const RECORD_WORDS_U32: u32 = 7;
const _: () = assert!(RECORD_WORDS_U32 as usize == RECORD_WORDS);

/// Returns [`ABI_VERSION`] so the TypeScript adapter can verify the module it loaded.
#[unsafe(no_mangle)]
pub extern "C" fn abi_version() -> u32 {
    ABI_VERSION
}

/// Returns the number of `u32` words per update record.
#[unsafe(no_mangle)]
pub extern "C" fn record_words() -> u32 {
    RECORD_WORDS_U32
}

/// Creates a producer seeded with `seed_hi:seed_lo` (JavaScript has no native `u64`).
/// Returns null when `instrument_count ∉ [1, MAX_INSTRUMENTS]`.
#[unsafe(no_mangle)]
pub extern "C" fn producer_create(
    instrument_count: u32,
    seed_lo: u32,
    seed_hi: u32,
) -> *mut Producer {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    Producer::new(instrument_count, seed).map_or(ptr::null_mut(), |p| Box::into_raw(Box::new(p)))
}

/// Generates `n` records and returns a pointer to the first word (`n × 7` words follow).
/// The data stays valid until the next `producer_generate` or `producer_destroy` call on `p`.
/// Returns null when `p` is null or `n ∉ [1, MAX_BATCH]`.
///
/// # Safety
/// `p` must be null or a pointer returned by [`producer_create`] that has not been destroyed,
/// and no other reference to that producer may be live during the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn producer_generate(p: *mut Producer, n: u32) -> *const u32 {
    // SAFETY: the caller guarantees `p` is null or a live, unaliased producer from `producer_create`.
    let Some(producer) = (unsafe { p.as_mut() }) else {
        return ptr::null();
    };
    producer.generate(n).map_or(ptr::null(), <[u32]>::as_ptr)
}

/// Destroys a producer. Null is a no-op.
///
/// # Safety
/// `p` must be null or a pointer returned by [`producer_create`] that has not been destroyed yet.
/// After this call `p` (and any record pointer obtained from it) must not be used.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn producer_destroy(p: *mut Producer) {
    if !p.is_null() {
        // SAFETY: `p` came from `Box::into_raw` in `producer_create` and is destroyed only once.
        drop(unsafe { Box::from_raw(p) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::producer::{MAX_BATCH, MAX_INSTRUMENTS};

    /// Copies `n` records out of Wasm-style memory, like the JS `Uint32Array` view does.
    fn read(p: *mut Producer, n: u32) -> Vec<u32> {
        // SAFETY: tests pass only live producers created in the same test.
        let words = unsafe { producer_generate(p, n) };
        assert!(!words.is_null(), "generate({n}) returned null");
        // SAFETY: a non-null result points at exactly n × RECORD_WORDS initialised words.
        unsafe { core::slice::from_raw_parts(words, n as usize * RECORD_WORDS) }.to_vec()
    }

    #[test]
    fn version_and_record_size_exports() {
        // Act
        let exports = (abi_version(), record_words());

        // Assert
        assert_eq!(exports, (ABI_VERSION, 7));
    }

    #[test]
    fn create_rejects_out_of_range_instrument_counts() {
        // Act
        let zero = producer_create(0, 1, 0);
        let too_many = producer_create(MAX_INSTRUMENTS + 1, 1, 0);

        // Assert
        assert!(zero.is_null());
        assert!(too_many.is_null());
    }

    #[test]
    fn generate_rejects_null_producer_and_invalid_sizes() {
        // Arrange
        let p = producer_create(3, 1, 0);

        // Act
        // SAFETY: null is explicitly allowed; `p` is live until destroyed below.
        let results = unsafe {
            [
                producer_generate(ptr::null_mut(), 10),
                producer_generate(p, 0),
                producer_generate(p, MAX_BATCH + 1),
            ]
        };

        // Assert
        assert!(results.iter().all(|r| r.is_null()));
        // SAFETY: `p` was created above and is destroyed exactly once.
        unsafe { producer_destroy(p) };
    }

    #[test]
    fn generate_returns_the_producer_records_for_the_combined_seed() {
        // Arrange — seed 0x0000_0002_0000_0001 split into lo/hi halves
        let p = producer_create(4, 1, 2);
        let mut reference = Producer::new(4, (2 << 32) | 1).unwrap();

        // Act
        let words = read(p, 100);

        // Assert
        assert_eq!(words, reference.generate(100).unwrap());
        // SAFETY: `p` was created above and is destroyed exactly once.
        unsafe { producer_destroy(p) };
    }

    #[test]
    fn both_seed_halves_affect_the_output() {
        // Arrange
        let base = producer_create(4, 1, 2);
        let other_hi = producer_create(4, 1, 3);
        let other_lo = producer_create(4, 9, 2);

        // Act
        let (a, b, c) = (read(base, 50), read(other_hi, 50), read(other_lo, 50));

        // Assert
        assert_ne!(a, b);
        assert_ne!(a, c);
        for p in [base, other_hi, other_lo] {
            // SAFETY: each pointer was created above and is destroyed exactly once.
            unsafe { producer_destroy(p) };
        }
    }

    #[test]
    fn create_and_destroy_ten_thousand_times() {
        // Act
        let all_ok = (0..10_000_u32).all(|i| {
            let p = producer_create(1 + i % MAX_INSTRUMENTS, i, !i);
            let created = !p.is_null();
            // SAFETY: `p` is live and unaliased; it is generated from once and destroyed once.
            let generated = unsafe { !producer_generate(p, 1).is_null() };
            // SAFETY: as above.
            unsafe { producer_destroy(p) };
            created && generated
        });

        // Assert
        assert!(all_ok);
    }

    #[test]
    fn destroy_null_is_a_no_op() {
        // Act
        // SAFETY: null is explicitly allowed.
        unsafe { producer_destroy(ptr::null_mut()) };

        // Assert — reaching this line without a crash is the assertion
        assert!(producer_create(0, 0, 0).is_null());
    }
}
