//! Per-instrument market model: a mid-price random walk, a bid/ask quote around it, an
//! order book that drifts, and one trade per update executed at the bid or the ask.
//!
//! All prices are integer cents (`u32`). Invariants hold by construction:
//! `price > 0`, `0 < bid < ask`, `trade_qty >= 1`, `0 <= book qty <= MAX_BOOK_QTY`,
//! and `price ∈ {bid, ask}`.

use crate::rng::Rng;

/// Lowest mid price ($1.00) — keeps every price positive.
pub const MIN_MID_CENTS: u32 = 100;
/// Highest mid price ($100 000) — keeps arithmetic far from `u32` limits.
pub const MAX_MID_CENTS: u32 = 10_000_000;
/// Initial mids are drawn from `[INITIAL_MID_MIN, INITIAL_MID_MIN + INITIAL_MID_SPAN)`.
const INITIAL_MID_MIN: u32 = 1_000;
const INITIAL_MID_SPAN: u32 = 49_001;
/// Mid moves at most `max(1, mid / MID_STEP_DIVISOR)` cents per update (≈ 5 bps).
pub const MID_STEP_DIVISOR: u32 = 2_000;
/// Spread is capped at `max(1, mid / SPREAD_CAP_DIVISOR)` cents (≈ 20 bps).
pub const SPREAD_CAP_DIVISOR: u32 = 500;
/// Book quantities stay within `0..=MAX_BOOK_QTY`.
pub const MAX_BOOK_QTY: u32 = 1_000;
const BOOK_STEP: u32 = 50;
/// Trade quantities are `1..=MAX_TRADE_QTY`.
pub const MAX_TRADE_QTY: u32 = 100;

/// Number of `u32` words per [`Update`] record in the ABI buffer.
pub const RECORD_WORDS: usize = 7;

/// One market update: a trade plus the current quote and book. `#[repr(C)]` with seven
/// `u32` fields — this is the record layout JavaScript reads from Wasm memory.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Update {
    /// Instrument index (`0..instrument_count`).
    pub instrument: u32,
    /// Trade price in cents (equals `bid_cents` or `ask_cents`).
    pub price_cents: u32,
    /// Trade quantity (≥ 1).
    pub trade_qty: u32,
    /// Best bid in cents.
    pub bid_cents: u32,
    /// Best ask in cents (> bid).
    pub ask_cents: u32,
    /// Quantity available at the bid.
    pub bid_qty: u32,
    /// Quantity available at the ask.
    pub ask_qty: u32,
}

impl Update {
    /// The record as ABI words, in field order:
    /// `[instrument, price, trade_qty, bid, ask, bid_qty, ask_qty]`.
    #[must_use]
    pub const fn words(&self) -> [u32; RECORD_WORDS] {
        [
            self.instrument,
            self.price_cents,
            self.trade_qty,
            self.bid_cents,
            self.ask_cents,
            self.bid_qty,
            self.ask_qty,
        ]
    }
}

/// Random walk of `value` by up to `±max_step`, clamped to `[lo, hi]`.
fn walk(rng: &mut Rng, value: u32, max_step: u32, (lo, hi): (u32, u32)) -> u32 {
    let offset = rng.below(max_step.saturating_mul(2).saturating_add(1)); // 0..=2*max_step
    value
        .saturating_add(offset)
        .saturating_sub(max_step)
        .clamp(lo, hi)
}

/// Probability that a trade lifts the ask (buy) rather than hitting the bid (sell):
/// `0.5 + 0.25 × imbalance`, so a bid-heavy book tends to trade up. Range `[0.25, 0.75]`.
#[must_use]
pub fn buy_probability(bid_qty: u32, ask_qty: u32) -> f64 {
    let (b, a) = (f64::from(bid_qty), f64::from(ask_qty));
    let total = b + a;
    if total == 0.0 {
        return 0.5;
    }
    0.25f64.mul_add((b - a) / total, 0.5)
}

/// State carried between updates for one instrument.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstrumentState {
    mid_cents: u32,
    spread_cents: u32,
    bid_qty: u32,
    ask_qty: u32,
}

