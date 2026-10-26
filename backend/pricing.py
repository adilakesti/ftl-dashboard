"""Final-rate computation for a sales CSV row, given the vendor costs found for
its OD + vehicle-type lane in the master rate data.

Rules:
  - Fewer than 2 vendors on the lane: no rate is given. Zero vendors is
    "No rate available"; exactly one is held for VM review ("single vendor")
    unless VM explicitly approved using that one vendor (allow_single=True).
  - Target rate given:
      1. pick the vendor cost closest to the target rate
      2. margin it at 11.1%; if that result <= target rate, use it (remarks: "Meets target")
      3. otherwise, margin the SAME cost at 5%, remarks: "Already bottom rate"
  - No target rate:
      pick the 2nd-cheapest vendor cost ("second winner"), margin at 11.1%
"""
from dataclasses import dataclass, field

MARGIN_STANDARD = 1.111
MARGIN_BOTTOM = 1.05

REMARK_PENDING_VM = "Sent to VM for review"
REMARK_VM_CONFIRMED = "Confirmed by VM"


@dataclass
class PricingResult:
    final_rate: float | None
    remarks: str
    matched_vendor: str | None
    matched_cost: float | None
    basis: str | None = None
    ranked: list[tuple[str, float]] = field(default_factory=list)
    single_vendor: bool = False


def compute_final_rate(
    costs: dict[str, float], target_rate: float | None, allow_single: bool = False
) -> PricingResult:
    ranked = sorted(costs.items(), key=lambda kv: kv[1])
    n = len(ranked)
    if n == 0:
        return PricingResult(final_rate=None, remarks="No rate available", matched_vendor=None, matched_cost=None)
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
    if target_rate is not None:
        vendor, cost = min(costs.items(), key=lambda kv: abs(kv[1] - target_rate))
        basis = "Only vendor (VM approved)" if single else f"Closest to target of {n} vendors"
        standard = round(cost * MARGIN_STANDARD, 2)
        if standard <= target_rate:
            final, remarks = standard, "Meets target"
        else:
            final, remarks = round(cost * MARGIN_BOTTOM, 2), "Already bottom rate"
    else:
        vendor, cost = ranked[0] if single else ranked[1]
        basis = "Only vendor (VM approved)" if single else f"2nd cheapest of {n} vendors"
        final, remarks = round(cost * MARGIN_STANDARD, 2), ""

    if single:
        remarks = REMARK_VM_CONFIRMED
    return PricingResult(
        final_rate=final,
        remarks=remarks,
        matched_vendor=vendor,
        matched_cost=cost,
        basis=basis,
        ranked=ranked,
        single_vendor=single,
    )
