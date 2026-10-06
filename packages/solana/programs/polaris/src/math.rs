//! Pure arithmetic: the score, the limit, the plan schedule and the streak.
//! Kept free of accounts so it is unit-tested with `cargo test` and mirrored
//! line for line in the app (`apps/mobile/src/lib/credit.ts`).

pub const ONE_USD: u64 = 1_000_000; // pUSD / USDC: 6 decimals
pub const ONE_SKR: u64 = 1_000_000; // SKR: 6 decimals
pub const SECONDS_PER_DAY: i64 = 86_400;
pub const SECONDS_PER_YEAR: u128 = 31_536_000;

pub const INSTALLMENTS: u8 = 4;
pub const APR_BPS: u128 = 1_000; // 10% a year, pro-rated over the plan
pub const MIN_PLAN_PRINCIPAL: u64 = ONE_USD;

pub const STARTING_SCORE: u16 = 520;
pub const MIN_SCORE: u16 = 300;
pub const MAX_SCORE: u16 = 850;
pub const SCORE_ON_TIME: u16 = 12;
pub const SCORE_LATE: u16 = 30;
pub const SCORE_PLAN_DONE: u16 = 10;
pub const SCORE_PAYMENT: u16 = 2;
pub const SCORED_PAYMENTS_CAP: u32 = 10;
pub const SCORED_PAYMENT_MIN: u64 = 5 * ONE_USD;
/// Plans under this principal move the record (on time / late) but earn no
/// points, so farming the score with $1 plans buys nothing.
pub const SCORED_PLAN_MIN: u64 = 20 * ONE_USD;
pub const CHECKIN_SCORE_CAP: u16 = 60;
pub const MAX_STREAK_MULTIPLIER: u64 = 7;

pub fn bump_score(score: u16, by: u16) -> u16 {
    score.saturating_add(by).min(MAX_SCORE)
}

pub fn drop_score(score: u16, by: u16) -> u16 {
    score.saturating_sub(by).max(MIN_SCORE)
}

/// The unsecured line a score earns. Stepped so the jumps are legible
/// ("reach 620 and your limit triples").
pub fn base_limit(score: u16) -> u64 {
    match score {
        s if s >= 740 => 1_000 * ONE_USD,
        s if s >= 680 => 600 * ONE_USD,
        s if s >= 620 => 300 * ONE_USD,
        s if s >= 560 => 150 * ONE_USD,
        _ => 50 * ONE_USD,
    }
}

/// What locked SKR adds: its USD value times the collateral factor.
pub fn skr_boost(skr_locked: u64, skr_price_micros: u64, collateral_bps: u16) -> u64 {
    let value = (skr_locked as u128) * (skr_price_micros as u128) / (ONE_SKR as u128);
    let boost = value * (collateral_bps as u128) / 10_000;
    boost.min(u64::MAX as u128) as u64
}

/// SKR needed to cover `usd` at `price_micros` per SKR, rounded up.
pub fn skr_for_usd(usd: u64, price_micros: u64) -> Option<u64> {
    if price_micros == 0 {
        return None;
    }
    let n = (usd as u128).checked_mul(ONE_SKR as u128)?;
    u64::try_from(n.div_ceil(price_micros as u128)).ok()
}

pub fn credit_limit(score: u16, skr_locked: u64, skr_price_micros: u64, collateral_bps: u16) -> u64 {
    base_limit(score).saturating_add(skr_boost(skr_locked, skr_price_micros, collateral_bps))
}

/// Principal plus 10% APR for the plan's length (four intervals).
pub fn plan_total(principal: u64, interval_secs: i64) -> Option<u64> {
    let term = (interval_secs as u128).checked_mul(INSTALLMENTS as u128)?;
    let interest = (principal as u128).checked_mul(APR_BPS)?.checked_mul(term)? / (10_000u128 * SECONDS_PER_YEAR);
    u64::try_from(principal as u128 + interest).ok()
}

