//! Polaris on Solana.
//!
//! Pay a merchant now, or Pay in 4 against an on-chain credit line that the
//! buyer grows by behaving well (paying instalments on time, clocking in
//! daily) and by locking SKR as collateral. Send dollars by link. One program,
//! ported from the Monad contracts (see `clockin/PORT-PLAN.md`).
//!
//! Every vault (the credit pool, the SKR rewards, the SKR collateral, each
//! send-link escrow) is a token account whose authority is the `config` PDA,
//! so the program signs every outgoing transfer with one set of seeds.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Approve, CloseAccount, Mint, MintTo, Token, TokenAccount, Transfer};

pub mod math;
use math::*;

declare_id!("HL4FgsM51RQQis74TwDkK733ZcTDnqWF8L772Y7tFVaA");

pub const CONFIG_SEED: &[u8] = b"config";
pub const POOL_SEED: &[u8] = b"pool";
pub const REWARDS_SEED: &[u8] = b"rewards";
pub const SKR_VAULT_SEED: &[u8] = b"skr_vault";
pub const PROFILE_SEED: &[u8] = b"profile";
pub const MERCHANT_SEED: &[u8] = b"merchant";
pub const PLAN_SEED: &[u8] = b"plan";
pub const LINK_SEED: &[u8] = b"link";
pub const LINK_VAULT_SEED: &[u8] = b"link_vault";

/// Faucet caps per call (devnet only; `faucet_enabled` is false on mainnet).
pub const FAUCET_USD_CAP: u64 = 1_000 * ONE_USD;
pub const FAUCET_SKR_CAP: u64 = 1_000 * ONE_SKR;
pub const MAX_NAME_LEN: usize = 32;

#[program]
pub mod polaris {
    use super::*;

    /// Create the config and the three vaults. The two mints are passed in:
    /// on devnet they are stand-ins whose mint authority is the config PDA
    /// (so the faucet works); on mainnet they would be USDC and SKR.
    pub fn initialize(ctx: Context<Initialize>, params: ConfigParams) -> Result<()> {
        params.validate()?;
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.usd_mint = ctx.accounts.usd_mint.key();
        c.skr_mint = ctx.accounts.skr_mint.key();
        c.bump = ctx.bumps.config;
        c.pool_bump = ctx.bumps.pool;
        c.rewards_bump = ctx.bumps.rewards;
        c.skr_vault_bump = ctx.bumps.skr_vault;
        c.apply(&params);
        Ok(())
    }

    /// Admin: tune the knobs (pause new Pay in 4 plans, SKR price stand-in,
    /// instalment interval, grace, daily reward, faucet).
    pub fn set_params(ctx: Context<AdminOnly>, params: ConfigParams) -> Result<()> {
        params.validate()?;
        ctx.accounts.config.apply(&params);
        emit!(ParamsSet { credit_paused: params.credit_paused, skr_price_micros: params.skr_price_micros });
        Ok(())
    }

    /// Devnet only: mint test dollars (pUSD) or stand-in SKR to the caller.
    pub fn faucet(ctx: Context<Faucet>, amount: u64) -> Result<()> {
        let c = &ctx.accounts.config;
        require!(c.faucet_enabled, PolarisError::FaucetDisabled);
        let mint = ctx.accounts.mint.key();
        let cap = if mint == c.usd_mint {
            FAUCET_USD_CAP
        } else if mint == c.skr_mint {
            FAUCET_SKR_CAP
        } else {
            return err!(PolarisError::WrongMint);
        };
        require!(amount > 0 && amount <= cap, PolarisError::FaucetCap);
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[c.bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )
    }

    /// Anyone can add dollars to the credit pool that funds Pay in 4.
    pub fn fund_pool(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        require_keys_eq!(ctx.accounts.vault.key(), pda(&[POOL_SEED]), PolarisError::WrongVault);
        transfer_from_user(&ctx.accounts.token_program, &ctx.accounts.from, &ctx.accounts.vault, &ctx.accounts.funder, amount)
    }

