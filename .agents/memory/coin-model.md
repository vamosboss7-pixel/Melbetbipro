---
name: Three-wallet model (depositBalance / mainBalance / bonusBalance)
description: Architectural rule for how funds are classified across the three wallet columns and what each means.
---

# Three-wallet model

## The rule
Three separate DB columns on the `players` table, each with distinct semantics:

| Column | DB name | Withdrawable | Purpose |
|---|---|---|---|
| `depositBalance` | `deposit_balance` | ❌ No | Funds deposited by the player — used for gameplay only |
| `mainBalance` | `main_balance` | ✅ Yes | Game winnings — the only withdrawable balance |
| `bonusBalance` | `bonus_balance` | ❌ No (until wagering met) | Registration/promo bonuses — subject to wagering requirement |

**Why:** Separates player deposits (gameplay-only, no wagering overhead) from promotional bonuses (wagering required) and withdrawable winnings.

**How to apply:**
- **Deposits** → always credit `depositBalance` only (autoDeposit.ts, admin.ts, bot.ts deposit approval).
- **Promo/registration bonuses** → always credit `bonusBalance` (telegram.ts signup bonus, bot.ts invite/channel bonus, etc.).
- **Game wins** → `mainBalance` (if game was funded by deposit or main only); `bonusBalance` (if bonus funds were used — wagering rules apply).
- **Stake deduction order**: `depositBalance` first, then `mainBalance`/`bonusBalance` per player preference (`main_first` or `bonus_first`).
- **Wagering tracking**: only applies when `bonusBalance` is deducted. `depositBalance` deductions do NOT progress wagering.
- **Withdrawals**: check only `mainBalance`. Never deduct `depositBalance` or `bonusBalance` for withdrawals.
- **Balance checks** (join/card select): use `depositBalance + mainBalance + bonusBalance` combined.

## agentBalance
- Separate wallet for agent commissions — unchanged by this model.

## Admin manual adjustments
- `/api/admin/balance-adjust` still touches `mainBalance` — intentional (admin override).
