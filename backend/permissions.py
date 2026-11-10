"""Who may see and do what — the single source of truth.

Every role sees the same app (one shell, same screens). What differs per role is
which menu entries, columns and buttons appear. The frontend renders from the
map /api/me returns; every endpoint below re-checks the same rules, so hiding
something in the UI is never the only protection.

Roles: "sales", "vm" (vendor management), "procurement" (same rights as vm, its own
label), "superadmin" (everything). A superadmin may also *view as* another role: the
backend then answers exactly as it would for that role (see main.current_user).
"""

ROLES = ("sales", "vm", "procurement", "superadmin")
# Roles that do vendor-management work. Anything gated on "vm" accepts all of these.
VM_ROLES = ("vm", "procurement")
# What a superadmin can switch the app to with "View as".
VIEW_AS_ROLES = ("sales", "vm", "procurement")


def satisfies(actual: str | None, required: str) -> bool:
    """Does a user with role `actual` pass a check that requires role `required`?"""
    if actual == "superadmin" or actual == required:
        return True
    return required == "vm" and actual in VM_ROLES


def permissions_for(role: str | None) -> dict[str, bool]:
    signed_in = role in ROLES
    sales = role in ("sales", "superadmin")
    vm = role in VM_ROLES or role == "superadmin"
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