    /// Anyone can top up the SKR rewards vault the daily check-in pays from.
    pub fn fund_rewards(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        require_keys_eq!(ctx.accounts.vault.key(), pda(&[REWARDS_SEED]), PolarisError::WrongVault);
        transfer_from_user(&ctx.accounts.token_program, &ctx.accounts.from, &ctx.accounts.vault, &ctx.accounts.funder, amount)
    }

    pub fn register_merchant(ctx: Context<RegisterMerchant>, name: String) -> Result<()> {
        require!(!name.is_empty() && name.len() <= MAX_NAME_LEN, PolarisError::BadName);
        let m = &mut ctx.accounts.merchant;
        m.authority = ctx.accounts.authority.key();
        m.name = name;
        m.bump = ctx.bumps.merchant;
        m.created_at = Clock::get()?.unix_timestamp;
        emit!(MerchantRegistered { merchant: m.authority });
        Ok(())
    }

    /// A buyer's credit record. Starts at STARTING_SCORE.
    pub fn init_profile(ctx: Context<InitProfile>) -> Result<()> {
        let p = &mut ctx.accounts.profile;
        p.owner = ctx.accounts.owner.key();
        p.score = STARTING_SCORE;
        p.last_check_in_day = -1;
        p.bump = ctx.bumps.profile;
        p.created_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Pay now: dollars straight from the buyer to the merchant.
    pub fn pay(ctx: Context<Pay>, amount: u64, order_id: [u8; 16]) -> Result<()> {
        require!(amount > 0, PolarisError::ZeroAmount);
        transfer_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.buyer_usd,
            &ctx.accounts.merchant_usd,
            &ctx.accounts.buyer,
            amount,
        )?;
        let p = &mut ctx.accounts.profile;
        p.payments = p.payments.saturating_add(1);
        if amount >= SCORED_PAYMENT_MIN && p.payments <= SCORED_PAYMENTS_CAP {
            p.score = bump_score(p.score, SCORE_PAYMENT);
        }
        let m = &mut ctx.accounts.merchant;
        m.total_settled = m.total_settled.saturating_add(amount);
        m.payments = m.payments.saturating_add(1);
        emit!(Paid {
            buyer: p.owner,
            merchant: m.authority,
            amount,
            order_id,
            score: p.score,
        });
        Ok(())
    }

    /// Pay in 4: the pool pays the merchant the full price now; the buyer owes
    /// four instalments (principal + 10% APR pro-rated), nothing due today.
    /// The buyer also approves the config PDA as delegate for what they owe,
    /// so a crank can collect due instalments (Solana's stand-in for the
    /// ERC-2612 permits and the CRE collections workflow on Monad).
    pub fn open_plan(ctx: Context<OpenPlan>, principal: u64, order_id: [u8; 16]) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require!(!c.credit_paused, PolarisError::CreditPaused);
        require!(principal >= MIN_PLAN_PRINCIPAL, PolarisError::PlanTooSmall);
        let total = plan_total(principal, c.interval_secs).ok_or(PolarisError::Overflow)?;
        let p = &mut ctx.accounts.profile;
        let limit = credit_limit(p.score, p.skr_locked, c.skr_price_micros, c.skr_collateral_bps);
        let debt_after = p.active_debt.checked_add(total).ok_or(PolarisError::Overflow)?;
        require!(debt_after <= limit, PolarisError::OverLimit);
        require!(ctx.accounts.pool.amount >= principal, PolarisError::PoolShort);

        let now = Clock::get()?.unix_timestamp;
        let plan = &mut ctx.accounts.plan;
        plan.buyer = p.owner;
        plan.merchant = ctx.accounts.merchant.authority;
        plan.index = p.plans_opened;
        plan.principal = principal;
        plan.total_owed = total;
        plan.repaid = 0;
        plan.installments = INSTALLMENTS;
        plan.paid = 0;
        plan.started_at = now;
        plan.interval_secs = c.interval_secs;
        plan.order_id = order_id;
        plan.bump = ctx.bumps.plan;

        p.active_debt = debt_after;
        p.plans_opened = p.plans_opened.saturating_add(1);
        c.plan_count = c.plan_count.saturating_add(1);
        c.total_originated = c.total_originated.saturating_add(principal);
        c.total_outstanding = c.total_outstanding.saturating_add(total);

