//! A producer owns N instruments, one RNG and one reusable output buffer.
//! `generate(n)` appends nothing and allocates nothing after warm-up: it clears the buffer and
//! writes `n` records of [`RECORD_WORDS`](crate::model::RECORD_WORDS) words, picking a random instrument for each update.

use crate::model::InstrumentState;
use crate::rng::Rng;

/// Largest instrument count a producer accepts.
pub const MAX_INSTRUMENTS: u32 = 50;
/// Largest number of updates per `generate` call.
pub const MAX_BATCH: u32 = 1_000;

/// Market-update producer for `1..=MAX_INSTRUMENTS` instruments.
#[derive(Debug)]
pub struct Producer {
    rng: Rng,
    instruments: Vec<InstrumentState>,
    instrument_count: u32,
    buf: Vec<u32>,
}

impl Producer {
    /// Creates a producer, or `None` when `instrument_count ∉ [1, MAX_INSTRUMENTS]`.
    #[must_use]
    pub fn new(instrument_count: u32, seed: u64) -> Option<Self> {
        if !(1..=MAX_INSTRUMENTS).contains(&instrument_count) {
            return None;
        }
        let mut rng = Rng::from_seed(seed);
        let instruments = (0..instrument_count)
            .map(|_| InstrumentState::new(&mut rng))
            .collect();
        Some(Self {
            rng,
            instruments,
            instrument_count,
            buf: Vec::new(),
        })
    }

    /// Writes `n` updates into the internal buffer and returns them as `n × RECORD_WORDS`
    /// words, or `None` when `n ∉ [1, MAX_BATCH]`. The slice is valid until the next call.
    pub fn generate(&mut self, n: u32) -> Option<&[u32]> {
        if !(1..=MAX_BATCH).contains(&n) {
            return None;
        }
        self.buf.clear();
        for _ in 0..n {
            let index = self.rng.below(self.instrument_count);
            let state = self.instruments.get_mut(index as usize)?;
            let update = state.step(&mut self.rng, index);
            self.buf.extend_from_slice(&update.words());
        }
        Some(&self.buf)
    }

    /// Capacity of the reusable buffer, in words (exposed for allocation tests).
    #[must_use]
    pub fn buffer_capacity(&self) -> usize {
        self.buf.capacity()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{RECORD_WORDS, Update, test_support::assert_invariants};

    fn records(words: &[u32]) -> Vec<Update> {
        let (chunks, rest) = words.as_chunks::<RECORD_WORDS>();
        assert!(rest.is_empty(), "partial record");
        chunks
            .iter()
            .map(
                |&[
                    instrument,
                    price_cents,
                    trade_qty,
                    bid_cents,
                    ask_cents,
                    bid_qty,
                    ask_qty,
                ]| {
                    Update {
                        instrument,
                        price_cents,
                        trade_qty,
                        bid_cents,
                        ask_cents,
                        bid_qty,
                        ask_qty,
                    }
                },
            )
            .collect()
    }

    #[test]
    fn generate_returns_exactly_n_records() {
        // Arrange
        let mut producer = Producer::new(5, 1).unwrap();

        // Act
        let lengths: Vec<usize> = [1, 2, 100, 1_000]
            .iter()
            .map(|&n| producer.generate(n).unwrap().len())
            .collect();

        // Assert
        assert_eq!(lengths, [7, 14, 700, 7_000]);
    }

    #[test]
    fn every_instrument_index_is_in_range_and_appears() {
        // Arrange
        let mut producer = Producer::new(3, 9).unwrap();

        // Act
        let updates: Vec<Update> = (0..3)
            .flat_map(|_| records(producer.generate(1_000).unwrap()))
            .collect();

        // Assert
        let mut seen = [0_u32; 3];
        for u in &updates {
            assert_invariants(u);
            seen[u.instrument as usize] += 1; // panics if index ≥ 3
        }
        assert!(seen.iter().all(|&c| c > 800), "instrument counts {seen:?}");
    }

    #[test]
    fn same_seed_produces_identical_batches() {
        // Arrange
        let mut a = Producer::new(10, 77).unwrap();
        let mut b = Producer::new(10, 77).unwrap();

        // Act
        let xs: Vec<u32> = (0..5)
            .flat_map(|_| a.generate(200).unwrap().to_vec())
            .collect();
        let ys: Vec<u32> = (0..5)
            .flat_map(|_| b.generate(200).unwrap().to_vec())
            .collect();

        // Assert
        assert_eq!(xs, ys);
    }

    #[test]
    fn different_seeds_produce_different_batches() {
        // Arrange
        let mut a = Producer::new(10, 1).unwrap();
        let mut b = Producer::new(10, 2).unwrap();

        // Act
        let xs = a.generate(100).unwrap().to_vec();
        let ys = b.generate(100).unwrap().to_vec();

        // Assert
        assert_ne!(xs, ys);
    }

    #[test]
    fn state_carries_over_between_batches() {
        // Arrange — one producer emits 2 × 50, the other 1 × 100 from the same seed
        let mut split = Producer::new(4, 31).unwrap();
        let mut whole = Producer::new(4, 31).unwrap();

        // Act
        let mut halves = split.generate(50).unwrap().to_vec();
        halves.extend_from_slice(split.generate(50).unwrap());
        let single = whole.generate(100).unwrap().to_vec();

        // Assert — identical only if every instrument's state is retained exactly
        assert_eq!(halves, single);
    }

    #[test]
    fn each_instrument_continues_from_its_last_quote_across_batches() {
        // Arrange
        let mut producer = Producer::new(5, 8).unwrap();
        let mut last: [Option<Update>; 5] = [None; 5];
        let mut checked = 0;

        // Act
        let batches: Vec<Vec<Update>> = (0..20)
            .map(|_| records(producer.generate(50).unwrap()))
            .collect();

        // Assert — a bid moves ≤ max mid step (mid/2000) + 1 cent of spread change per update
        for u in batches.iter().flatten() {
            let slot = &mut last[u.instrument as usize];
            if let Some(prev) = slot {
                let bound = prev.bid_cents / 1_000 + 2;
                assert!(
                    prev.bid_cents.abs_diff(u.bid_cents) <= bound,
                    "{prev:?} → {u:?}"
                );
                checked += 1;
            }
            *slot = Some(*u);
        }
        assert!(checked > 900, "only {checked} consecutive pairs checked");
    }

    #[test]
    fn buffer_is_reused_without_growing() {
        // Arrange
        let mut producer = Producer::new(2, 3).unwrap();
        producer.generate(MAX_BATCH).unwrap();
        let warm = producer.buffer_capacity();

        // Act
        for n in [1, 500, MAX_BATCH, 7] {
            producer.generate(n).unwrap();
        }

        // Assert
        assert_eq!(producer.buffer_capacity(), warm);
    }

    #[test]
    fn invalid_sizes_are_rejected() {
        // Arrange
        let mut producer = Producer::new(1, 0).unwrap();

        // Act
        let counts = [
            Producer::new(0, 0).is_none(),
            Producer::new(MAX_INSTRUMENTS + 1, 0).is_none(),
            Producer::new(MAX_INSTRUMENTS, 0).is_some(),
        ];
        let batches = [
            producer.generate(0).is_none(),
            producer.generate(MAX_BATCH + 1).is_none(),
            producer.generate(MAX_BATCH).is_some(),
        ];

        // Assert
        assert_eq!(counts, [true; 3]);
        assert_eq!(batches, [true; 3]);
    }
}
