"""Final-rate computation for a sales CSV row, given the vendor costs found for
its OD + vehicle-type lane in the master sheet.

Rules (see project chat / CLAUDE.md for the source discussion):
  - Target rate given:
      1. pick the vendor cost closest to the target rate
      2. margin it at 11.1%; if that result <= target rate, use it (remarks: "Meets target")
      3. otherwise, margin the SAME closest cost at 5%, remarks: "already bottom rate"
  - No target rate:
      pick the 2nd-cheapest vendor cost ("second winner"), margin at 11.1%
  - No costs found at all for the lane: final rate is null, remarks: "No rate available"
"""
from dataclasses import dataclass

MARGIN_STANDARD = 1.111
MARGIN_BOTTOM = 1.05


@dataclass
class PricingResult:
    final_rate: float | None
    remarks: str
    matched_vendor: str | None
    matched_cost: float | None


def compute_final_rate(costs: dict[str, float], target_rate: float | None) -> PricingResult:
    if not costs:
        return PricingResult(final_rate=None, remarks="No rate available", matched_vendor=None, matched_cost=None)

    if target_rate is not None:
        vendor, cost = min(costs.items(), key=lambda kv: abs(kv[1] - target_rate))
        standard = round(cost * MARGIN_STANDARD, 2)
        if standard <= target_rate:
            return PricingResult(final_rate=standard, remarks="Meets target", matched_vendor=vendor, matched_cost=cost)
        bottom = round(cost * MARGIN_BOTTOM, 2)
        return PricingResult(final_rate=bottom, remarks="Already bottom rate", matched_vendor=vendor, matched_cost=cost)

    ranked = sorted(costs.items(), key=lambda kv: kv[1])
    if len(ranked) >= 2:
        vendor, cost = ranked[1]
    else:
        vendor, cost = ranked[0]
    final = round(cost * MARGIN_STANDARD, 2)
    return PricingResult(final_rate=final, remarks="", matched_vendor=vendor, matched_cost=cost)