        let seeds: &[&[u8]] = &[CONFIG_SEED, &[c.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool.to_account_info(),
                    to: ctx.accounts.merchant_usd.to_account_info(),
                    authority: c.to_account_info(),
                },
                &[seeds],
            ),
            principal,
        )?;
        token::approve(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Approve {
                    to: ctx.accounts.buyer_usd.to_account_info(),
                    delegate: c.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            debt_after,
        )?;
        let m = &mut ctx.accounts.merchant;
        m.total_settled = m.total_settled.saturating_add(principal);
        m.payments = m.payments.saturating_add(1);
        emit!(PlanOpened {
            buyer: plan.buyer,
            merchant: plan.merchant,
            index: plan.index,
            principal,
            total_owed: total,
            first_due: now + c.interval_secs,
        });
        Ok(())
    }

    /// The buyer pays their next instalment (early counts as on time).
    pub fn repay_installment(ctx: Context<Repay>) -> Result<()> {
        let plan = &ctx.accounts.plan;
        require!(plan.paid < plan.installments, PolarisError::PlanClosed);
        let amount = next_installment(plan.total_owed, plan.repaid, plan.paid, plan.installments);
        transfer_from_user(&ctx.accounts.token_program, &ctx.accounts.buyer_usd, &ctx.accounts.pool, &ctx.accounts.buyer, amount)?;
        settle_installment(
            &mut ctx.accounts.plan,
            &mut ctx.accounts.profile,
            &mut ctx.accounts.config,
            amount,
            Clock::get()?.unix_timestamp,
            ctx.accounts.buyer.key(),
        )
    }

    /// Pay the next instalment in SKR instead of dollars, at the config's SKR
    /// price. The SKR goes to the rewards vault, so what buyers spend funds
    /// the next day's check-in rewards. (On mainnet a treasury job would swap
    /// a share to USDC through Jupiter to refill the pool; not built.)
    pub fn repay_with_skr(ctx: Context<RepaySkr>) -> Result<()> {
        let plan = &ctx.accounts.plan;
        require!(plan.paid < plan.installments, PolarisError::PlanClosed);
        let c = &ctx.accounts.config;
        require!(c.skr_price_micros > 0, PolarisError::BadParams);
        let amount = next_installment(plan.total_owed, plan.repaid, plan.paid, plan.installments);
        let skr = skr_for_usd(amount, c.skr_price_micros).ok_or(PolarisError::Overflow)?;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_skr.to_account_info(),
                    to: ctx.accounts.rewards.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            skr,
        )?;
        emit!(SkrSpent { user: ctx.accounts.buyer.key(), skr, usd_value: amount });
        settle_installment(
            &mut ctx.accounts.plan,
            &mut ctx.accounts.profile,
            &mut ctx.accounts.config,
            amount,
            Clock::get()?.unix_timestamp,
            ctx.accounts.buyer.key(),
        )
    }

    /// Permissionless crank: collect a due instalment through the buyer's
    /// delegate approval. Fails if nothing is due yet.
    pub fn collect_due(ctx: Context<Collect>) -> Result<()> {
        let plan = &ctx.accounts.plan;
        require!(plan.paid < plan.installments, PolarisError::PlanClosed);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= due_at(plan.started_at, plan.interval_secs, plan.paid), PolarisError::NotDue);
        let amount = next_installment(plan.total_owed, plan.repaid, plan.paid, plan.installments);
        let bump = ctx.accounts.config.bump;
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_usd.to_account_info(),
                    to: ctx.accounts.pool.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        settle_installment(
            &mut ctx.accounts.plan,
            &mut ctx.accounts.profile,
            &mut ctx.accounts.config,
            amount,
            now,
            ctx.accounts.cranker.key(),
        )
    }

    /// The daily loop: one check-in per UTC day. Builds a streak, pays SKR
    /// from the rewards vault (base x min(streak, 7)) and adds a score point
    /// (the first CHECKIN_SCORE_CAP of them).
    pub fn check_in(ctx: Context<CheckIn>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let day = now.div_euclid(SECONDS_PER_DAY);
        let p = &mut ctx.accounts.profile;
        let (streak, ok) = next_streak(p.last_check_in_day, p.streak, day);
        require!(ok, PolarisError::AlreadyCheckedIn);
        p.streak = streak;
        p.best_streak = p.best_streak.max(streak);
        p.last_check_in_day = day;
        p.check_ins = p.check_ins.saturating_add(1);
        if p.checkin_points < CHECKIN_SCORE_CAP {
            p.checkin_points += 1;
            p.score = bump_score(p.score, 1);
        }
        let c = &ctx.accounts.config;
        let mut reward = checkin_reward(c.checkin_reward, streak);
        if ctx.accounts.rewards.amount < reward {
            reward = 0; // the vault ran dry: the streak still counts
        }
        if reward > 0 {
            let seeds: &[&[u8]] = &[CONFIG_SEED, &[c.bump]];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.rewards.to_account_info(),
                        to: ctx.accounts.user_skr.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    &[seeds],
                ),
                reward,
            )?;
        }
        p.skr_earned = p.skr_earned.saturating_add(reward);
        emit!(CheckedIn { user: p.owner, day, streak, reward, score: p.score });
        Ok(())
    }

    /// Lock SKR to raise the Pay in 4 limit (SKR as credit collateral).
    pub fn lock_skr(ctx: Context<LockSkr>, amount: u64) -> Result<()> {
        require!(amount > 0, PolarisError::ZeroAmount);
        transfer_from_user(&ctx.accounts.token_program, &ctx.accounts.user_skr, &ctx.accounts.skr_vault, &ctx.accounts.owner, amount)?;
        let p = &mut ctx.accounts.profile;
        p.skr_locked = p.skr_locked.checked_add(amount).ok_or(PolarisError::Overflow)?;
        emit!(SkrLocked { user: p.owner, amount, locked: p.skr_locked });
        Ok(())
    }

    /// Unlock SKR, unless what stays locked would no longer cover the debt.
    pub fn unlock_skr(ctx: Context<LockSkr>, amount: u64) -> Result<()> {
        let c = &ctx.accounts.config;
        let p = &mut ctx.accounts.profile;
        require!(amount > 0 && amount <= p.skr_locked, PolarisError::ZeroAmount);
        let left = p.skr_locked - amount;
        let limit = credit_limit(p.score, left, c.skr_price_micros, c.skr_collateral_bps);
        require!(p.active_debt <= limit, PolarisError::CollateralInUse);
        p.skr_locked = left;
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[c.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.skr_vault.to_account_info(),
                    to: ctx.accounts.user_skr.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        emit!(SkrUnlocked { user: p.owner, amount, locked: p.skr_locked });
        Ok(())
    }

    /// Send by link: escrow dollars under an ephemeral link key. The secret
    /// of that key travels in the link; whoever holds it can claim.
    pub fn create_link(ctx: Context<CreateLink>, amount: u64, expires_in_secs: i64) -> Result<()> {
        require!(amount > 0, PolarisError::ZeroAmount);
        require!(expires_in_secs > 0 && expires_in_secs <= 60 * SECONDS_PER_DAY, PolarisError::BadExpiry);
        transfer_from_user(&ctx.accounts.token_program, &ctx.accounts.sender_usd, &ctx.accounts.vault, &ctx.accounts.sender, amount)?;
        let now = Clock::get()?.unix_timestamp;
        let l = &mut ctx.accounts.link;
        l.sender = ctx.accounts.sender.key();
        l.link_key = ctx.accounts.link_key.key();
        l.amount = amount;
        l.created_at = now;
        l.expires_at = now + expires_in_secs;
        l.bump = ctx.bumps.link;
        emit!(LinkCreated { sender: l.sender, link_key: l.link_key, amount, expires_at: l.expires_at });
        Ok(())
    }

    /// Claim a link. Signed by the link key, which also pays the fee and the
    /// recipient's token-account rent, so the recipient needs no SOL.
    pub fn claim_link(ctx: Context<ClaimLink>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now <= ctx.accounts.link.expires_at, PolarisError::LinkExpired);
        let amount = ctx.accounts.link.amount;
        release_link(
            &ctx.accounts.token_program,
            &ctx.accounts.config,
            &ctx.accounts.vault,
            &ctx.accounts.recipient_usd.to_account_info(),
            &ctx.accounts.sender.to_account_info(),
            amount,
        )?;
        // Sweep what the sender pre-paid for fees back to them, so the link
        // key is left empty (an account below rent-exemption would fail).
        let rest = ctx.accounts.link_key.lamports();
        if rest > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.link_key.to_account_info(),
                        to: ctx.accounts.sender.to_account_info(),
                    },
                ),
                rest,
            )?;
        }
        emit!(LinkClaimed {
            sender: ctx.accounts.link.sender,
            link_key: ctx.accounts.link.link_key,
            recipient: ctx.accounts.recipient.key(),
            amount,
        });
        Ok(())
    }

    /// The sender takes an unclaimed link back.
    pub fn cancel_link(ctx: Context<CancelLink>) -> Result<()> {
        let amount = ctx.accounts.link.amount;
        release_link(
            &ctx.accounts.token_program,
            &ctx.accounts.config,
            &ctx.accounts.vault,
            &ctx.accounts.sender_usd.to_account_info(),
            &ctx.accounts.sender.to_account_info(),
            amount,
        )?;
        emit!(LinkCancelled { sender: ctx.accounts.link.sender, link_key: ctx.accounts.link.link_key, amount });
        Ok(())
    }
}

