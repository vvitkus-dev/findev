//! Deterministic pseudo-random number generation for the market simulation.
//!
//! - **`SplitMix64`** expands the caller's 64-bit seed into well-mixed PCG32 parameters, so
//!   nearby seeds (1, 2, 3 …) still produce unrelated streams.
//! - **PCG32** (XSH-RR, O'Neill 2014) produces the draws: small state, fast, good statistics.
//! - **`below`** uses Lemire's multiply-shift method with rejection, so it is unbiased.
//!
//! No external crates: everything is explainable and runs identically natively and in Wasm.

const PCG_MULTIPLIER: u64 = 6_364_136_223_846_793_005;
const GOLDEN_GAMMA: u64 = 0x9E37_79B9_7F4A_7C15;
/// 2^26 and 2^53, used to build a 53-bit uniform double from two 32-bit draws.
const TWO_POW_26: f64 = 67_108_864.0;
const TWO_POW_53: f64 = 9_007_199_254_740_992.0;

#[expect(
    clippy::cast_possible_truncation,
    reason = "intentionally keeps the low 32 bits"
)]
const fn low32(x: u64) -> u32 {
    x as u32
}

const fn high32(x: u64) -> u32 {
    (x >> 32) as u32
}

/// `SplitMix64` step (Vigna): advances `state` and returns the next mixed 64-bit value.
const fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(GOLDEN_GAMMA);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// PCG32 generator. Cloning it forks an identical stream (useful in tests).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rng {
    state: u64,
    inc: u64,
}

impl Rng {
    /// Reference PCG32 seeding (`pcg32_srandom_r`): `init_state` + stream selector `init_seq`.
    #[must_use]
    pub const fn from_pcg_parts(init_state: u64, init_seq: u64) -> Self {
        let mut rng = Self {
            state: 0,
            inc: (init_seq << 1) | 1,
        };
        rng.step();
        rng.state = rng.state.wrapping_add(init_state);
        rng.step();
        rng
    }

    /// Seeds from a single 64-bit value via `SplitMix64` (state and stream both derived from it).
    #[must_use]
    pub const fn from_seed(seed: u64) -> Self {
        let mut sm = seed;
        let init_state = splitmix64(&mut sm);
        let init_seq = splitmix64(&mut sm);
        Self::from_pcg_parts(init_state, init_seq)
    }

    const fn step(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(PCG_MULTIPLIER).wrapping_add(self.inc);
        let xorshifted = low32(((old >> 18) ^ old) >> 27);
        let rot = high32(old) >> 27; // top 5 bits of `old`
        xorshifted.rotate_right(rot)
    }

    /// Next uniformly distributed `u32`.
    pub const fn next_u32(&mut self) -> u32 {
        self.step()
    }

    /// Uniform integer in `0..bound` without modulo bias (Lemire). Returns 0 when `bound == 0`.
    pub const fn below(&mut self, bound: u32) -> u32 {
        if bound == 0 {
            return 0;
        }
        let mut m = (self.next_u32() as u64) * (bound as u64);
        if low32(m) < bound {
            // Rejection zone: 2^32 mod bound low values would be over-represented.
            let threshold = bound.wrapping_neg() % bound;
            while low32(m) < threshold {
                m = (self.next_u32() as u64) * (bound as u64);
            }
        }
        high32(m)
    }

    /// Uniform `f64` in `[0, 1)` with 53 bits of precision (two 32-bit draws, no lossy casts).
    pub fn unit_f64(&mut self) -> f64 {
        let a = f64::from(self.next_u32() >> 5); // 27 bits
        let b = f64::from(self.next_u32() >> 6); // 26 bits
        a.mul_add(TWO_POW_26, b) / TWO_POW_53
    }

