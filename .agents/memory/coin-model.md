---
name: Coin model (playBalance vs balance)
description: Architectural rule for how funds are classified — coins vs ETB — and what each balance column means.
---

# Coin model

## The rule
- `playBalance` column = **Coins** — deposits + all bonuses (register, invite, promo, channel, checkin, achievement, depositor bonus). Used to pay stakes. **Not withdrawable.**
- `balance` column = **ETB** — only game winnings (`win` transactions). **Fully withdrawable.**
- 10 coins = 10 ETB play value (1:1 ratio, just different types).

**Why:** Prevents players from depositing and immediately withdrawing. Only game winnings can leave the system.

**How to apply:**
- Any new bonus or deposit route must credit `playBalance` only, never `balance`.
- Game staking deducts from `playBalance` only (`GREATEST(playBalance - stake, 0)`).
- Game win credits `balance` only.
- Withdrawable check: `balance` directly (no subtraction needed).
- Balance checks before joining/selecting cards use `playBalance`.

## Exception
- `agentBalance` is a separate wallet for agents (commissions, join bonuses) — unchanged by this model.
- Admin manual adjustments (`/api/admin/balance-adjust`) still touch both columns — intentional.