/// Instalment `paid` (0-based) is due `paid + 1` intervals after the start.
pub fn due_at(started_at: i64, interval_secs: i64, paid: u8) -> i64 {
    started_at + interval_secs * (paid as i64 + 1)
}

/// Equal instalments; the last one takes the rounding remainder.
pub fn next_installment(total: u64, repaid: u64, paid: u8, installments: u8) -> u64 {
    if paid + 1 >= installments {
        total.saturating_sub(repaid)
    } else {
        total / installments as u64
    }
}

/// (new streak, allowed). One check-in per UTC day; missing a day resets.
pub fn next_streak(last_day: i64, streak: u16, today: i64) -> (u16, bool) {
    if today <= last_day {
        return (streak, false);
    }
    if last_day >= 0 && today == last_day + 1 {
        (streak.saturating_add(1), true)
    } else {
        (1, true)
    }
}

pub fn checkin_reward(base: u64, streak: u16) -> u64 {
    base.saturating_mul((streak as u64).clamp(1, MAX_STREAK_MULTIPLIER))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_step_with_score() {
        assert_eq!(base_limit(STARTING_SCORE), 50 * ONE_USD);
        assert_eq!(base_limit(560), 150 * ONE_USD);
        assert_eq!(base_limit(620), 300 * ONE_USD);
        assert_eq!(base_limit(680), 600 * ONE_USD);
        assert_eq!(base_limit(850), 1_000 * ONE_USD);
    }

    #[test]
    fn skr_boost_uses_price_and_factor() {
        // 4,000 SKR at $0.05 = $200, at 50% = $100
        assert_eq!(skr_boost(4_000 * ONE_SKR, 50_000, 5_000), 100 * ONE_USD);
        assert_eq!(credit_limit(520, 4_000 * ONE_SKR, 50_000, 5_000), 150 * ONE_USD);
        assert_eq!(skr_boost(u64::MAX, u64::MAX, 10_000), u64::MAX);
    }

    #[test]
    fn plan_total_is_ten_percent_apr_prorated() {
        // $200 over four weekly instalments: 28 days of 10% APR = $1.534246
        let total = plan_total(200 * ONE_USD, 7 * SECONDS_PER_DAY).unwrap();
        assert_eq!(total, 201_534_246);
        assert_eq!(plan_total(100 * ONE_USD, 60).unwrap(), 100 * ONE_USD + 76); // a demo minute
    }

    #[test]
    fn installments_sum_to_total() {
        let total = 201_534_247u64;
        let mut repaid = 0;
        for paid in 0..INSTALLMENTS {
            repaid += next_installment(total, repaid, paid, INSTALLMENTS);
        }
        assert_eq!(repaid, total);
    }

    #[test]
    fn streaks() {
        assert_eq!(next_streak(-1, 0, 20_000), (1, true));
        assert_eq!(next_streak(20_000, 1, 20_000), (1, false));
        assert_eq!(next_streak(20_000, 1, 20_001), (2, true));
        assert_eq!(next_streak(20_000, 5, 20_003), (1, true));
        assert_eq!(checkin_reward(5 * ONE_SKR, 1), 5 * ONE_SKR);
        assert_eq!(checkin_reward(5 * ONE_SKR, 30), 35 * ONE_SKR);
    }

    #[test]
    fn score_is_clamped() {
        assert_eq!(bump_score(845, 12), MAX_SCORE);
        assert_eq!(drop_score(310, 30), MIN_SCORE);
    }

    #[test]
    fn skr_for_usd_rounds_up() {
        assert_eq!(skr_for_usd(50 * ONE_USD, 50_000), Some(1_000 * ONE_SKR));
        assert_eq!(skr_for_usd(1, 3), Some(333_334));
        assert_eq!(skr_for_usd(1, 0), None);
    }

    #[test]
    fn due_dates() {
        assert_eq!(due_at(1_000, 60, 0), 1_060);
        assert_eq!(due_at(1_000, 60, 3), 1_240);
    }
}