// ───────────────────────────── helpers ─────────────────────────────

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &crate::ID).0
}

fn transfer_from_user<'info>(
    token_program: &Program<'info, Token>,
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, PolarisError::ZeroAmount);
    token::transfer(
        CpiContext::new(
            token_program.to_account_info(),
            Transfer { from: from.to_account_info(), to: to.to_account_info(), authority: authority.to_account_info() },
        ),
        amount,
    )
}

fn settle_installment(
    plan: &mut Account<Plan>,
    profile: &mut Account<Profile>,
    config: &mut Account<Config>,
    amount: u64,
    now: i64,
    payer: Pubkey,
) -> Result<()> {
    let due = due_at(plan.started_at, plan.interval_secs, plan.paid);
    let on_time = now <= due + config.grace_secs;
    plan.repaid = plan.repaid.saturating_add(amount);
    plan.paid += 1;
    profile.active_debt = profile.active_debt.saturating_sub(amount);
    config.total_outstanding = config.total_outstanding.saturating_sub(amount);
    let scored = plan.principal >= SCORED_PLAN_MIN;
    if on_time {
        profile.on_time = profile.on_time.saturating_add(1);
        if scored {
            profile.score = bump_score(profile.score, SCORE_ON_TIME);
        }
    } else {
        profile.late = profile.late.saturating_add(1);
        profile.score = drop_score(profile.score, SCORE_LATE);
    }
    if plan.paid == plan.installments {
        profile.plans_repaid = profile.plans_repaid.saturating_add(1);
        if scored {
            profile.score = bump_score(profile.score, SCORE_PLAN_DONE);
        }
    }
    emit!(InstallmentPaid {
        buyer: plan.buyer,
        index: plan.index,
        installment: plan.paid,
        amount,
        on_time,
        payer,
        score: profile.score,
    });
    Ok(())
}