    /// Uniform `f64` in `[-1, 1)`.
    pub fn signed_unit_f64(&mut self) -> f64 {
        self.unit_f64().mul_add(2.0, -1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitmix64_matches_reference_vector() {
        // Arrange — reference outputs for seed 1234567 (Vigna, splitmix64.c)
        let mut state = 1_234_567;
        let expected = [
            6_457_827_717_110_365_317_u64,
            3_203_168_211_198_807_973,
            9_817_491_932_198_370_423,
            4_593_380_528_125_082_431,
            16_408_922_859_458_223_821,
        ];

        // Act
        let actual: Vec<u64> = (0..5).map(|_| splitmix64(&mut state)).collect();

        // Assert
        assert_eq!(actual, expected);
    }

    #[test]
    fn pcg32_matches_reference_vector() {
        // Arrange — output of O'Neill's pcg32-demo for initstate 42, initseq 54
        let mut rng = Rng::from_pcg_parts(42, 54);
        let expected = [
            0xa15c_02b7_u32,
            0x7b47_f409,
            0xba1d_3330,
            0x83d2_f293,
            0xbfa4_784b,
            0xcbed_606e,
        ];

        // Act
        let actual: Vec<u32> = (0..6).map(|_| rng.next_u32()).collect();

        // Assert
        assert_eq!(actual, expected);
    }

    #[test]
    fn same_seed_produces_identical_streams() {
        // Arrange
        let mut a = Rng::from_seed(2_026);
        let mut b = Rng::from_seed(2_026);

        // Act
        let xs: Vec<u32> = (0..1_000).map(|_| a.next_u32()).collect();
        let ys: Vec<u32> = (0..1_000).map(|_| b.next_u32()).collect();

        // Assert
        assert_eq!(xs, ys);
    }

    #[test]
    fn adjacent_seeds_produce_different_streams() {
        // Arrange
        let mut a = Rng::from_seed(1);
        let mut b = Rng::from_seed(2);

        // Act
        let xs: Vec<u32> = (0..32).map(|_| a.next_u32()).collect();
        let ys: Vec<u32> = (0..32).map(|_| b.next_u32()).collect();

        // Assert
        let equal = xs.iter().zip(&ys).filter(|(x, y)| x == y).count();
        assert!(equal <= 1, "streams share {equal} of 32 values");
    }

    #[test]
    fn below_is_uniform_within_ten_percent() {
        // Arrange — 70 000 draws over 7 buckets: expect 10 000 ± 10 % each (fixed seed)
        let mut rng = Rng::from_seed(7);
        let mut buckets = [0_u32; 7];

        // Act
        for _ in 0..70_000 {
            buckets[rng.below(7) as usize] += 1;
        }

        // Assert
        for (i, &count) in buckets.iter().enumerate() {
            assert!((9_000..=11_000).contains(&count), "bucket {i} has {count}");
        }
    }

    #[test]
    fn below_stays_in_range_including_edge_bounds() {
        // Arrange
        let mut rng = Rng::from_seed(99);

        // Act
        let one: Vec<u32> = (0..100).map(|_| rng.below(1)).collect();
        let zero = rng.below(0);
        let max_ok = (0..10_000).all(|_| rng.below(u32::MAX) < u32::MAX);
        let small_ok = (0..10_000).all(|_| rng.below(3) < 3);

        // Assert
        assert!(one.iter().all(|&v| v == 0));
        assert_eq!(zero, 0);
        assert!(max_ok && small_ok);
    }

    #[test]
    fn unit_f64_stays_in_half_open_interval_with_sane_mean() {
        // Arrange
        let mut rng = Rng::from_seed(11);
        let n = 100_000;

        // Act
        let samples: Vec<f64> = (0..n).map(|_| rng.unit_f64()).collect();
        let signed: Vec<f64> = (0..n).map(|_| rng.signed_unit_f64()).collect();

        // Assert
        assert!(samples.iter().all(|v| (0.0..1.0).contains(v)));
        assert!(signed.iter().all(|v| (-1.0..1.0).contains(v)));
        let mean = samples.iter().sum::<f64>() / f64::from(n);
        assert!((mean - 0.5).abs() < 0.01, "mean {mean}");
    }
}
