"""Who may see and do what — the single source of truth.

Every role sees the same app (one shell, same screens). What differs per role is
which menu entries, columns and buttons appear. The frontend renders from the
map /api/me returns; every endpoint below re-checks the same rules, so hiding
something in the UI is never the only protection.

Roles: "sales", "vm" (vendor management), "superadmin" (everything).
"""

ROLES = ("sales", "vm", "superadmin")


def permissions_for(role: str | None) -> dict[str, bool]:
    signed_in = role in ROLES
    sales = role in ("sales", "superadmin")
    vm = role in ("vm", "superadmin")
    return {
        # Everyone provisioned: the shared, read-only views.
        "viewQueue": signed_in,
        "viewSubmissions": signed_in,
        "viewProfitability": signed_in,
        "comment": signed_in,
        "confirmGoLive": signed_in,
        # Sales work.
        "createRequest": sales,
        "quickCheck": sales,
        # Vendor-management work.
        "workTickets": vm,
        "manageRates": vm,
        "editProfitability": vm,
        # Vendor names, vendor costs and margins. Sales never sees these, on any
        # screen — the backend strips them from responses, not just the UI.
        "seeVendorData": vm,
        # Superadmin.
        "manageUsers": role == "superadmin",
    }


def can(role: str | None, action: str) -> bool:
    return permissions_for(role).get(action, False)