fn release_link<'info>(
    token_program: &Program<'info, Token>,
    config: &Account<'info, Config>,
    vault: &Account<'info, TokenAccount>,
    to: &AccountInfo<'info>,
    rent_to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[config.bump]];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer { from: vault.to_account_info(), to: to.clone(), authority: config.to_account_info() },
            &[seeds],
        ),
        amount,
    )?;
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        CloseAccount { account: vault.to_account_info(), destination: rent_to.clone(), authority: config.to_account_info() },
        &[seeds],
    ))
}

// ───────────────────────────── state ─────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ConfigParams {
    pub interval_secs: i64,
    pub grace_secs: i64,
    /// USD price of 1 SKR in micro-dollars. Stand-in for an oracle feed.
    pub skr_price_micros: u64,
    /// Share of locked SKR's value that counts toward the limit (bps).
    pub skr_collateral_bps: u16,
    /// SKR paid for a check-in at streak 1 (base units).
    pub checkin_reward: u64,
    pub credit_paused: bool,
    pub faucet_enabled: bool,
}

impl ConfigParams {
    fn validate(&self) -> Result<()> {
        require!(self.interval_secs > 0 && self.grace_secs >= 0, PolarisError::BadParams);
        require!(self.skr_collateral_bps <= 10_000, PolarisError::BadParams);
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub usd_mint: Pubkey,
    pub skr_mint: Pubkey,
    pub interval_secs: i64,
    pub grace_secs: i64,
    pub skr_price_micros: u64,
    pub skr_collateral_bps: u16,
    pub checkin_reward: u64,
    pub credit_paused: bool,
    pub faucet_enabled: bool,
    pub plan_count: u64,
    pub total_originated: u64,
    pub total_outstanding: u64,
    pub bump: u8,
    pub pool_bump: u8,
    pub rewards_bump: u8,
    pub skr_vault_bump: u8,
}

impl Config {
    fn apply(&mut self, p: &ConfigParams) {
        self.interval_secs = p.interval_secs;
        self.grace_secs = p.grace_secs;
        self.skr_price_micros = p.skr_price_micros;
        self.skr_collateral_bps = p.skr_collateral_bps;
        self.checkin_reward = p.checkin_reward;
        self.credit_paused = p.credit_paused;
        self.faucet_enabled = p.faucet_enabled;
    }
}

#[account]
#[derive(InitSpace)]
pub struct Merchant {
    pub authority: Pubkey,
    #[max_len(32)]
    pub name: String,
    pub total_settled: u64,
    pub payments: u32,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Profile {
    pub owner: Pubkey,
    pub score: u16,
    pub active_debt: u64,
    pub plans_opened: u32,
    pub plans_repaid: u32,
    pub on_time: u32,
    pub late: u32,
    pub payments: u32,
    pub skr_locked: u64,
    pub skr_earned: u64,
    pub streak: u16,
    pub best_streak: u16,
    pub last_check_in_day: i64,
    pub check_ins: u32,
    pub checkin_points: u16,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Plan {
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    pub index: u32,
    pub principal: u64,
    pub total_owed: u64,
    pub repaid: u64,
    pub installments: u8,
    pub paid: u8,
    pub started_at: i64,
    pub interval_secs: i64,
    pub order_id: [u8; 16],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Link {
    pub sender: Pubkey,
    pub link_key: Pubkey,
    pub amount: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub bump: u8,
}

// ───────────────────────────── accounts ─────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub usd_mint: Account<'info, Mint>,
    pub skr_mint: Account<'info, Mint>,
    #[account(init, payer = admin, seeds = [POOL_SEED], bump, token::mint = usd_mint, token::authority = config)]
    pub pool: Account<'info, TokenAccount>,
    #[account(init, payer = admin, seeds = [REWARDS_SEED], bump, token::mint = skr_mint, token::authority = config)]
    pub rewards: Account<'info, TokenAccount>,
    #[account(init, payer = admin, seeds = [SKR_VAULT_SEED], bump, token::mint = skr_mint, token::authority = config)]
    pub skr_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct Faucet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(init_if_needed, payer = user, associated_token::mint = mint, associated_token::authority = user)]
    pub user_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundVault<'info> {
    pub funder: Signer<'info>,
    #[account(mut, token::authority = funder)]
    pub from: Account<'info, TokenAccount>,
    #[account(mut, token::authority = config)]
    pub vault: Account<'info, TokenAccount>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RegisterMerchant<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Merchant::INIT_SPACE, seeds = [MERCHANT_SEED, authority.key().as_ref()], bump)]
    pub merchant: Account<'info, Merchant>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitProfile<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8 + Profile::INIT_SPACE, seeds = [PROFILE_SEED, owner.key().as_ref()], bump)]
    pub profile: Account<'info, Profile>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Pay<'info> {
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PROFILE_SEED, buyer.key().as_ref()], bump = profile.bump)]
    pub profile: Account<'info, Profile>,
    #[account(mut, seeds = [MERCHANT_SEED, merchant.authority.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
    #[account(mut, token::mint = config.usd_mint, token::authority = buyer)]
    pub buyer_usd: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.usd_mint, token::authority = merchant.authority)]
    pub merchant_usd: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OpenPlan<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PROFILE_SEED, buyer.key().as_ref()], bump = profile.bump)]
    pub profile: Account<'info, Profile>,
    #[account(mut, seeds = [MERCHANT_SEED, merchant.authority.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Plan::INIT_SPACE,
        seeds = [PLAN_SEED, buyer.key().as_ref(), &profile.plans_opened.to_le_bytes()],
        bump
    )]
    pub plan: Account<'info, Plan>,
    #[account(mut, seeds = [POOL_SEED], bump = config.pool_bump)]
    pub pool: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.usd_mint, token::authority = buyer)]
    pub buyer_usd: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.usd_mint, token::authority = merchant.authority)]
    pub merchant_usd: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PROFILE_SEED, buyer.key().as_ref()], bump = profile.bump)]
    pub profile: Account<'info, Profile>,
    #[account(mut, has_one = buyer, seeds = [PLAN_SEED, buyer.key().as_ref(), &plan.index.to_le_bytes()], bump = plan.bump)]
    pub plan: Account<'info, Plan>,
    #[account(mut, seeds = [POOL_SEED], bump = config.pool_bump)]
    pub pool: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.usd_mint, token::authority = buyer)]
    pub buyer_usd: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RepaySkr<'info> {
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PROFILE_SEED, buyer.key().as_ref()], bump = profile.bump)]
    pub profile: Account<'info, Profile>,
    #[account(mut, has_one = buyer, seeds = [PLAN_SEED, buyer.key().as_ref(), &plan.index.to_le_bytes()], bump = plan.bump)]
    pub plan: Account<'info, Plan>,
    #[account(mut, seeds = [REWARDS_SEED], bump = config.rewards_bump)]
    pub rewards: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.skr_mint, token::authority = buyer)]
    pub user_skr: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Collect<'info> {
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PROFILE_SEED, plan.buyer.as_ref()], bump = profile.bump)]
    pub profile: Account<'info, Profile>,
    #[account(mut, seeds = [PLAN_SEED, plan.buyer.as_ref(), &plan.index.to_le_bytes()], bump = plan.bump)]
    pub plan: Account<'info, Plan>,
    #[account(mut, seeds = [POOL_SEED], bump = config.pool_bump)]
    pub pool: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.usd_mint, token::authority = plan.buyer)]
    pub buyer_usd: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CheckIn<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PROFILE_SEED, owner.key().as_ref()], bump = profile.bump)]
    pub profile: Account<'info, Profile>,
    #[account(mut, seeds = [REWARDS_SEED], bump = config.rewards_bump)]
    pub rewards: Account<'info, TokenAccount>,
    #[account(address = config.skr_mint)]
    pub skr_mint: Account<'info, Mint>,
    #[account(init_if_needed, payer = owner, associated_token::mint = skr_mint, associated_token::authority = owner)]
    pub user_skr: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockSkr<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [PROFILE_SEED, owner.key().as_ref()], bump = profile.bump)]
    pub profile: Account<'info, Profile>,
    #[account(mut, seeds = [SKR_VAULT_SEED], bump = config.skr_vault_bump)]
    pub skr_vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.skr_mint, token::authority = owner)]
    pub user_skr: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CreateLink<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    /// CHECK: the ephemeral link key; only its address is stored. Its secret
    /// travels in the link and must sign the claim.
    pub link_key: UncheckedAccount<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = sender, space = 8 + Link::INIT_SPACE, seeds = [LINK_SEED, link_key.key().as_ref()], bump)]
    pub link: Account<'info, Link>,
    #[account(address = config.usd_mint)]
    pub usd_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = sender,
        seeds = [LINK_VAULT_SEED, link_key.key().as_ref()],
        bump,
        token::mint = usd_mint,
        token::authority = config
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.usd_mint, token::authority = sender)]
    pub sender_usd: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimLink<'info> {
    /// The link key signs and pays: the recipient needs no SOL.
    #[account(mut)]
    pub link_key: Signer<'info>,
    /// CHECK: any wallet may receive the dollars.
    pub recipient: UncheckedAccount<'info>,
    /// CHECK: rent goes back to the sender; checked against the link.
    #[account(mut, address = link.sender)]
    pub sender: UncheckedAccount<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, close = sender, has_one = link_key, seeds = [LINK_SEED, link_key.key().as_ref()], bump = link.bump)]
    pub link: Account<'info, Link>,
    #[account(mut, seeds = [LINK_VAULT_SEED, link_key.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(address = config.usd_mint)]
    pub usd_mint: Account<'info, Mint>,
    #[account(init_if_needed, payer = link_key, associated_token::mint = usd_mint, associated_token::authority = recipient)]
    pub recipient_usd: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelLink<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, close = sender, has_one = sender, seeds = [LINK_SEED, link.link_key.as_ref()], bump = link.bump)]
    pub link: Account<'info, Link>,
    #[account(mut, seeds = [LINK_VAULT_SEED, link.link_key.as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.usd_mint, token::authority = sender)]
    pub sender_usd: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ───────────────────────────── events & errors ─────────────────────────────