impl InstrumentState {
    /// Random starting state: mid in $10–$500, valid spread, random book.
    pub fn new(rng: &mut Rng) -> Self {
        let mid_cents = INITIAL_MID_MIN + rng.below(INITIAL_MID_SPAN);
        Self {
            mid_cents,
            spread_cents: 1 + rng.below(Self::spread_cap(mid_cents)),
            bid_qty: rng.below(MAX_BOOK_QTY + 1),
            ask_qty: rng.below(MAX_BOOK_QTY + 1),
        }
    }

    /// Current mid price in cents.
    #[must_use]
    pub const fn mid_cents(&self) -> u32 {
        self.mid_cents
    }

    const fn spread_cap(mid: u32) -> u32 {
        let cap = mid / SPREAD_CAP_DIVISOR;
        if cap == 0 { 1 } else { cap }
    }

    /// Largest mid move allowed from `mid` in one update.
    #[must_use]
    pub const fn max_mid_step(mid: u32) -> u32 {
        let step = mid / MID_STEP_DIVISOR;
        if step == 0 { 1 } else { step }
    }

    /// Advances this instrument by one update and returns it (tagged with `instrument`).
    pub fn step(&mut self, rng: &mut Rng, instrument: u32) -> Update {
        let bounds = (MIN_MID_CENTS, MAX_MID_CENTS);
        self.mid_cents = walk(
            rng,
            self.mid_cents,
            Self::max_mid_step(self.mid_cents),
            bounds,
        );
        self.spread_cents = walk(
            rng,
            self.spread_cents,
            1,
            (1, Self::spread_cap(self.mid_cents)),
        );
        self.bid_qty = walk(rng, self.bid_qty, BOOK_STEP, (0, MAX_BOOK_QTY));
        self.ask_qty = walk(rng, self.ask_qty, BOOK_STEP, (0, MAX_BOOK_QTY));

        let bid_cents = self.mid_cents.saturating_sub(self.spread_cents / 2).max(1);
        let ask_cents = bid_cents + self.spread_cents;
        let buy = rng.unit_f64() < buy_probability(self.bid_qty, self.ask_qty);
        Update {
            instrument,
            price_cents: if buy { ask_cents } else { bid_cents },
            trade_qty: 1 + rng.below(MAX_TRADE_QTY),
            bid_cents,
            ask_cents,
            bid_qty: self.bid_qty,
            ask_qty: self.ask_qty,
        }
    }
}

/// Shared test assertions (also used by the producer tests).
#[cfg(test)]
pub(crate) mod test_support {
    use super::{MAX_BOOK_QTY, MAX_TRADE_QTY, Update};

    /// Asserts every market invariant the task requires for a single update.
    pub(crate) fn assert_invariants(u: &Update) {
        assert_price_invariants(u);
        assert_quantity_invariants(u);
    }

    /// Prices: positive, `bid < ask`, and the trade executes at the bid or the ask.
    fn assert_price_invariants(u: &Update) {
        assert!(u.price_cents > 0, "price must be positive: {u:?}");
        assert!(u.bid_cents > 0, "bid must be positive: {u:?}");
        assert!(u.bid_cents < u.ask_cents, "bid must be below ask: {u:?}");
        let at_quote = u.price_cents == u.bid_cents || u.price_cents == u.ask_cents;
        assert!(at_quote, "trade must execute at bid or ask: {u:?}");
    }

