"""FTL lane pricing (rules set by Michael, 2026-11-11; replaces the 1.111 / 1.061
markup).

Per lane (origin + destination + vehicle), from the ACTIVE vendor costs on file:
  - 0 vendors: no price; the lane goes to the VM queue.
  - 1 vendor:  no price for sales; the lane goes to the VM queue and VM sets it
    manually (VM may use that lane's one vendor from master data —
    allow_single=True).
  - 2+ vendors: the basis is the 2nd-cheapest vendor cost (with or without a
    target rate).

From the basis cost, three selling prices are offered, margin ON PRICE and rounded
up to the next Rp 100 (Excel ROUNDUP(x, -2)):
     5% margin  -> approval: Alex
    10% margin  -> Category 2, approval: Head
    15% margin  -> Category 1, approval: Manager
Category of a margin follows the PNS FTL rule: >= 15% Cat 1, 10-15% Cat 2,
< 10% Cat 3. Approvals are labels only (no approval step in the app).

All prices are BEFORE tax (PPN) and before overnight / TKBM / extra drop charges.

The lane's single "final rate" (quotation, go-live, dashboards) is the suggested tier:
  - target given: the highest-margin tier whose price is <= target; if even the 5%
    price is above the target, the 5% price (remark says so).
  - no target: the 15% (Category 1) price.
"""
import math
from dataclasses import dataclass, field

# (margin %, approval label, category or None)
TIERS = ((5, "Approval Alex", None), (10, "Approval Head", 2), (15, "Approval Manager", 1))
FLOOR_PCT = TIERS[0][0]
DEFAULT_PCT = 15  # suggested tier when no target rate is given

REMARK_PENDING_VM = "1 vendor: VM to set the rate"
REMARK_NO_VENDOR = "No vendor on file: sent to VM"
REMARK_VM_CONFIRMED = "Rate set by VM"


def roundup_100(x: float) -> float:
    """Excel ROUNDUP(x, -2): up to the next multiple of 100 (exact multiples stay)."""
    return float(math.ceil(round(x, 6) / 100) * 100)


def tier_price(cost: float, pct: float) -> float:
    """Selling price giving `pct`% margin on price: cost / (1 - pct), rounded up to Rp 100."""
    return roundup_100(cost / (1 - pct / 100))


def margin_on_price(price: float, cost: float) -> float | None:
    if not price:
        return None
    return round((price - cost) / price * 100, 2)


def category_for(margin_pct: float | None) -> int | None:
    if margin_pct is None:
        return None
    if margin_pct >= 15:
        return 1
    if margin_pct >= 10:
        return 2
    return 3


def tiers_for(cost: float) -> list[dict]:
    return [
        {"margin_pct": pct, "approval": approval, "category": cat, "price": tier_price(cost, pct)}
        for pct, approval, cat in TIERS
    ]


def lane_pricing(cost: float | None, target_rate: float | None) -> dict | None:
    """Everything the ticket view shows for a priced lane (vendor names excluded)."""
    if cost is None:
        return None
    margin_at_target = margin_on_price(target_rate, cost) if target_rate else None
    return {
        "basis_cost": cost,
        "target_rate": target_rate,
        "margin_at_target": margin_at_target,
        "target_category": category_for(margin_at_target),
        "tiers": tiers_for(cost),
    }


def suggest(cost: float, target_rate: float | None) -> tuple[float, int, str]:
    """(final rate, margin %, remark) for a basis cost."""
    if target_rate is None:
        return tier_price(cost, DEFAULT_PCT), DEFAULT_PCT, f"No target: {DEFAULT_PCT}% margin (Cat 1)"
    for pct, _, _ in sorted(TIERS, key=lambda t: -t[0]):
        price = tier_price(cost, pct)
        if price <= target_rate:
            return price, pct, f"Meets target at {pct}% margin"
    return tier_price(cost, FLOOR_PCT), FLOOR_PCT, f"Above target even at {FLOOR_PCT}% margin"


@dataclass
class PricingResult:
    final_rate: float | None
    remarks: str
    matched_vendor: str | None
    matched_cost: float | None
    basis: str | None = None
    ranked: list[tuple[str, float]] = field(default_factory=list)
    single_vendor: bool = False
    margin_pct: float | None = None


def compute_final_rate(
    costs: dict[str, float], target_rate: float | None, allow_single: bool = False
) -> PricingResult:
    ranked = sorted(costs.items(), key=lambda kv: kv[1])
    n = len(ranked)
    if n == 0:
        return PricingResult(final_rate=None, remarks=REMARK_NO_VENDOR, matched_vendor=None, matched_cost=None)
    if n == 1 and not allow_single:
        return PricingResult(
            final_rate=None,
            remarks=REMARK_PENDING_VM,
            matched_vendor=None,
            matched_cost=None,
            ranked=ranked,
            single_vendor=True,
        )

    single = n == 1
    vendor, cost = ranked[0] if single else ranked[1]
    basis = "Only vendor (set by VM)" if single else f"2nd cheapest of {n} vendors"
    final, margin_pct, remarks = suggest(cost, target_rate)
    if single:
        remarks = f"{REMARK_VM_CONFIRMED}; {remarks[0].lower()}{remarks[1:]}"
    return PricingResult(
        final_rate=final,
        remarks=remarks,
        matched_vendor=vendor,
        matched_cost=cost,
        basis=basis,
        ranked=ranked,
        single_vendor=single,
        margin_pct=margin_pct,
    )