#[event]
pub struct ParamsSet {
    pub credit_paused: bool,
    pub skr_price_micros: u64,
}
#[event]
pub struct MerchantRegistered {
    pub merchant: Pubkey,
}
#[event]
pub struct Paid {
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub order_id: [u8; 16],
    pub score: u16,
}
#[event]
pub struct PlanOpened {
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    pub index: u32,
    pub principal: u64,
    pub total_owed: u64,
    pub first_due: i64,
}
#[event]
pub struct InstallmentPaid {
    pub buyer: Pubkey,
    pub index: u32,
    pub installment: u8,
    pub amount: u64,
    pub on_time: bool,
    pub payer: Pubkey,
    pub score: u16,
}
#[event]
pub struct CheckedIn {
    pub user: Pubkey,
    pub day: i64,
    pub streak: u16,
    pub reward: u64,
    pub score: u16,
}
#[event]
pub struct SkrLocked {
    pub user: Pubkey,
    pub amount: u64,
    pub locked: u64,
}
#[event]
pub struct SkrUnlocked {
    pub user: Pubkey,
    pub amount: u64,
    pub locked: u64,
}
#[event]
pub struct SkrSpent {
    pub user: Pubkey,
    pub skr: u64,
    pub usd_value: u64,
}
#[event]
pub struct LinkCreated {
    pub sender: Pubkey,
    pub link_key: Pubkey,
    pub amount: u64,
    pub expires_at: i64,
}
#[event]
pub struct LinkClaimed {
    pub sender: Pubkey,
    pub link_key: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}