    /// Quantities: trade quantity positive and bounded; book quantities bounded (u32 ⇒ ≥ 0).
    fn assert_quantity_invariants(u: &Update) {
        assert!(
            (1..=MAX_TRADE_QTY).contains(&u.trade_qty),
            "trade qty: {u:?}"
        );
        assert!(u.bid_qty <= MAX_BOOK_QTY, "bid qty: {u:?}");
        assert!(u.ask_qty <= MAX_BOOK_QTY, "ask qty: {u:?}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STEPS: usize = 100_000;

    fn run(seed: u64, steps: usize) -> (Vec<Update>, Vec<u32>) {
        let mut rng = Rng::from_seed(seed);
        let mut state = InstrumentState::new(&mut rng);
        let mut mids = vec![state.mid_cents()];
        let updates = (0..steps)
            .map(|_| {
                let u = state.step(&mut rng, 3);
                mids.push(state.mid_cents());
                u
            })
            .collect();
        (updates, mids)
    }

    #[test]
    fn every_update_satisfies_the_market_invariants() {
        // Act
        let (updates, _) = run(42, STEPS);

        // Assert
        for u in &updates {
            test_support::assert_invariants(u);
            assert_eq!(u.instrument, 3);
        }
    }

    #[test]
    fn mid_price_evolves_continuously_from_its_previous_value() {
        // Act
        let (_, mids) = run(7, STEPS);

        // Assert
        for pair in mids.windows(2) {
            let (prev, next) = (pair[0], pair[1]);
            assert!(
                prev.abs_diff(next) <= InstrumentState::max_mid_step(prev),
                "{prev} → {next}"
            );
        }
        let distinct: std::collections::HashSet<_> = mids.iter().collect();
        assert!(
            distinct.len() > 100,
            "price barely moves: {} distinct mids",
            distinct.len()
        );
    }

    #[test]
    fn mid_price_never_drops_below_the_floor() {
        // Arrange — start pinned at the floor
        let mut rng = Rng::from_seed(5);
        let mut state = InstrumentState::new(&mut rng);
        state.mid_cents = MIN_MID_CENTS;

        // Act
        let mids: Vec<u32> = (0..10_000)
            .map(|_| {
                state.step(&mut rng, 0);
                state.mid_cents()
            })
            .collect();

        // Assert — never below the floor, and the walk really pressed against it
        assert!(mids.iter().all(|&mid| mid >= MIN_MID_CENTS));
        let at_floor = mids.iter().filter(|&&mid| mid == MIN_MID_CENTS).count();
        // Seed 5 touches the floor 62 times; ≥ 10 proves the clamp is exercised, not just unreachable.
        assert!(at_floor >= 10, "floor visited only {at_floor} times");
    }

    #[test]
    fn spread_stays_within_its_cap() {
        // Act
        let (updates, mids) = run(13, STEPS);

        // Assert
        for (u, &mid) in updates.iter().zip(&mids[1..]) {
            let spread = u.ask_cents - u.bid_cents;
            assert!(
                (1..=InstrumentState::spread_cap(mid)).contains(&spread),
                "{u:?} mid {mid}"
            );
        }
    }

    #[test]
    fn trades_happen_on_both_sides_of_the_book() {
        // Act
        let (updates, _) = run(21, 10_000);

        // Assert
        let buys = updates
            .iter()
            .filter(|u| u.price_cents == u.ask_cents)
            .count();
        let sells = updates
            .iter()
            .filter(|u| u.price_cents == u.bid_cents)
            .count();
        assert!(buys > 2_000 && sells > 2_000, "buys {buys}, sells {sells}");
    }

    #[test]
    fn buy_probability_follows_book_imbalance() {
        // Act
        let cases = [
            buy_probability(1_000, 0),
            buy_probability(0, 1_000),
            buy_probability(0, 0),
            buy_probability(600, 400),
        ];

        // Assert
        let expected = [0.75, 0.25, 0.5, 0.55];
        for (got, want) in cases.iter().zip(expected) {
            assert!((got - want).abs() < 1e-12, "got {got}, want {want}");
        }
    }

    #[test]
    fn initial_states_are_valid_for_many_seeds() {
        // Act
        let states: Vec<InstrumentState> = (0..1_000)
            .map(|seed| InstrumentState::new(&mut Rng::from_seed(seed)))
            .collect();

        // Assert
        for s in &states {
            assert!((INITIAL_MID_MIN..INITIAL_MID_MIN + INITIAL_MID_SPAN).contains(&s.mid_cents));
            assert!((1..=InstrumentState::spread_cap(s.mid_cents)).contains(&s.spread_cents));
            assert!(s.bid_qty <= MAX_BOOK_QTY && s.ask_qty <= MAX_BOOK_QTY);
        }
    }

    #[test]
    fn words_follow_the_abi_field_order() {
        // Arrange
        let u = Update {
            instrument: 1,
            price_cents: 2,
            trade_qty: 3,
            bid_cents: 4,
            ask_cents: 5,
            bid_qty: 6,
            ask_qty: 7,
        };

        // Act
        let words = u.words();

        // Assert
        assert_eq!(words, [1, 2, 3, 4, 5, 6, 7]);
    }

    #[test]
    fn update_record_is_seven_u32_words() {
        // Act
        let size = std::mem::size_of::<Update>();

        // Assert — the JS side reads 7 × 4 bytes per record
        assert_eq!(size, RECORD_WORDS * 4);
        assert_eq!(std::mem::align_of::<Update>(), 4);
    }
}