#[event]
pub struct LinkCancelled {
    pub sender: Pubkey,
    pub link_key: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum PolarisError {
    #[msg("Parameters out of range")]
    BadParams,
    #[msg("The faucet is off on this network")]
    FaucetDisabled,
    #[msg("Faucet amount above the per-call cap")]
    FaucetCap,
    #[msg("Not one of Polaris' mints")]
    WrongMint,
    #[msg("Not the vault this instruction funds")]
    WrongVault,
    #[msg("Merchant name must be 1-32 bytes")]
    BadName,
    #[msg("Amount must be above zero")]
    ZeroAmount,
    #[msg("New Pay in 4 plans are paused")]
    CreditPaused,
    #[msg("Pay in 4 starts at $1")]
    PlanTooSmall,
    #[msg("Above your Pay in 4 limit")]
    OverLimit,
    #[msg("The credit pool is short")]
    PoolShort,
    #[msg("This plan is paid off")]
    PlanClosed,
    #[msg("Nothing is due yet")]
    NotDue,
    #[msg("Already clocked in today")]
    AlreadyCheckedIn,
    #[msg("That SKR backs what you owe")]
    CollateralInUse,
    #[msg("Expiry must be within 60 days")]
    BadExpiry,
    #[msg("This link has expired")]
    LinkExpired,
    #[msg("Arithmetic overflow")]
    Overflow,
}
