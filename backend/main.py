"""FTL pricing dashboard backend. Port 8000, GET /health, API under /api.

Auth: Google SSO via the platform's X-Forwarded-Email header (trustworthy only
while SSO is enabled — see /api/me). Role (sales / vm) is a simple allowlist
table (user_roles) keyed by email; an unprovisioned email is shown a
"not provisioned" message by the frontend rather than crashing.
"""
import csv
import io
import json
import asyncio
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel

import db
import master_rates
import permissions
import pricing


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with db.lifespan_pool():
        sweeper = asyncio.create_task(_sla_sweep_loop())
        try:
            yield
        finally:
            sweeper.cancel()


app = FastAPI(title="FTL Pricing Dashboard", lifespan=lifespan)


class Health(BaseModel):
    status: str


@app.get("/health", response_model=Health)
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Identity / role
# ---------------------------------------------------------------------------


class Me(BaseModel):
    email: str | None
    role: str | None  # effective role (the "view as" role while a superadmin previews)
    permissions: dict[str, bool] = {}
    real_role: str | None = None
    view_as_options: list[str] = []


async def current_user(request: Request) -> tuple[str, str | None]:
    """(email, effective role). A real superadmin may send `X-View-As: <role>` to have
    every endpoint answer as that role would — permissions, redaction and all. The
    header is ignored for anyone else, so it can't be used to gain access."""
    email, role = await _real_user(request)
    view_as = (request.headers.get("x-view-as") or "").strip().lower()
    if role == "superadmin" and view_as in permissions.VIEW_AS_ROLES:
        return email, view_as
    return email, role


async def _real_user(request: Request) -> tuple[str, str | None]:
    email = request.headers.get("x-forwarded-email")
    if not email:
        return None, None
    if db.pool() is None:
        return email, None
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT role FROM user_roles WHERE email = %s", (email,))
        row = await cur.fetchone()
    return email, (row[0] if row else None)


async def require_role(request: Request, role: str) -> str:
    email, actual_role = await current_user(request)
    if not email:
        raise HTTPException(401, "Not signed in")
    if not permissions.satisfies(actual_role, role):
        raise HTTPException(403, f"Not provisioned as {role}")
    return email


async def require_superadmin(request: Request) -> str:
    email, actual_role = await current_user(request)
    if not email:
        raise HTTPException(401, "Not signed in")
    if actual_role != "superadmin":
        raise HTTPException(403, "Not provisioned as superadmin")
    return email


async def require_any_role(request: Request) -> str:
    email, actual_role = await current_user(request)
    if not email:
        raise HTTPException(401, "Not signed in")
    if actual_role not in permissions.ROLES:
        raise HTTPException(403, "Not provisioned")
    return email


async def require_permission(request: Request, action: str) -> tuple[str, str]:
    """Signed in and allowed `action` (see permissions.py). Returns (email, role)."""
    email, role = await current_user(request)
    if not email:
        raise HTTPException(401, "Not signed in")
    if not permissions.can(role, action):
        raise HTTPException(403, "Not allowed")
    return email, role


@app.get("/api/me", response_model=Me)
async def me(request: Request):
    email, role = await current_user(request)
    _, real_role = await _real_user(request)
    return {
        "email": email,
        "role": role,
        "permissions": permissions.permissions_for(role),
        "real_role": real_role,
        "view_as_options": list(permissions.VIEW_AS_ROLES) if real_role == "superadmin" else [],
    }


# ---------------------------------------------------------------------------
# Superadmin: manage who has access and their role
# ---------------------------------------------------------------------------


class UserRole(BaseModel):
    email: str
    role: str
    display_name: str | None = None


class UserRoleList(BaseModel):
    users: list[UserRole]


class UserRoleIn(BaseModel):
    email: str
    role: str
    display_name: str | None = None


@app.get("/api/admin/users", response_model=UserRoleList)
async def list_users(request: Request):
    await require_superadmin(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT email, role, display_name FROM user_roles ORDER BY email")
        rows = await cur.fetchall()
    return UserRoleList(users=[UserRole(email=r[0], role=r[1], display_name=r[2]) for r in rows])


@app.post("/api/admin/users", response_model=UserRole, status_code=201)
async def upsert_user(body: UserRoleIn, request: Request):
    await require_superadmin(request)
    if body.role not in permissions.ROLES:
        raise HTTPException(400, "role must be one of: sales, vm, superadmin")
    email = body.email.strip().lower()
    if not email:
        raise HTTPException(400, "email is required")
    display_name = (body.display_name or "").strip() or None
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """INSERT INTO user_roles (email, role, display_name) VALUES (%s, %s, %s)
               ON DUPLICATE KEY UPDATE role = VALUES(role),
                   display_name = COALESCE(VALUES(display_name), display_name)""",
            (email, body.role, display_name),
        )
        await cur.execute("SELECT display_name FROM user_roles WHERE email = %s", (email,))
        row = await cur.fetchone()
    return UserRole(email=email, role=body.role, display_name=row[0] if row else display_name)


@app.delete("/api/admin/users/{email}", status_code=204)
async def delete_user(email: str, request: Request):
    await require_superadmin(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute("DELETE FROM user_roles WHERE email = %s", (email,))


# ---------------------------------------------------------------------------
# Shared helpers: pricing snapshot, system notes in the Discussion
# ---------------------------------------------------------------------------

SYSTEM_AUTHOR = "system"


def _snapshot(result) -> tuple[str | None, str | None]:
    """(winner basis, ranked vendor list as JSON) recorded on the row at pricing time."""
    ranked_json = json.dumps([{"vendor": v, "cost": c} for v, c in result.ranked]) if result.ranked else None
    return result.basis, ranked_json


async def _system_comment(cur, submission_id: int, message: str) -> None:
    """Automatic note in a shipper's Discussion. Never triggers @mention notifications."""
    await cur.execute(
        "INSERT INTO submission_comments (submission_id, author_email, message) VALUES (%s, %s, %s)",
        (submission_id, SYSTEM_AUTHOR, message),
    )


def _idr(n: float) -> str:
    return "Rp" + f"{n:,.0f}".replace(",", ".")


# ---------------------------------------------------------------------------
# Sales: submissions
# ---------------------------------------------------------------------------


class SubmissionRow(BaseModel):
    id: int
    origin: str
    destination: str
    vehicle_type: str
    target_rate: float | None
    final_rate: float | None
    remarks: str
    matched_vendor: str | None
    min_trip: int | None = None
    raised_to_vm: bool = False
    needs_vm: bool = False


class AddOn(BaseModel):
    label: str
    value: str | None = None
    # Set for the services VM prices on request (key of SERVICES); value is sales' note.
    service: str | None = None


# Additional services sales can ask VM to price: key -> (label, unit).
SERVICES = {
    "overnight": ("Overnight", "per malam"),
    "tkbm": ("TKBM", "per orang"),
    "additional_drop": ("Additional Drop Point", "per titik"),
}


class Submission(BaseModel):
    id: int
    uploaded_by: str
    filename: str | None
    created_at: str
    shipper_name: str | None = None
    sales_pic: str | None = None
    sales_email: str | None = None
    submitted_at: str | None = None
    shipper_status: str | None = None
    potential_monthly_revenue: float | None = None
    commodity_type: str | None = None
    high_value_fragile: bool = False
    add_ons: list[AddOn] = []


class SubmissionList(BaseModel):
    submissions: list[Submission]


class SubmissionDetail(BaseModel):
    submission: Submission
    rows: list[SubmissionRow]
    ticket_no: str | None = None
    # True when the viewer raised this ticket and VM hasn't started on any lane yet.
    editable: bool = False


def ticket_no(submission_id: int) -> str:
    """The ticket number people quote: FTL- + the submission's running id, 6 digits."""
    return f"FTL-{submission_id:06d}"


CSV_HEADER_ALIASES = {
    "l2 origin": "origin",
    "origin": "origin",
    "l2 destinasi": "destination",
    "l2 destination": "destination",
    "destination": "destination",
    "vehicle type": "vehicle_type",
    "target rate": "target_rate",
    "minimum trip": "min_trip",
    "min trip": "min_trip",
}


def _parse_whole_number(raw: str) -> int | None:
    raw = (raw or "").replace(",", "").strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return int(value) if value >= 0 and value == int(value) else None


def _parse_csv(content: bytes) -> list[dict]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(400, "CSV has no header row")

    colmap = {}
    for field in reader.fieldnames:
        key = CSV_HEADER_ALIASES.get(field.strip().lower())
        if key:
            colmap[field] = key

    for required in ("origin", "destination", "vehicle_type"):
        if required not in colmap.values():
            raise HTTPException(400, f"CSV missing required column for '{required}'")

    rows = []
    for raw in reader:
        row = {colmap[k]: (v.strip() if v else "") for k, v in raw.items() if k in colmap}
        if not row.get("origin") or not row.get("destination") or not row.get("vehicle_type"):
            continue
        target_raw = row.get("target_rate", "")
        target_rate = None
        if target_raw:
            try:
                target_rate = float(target_raw.replace(",", ""))
            except ValueError:
                target_rate = None
        rows.append(
            {
                "origin": row["origin"],
                "destination": row["destination"],
                "vehicle_type": row["vehicle_type"],
                "target_rate": target_rate,
                "min_trip": _parse_whole_number(row.get("min_trip", "")),
            }
        )
    return rows


def _row_to_submission(r) -> Submission:
    add_ons_raw = r[10]
    add_ons = [AddOn(**a) for a in json.loads(add_ons_raw)] if add_ons_raw else []
    return Submission(
        id=r[0],
        uploaded_by=r[1],
        filename=r[2],
        created_at=str(r[3]),
        shipper_name=r[4],
        sales_pic=r[5],
        shipper_status=r[6],
        potential_monthly_revenue=float(r[7]) if r[7] is not None else None,
        commodity_type=r[8],
        high_value_fragile=bool(r[9]),
        add_ons=add_ons,
        sales_email=r[11],
        submitted_at=str(r[12]) if r[12] else None,
    )


SUBMISSION_COLUMNS = (
    "id, uploaded_by, filename, created_at, shipper_name, sales_pic, shipper_status, "
    "potential_monthly_revenue, commodity_type, high_value_fragile, add_ons, sales_email, submitted_at"
)


@app.post("/api/submissions/upload", response_model=SubmissionDetail, status_code=201)
async def upload_submission(
    request: Request,
    file: UploadFile,
    shipper_name: str = Form(...),
    sales_pic: str = Form(...),
    shipper_status: str = Form(...),
    potential_monthly_revenue: str | None = Form(None),
    commodity_type: str | None = Form(None),
    high_value_fragile: bool = Form(False),
    add_ons_json: str | None = Form(None),
    sales_email: str | None = Form(None),
):
    email = await require_role(request, "sales")
    _, role = await current_user(request)
    sales_email = (sales_email or "").strip().lower() or None
    if sales_email:
        async with db.pool().acquire() as conn, conn.cursor() as cur:
            await cur.execute("SELECT role FROM user_roles WHERE email = %s", (sales_email,))
            urow = await cur.fetchone()
        if not urow or urow[0] != "sales":
            raise HTTPException(400, "Sales PIC must be a user with the sales role")
    content = await file.read()
    rows = _parse_csv(content)
    if not rows:
        raise HTTPException(400, "No usable rows found in CSV")

    if shipper_status not in ("new", "existing"):
        raise HTTPException(400, "shipper_status must be 'new' or 'existing'")

    revenue = None
    if potential_monthly_revenue:
        try:
            revenue = float(potential_monthly_revenue.replace(",", ""))
        except ValueError:
            revenue = None

    add_ons_list = []
    if add_ons_json:
        try:
            add_ons_list = [AddOn(**a).model_dump() for a in json.loads(add_ons_json)]
        except (json.JSONDecodeError, TypeError, ValueError):
            raise HTTPException(400, "add_ons_json is not valid JSON")
        for a in add_ons_list:
            if a["service"] is not None and a["service"] not in SERVICES:
                raise HTTPException(400, f"Unknown service: {a['service']}")

    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """INSERT INTO submissions
               (uploaded_by, filename, shipper_name, sales_pic, shipper_status,
                potential_monthly_revenue, commodity_type, high_value_fragile, add_ons, sales_email)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                email,
                file.filename,
                shipper_name,
                sales_pic,
                shipper_status,
                revenue,
                commodity_type,
                high_value_fragile,
                json.dumps(add_ons_list) if add_ons_list else None,
                sales_email,
            ),
        )
        submission_id = cur.lastrowid

        result_rows = []
        for row in rows:
            costs = await master_rates.find_costs(db.pool(), row["origin"], row["destination"], row["vehicle_type"])
            result = pricing.compute_final_rate(costs, row["target_rate"])
            basis, ranked_json = _snapshot(result)

            await cur.execute(
                """INSERT INTO submission_rows
                   (submission_id, origin, destination, vehicle_type, target_rate,
                    final_rate, remarks, matched_vendor, matched_cost,
                    min_trip, matched_basis, matched_ranked, margin_pct)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    submission_id,
                    row["origin"],
                    row["destination"],
                    row["vehicle_type"],
                    row["target_rate"],
                    result.final_rate,
                    result.remarks,
                    result.matched_vendor,
                    result.matched_cost,
                    row["min_trip"],
                    basis,
                    ranked_json,
                    result.margin_pct,
                ),
            )
            row_id = cur.lastrowid
            result_rows.append(
                SubmissionRow(
                    id=row_id,
                    origin=row["origin"],
                    destination=row["destination"],
                    vehicle_type=row["vehicle_type"],
                    target_rate=row["target_rate"],
                    final_rate=result.final_rate,
                    remarks=result.remarks,
                    matched_vendor=(
                        result.matched_vendor
                        if not result.single_vendor and permissions.can(role, "seeVendorData")
                        else None
                    ),
                    min_trip=row["min_trip"],
                    raised_to_vm=False,
                    needs_vm=result.single_vendor,
                )
            )

        await cur.execute(
            f"SELECT {SUBMISSION_COLUMNS} FROM submissions WHERE id = %s",
            (submission_id,),
        )
        srow = await cur.fetchone()

    return SubmissionDetail(
        submission=_row_to_submission(srow),
        rows=result_rows,
    )


@app.get("/api/submissions", response_model=SubmissionList)
async def list_submissions(request: Request, scope: str = Query("mine", pattern="^(mine|all)$")):
    """scope=mine: this salesperson's own submissions (drafts included).
    scope=all: every submitted request, from every salesperson — the shared,
    read-only list any role may open."""
    if scope == "all":
        await require_permission(request, "viewSubmissions")
        async with db.pool().acquire() as conn, conn.cursor() as cur:
            await cur.execute(
                f"SELECT {SUBMISSION_COLUMNS} FROM submissions WHERE submitted_at IS NOT NULL ORDER BY id DESC"
            )
            rows = await cur.fetchall()
        return SubmissionList(submissions=[_row_to_submission(r) for r in rows])
    email = await require_role(request, "sales")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            f"SELECT {SUBMISSION_COLUMNS} FROM submissions WHERE uploaded_by = %s ORDER BY id DESC",
            (email,),
        )
        rows = await cur.fetchall()
    return SubmissionList(submissions=[_row_to_submission(r) for r in rows])


async def _load_submission_detail(
    cur, submission_id: int, email: str | None, show_vendor: bool = False
) -> SubmissionDetail:
    """email given: only that salesperson's own submission (drafts included).
    email None: any submitted one, read-only (the shared view)."""
    if email is not None:
        await cur.execute(
            f"SELECT {SUBMISSION_COLUMNS} FROM submissions WHERE id = %s AND uploaded_by = %s",
            (submission_id, email),
        )
    else:
        await cur.execute(
            f"SELECT {SUBMISSION_COLUMNS} FROM submissions WHERE id = %s AND submitted_at IS NOT NULL",
            (submission_id,),
        )
    srow = await cur.fetchone()
    if not srow:
        raise HTTPException(404, "Submission not found")

    await cur.execute(
        """SELECT id, origin, destination, vehicle_type, target_rate, final_rate,
                  remarks, matched_vendor, min_trip,
                  EXISTS(SELECT 1 FROM vm_requests vr WHERE vr.submission_row_id = submission_rows.id
                         AND vr.status IN ('open', 'in_progress'))
           FROM submission_rows WHERE submission_id = %s ORDER BY id""",
        (submission_id,),
    )
    rows = await cur.fetchall()
    return SubmissionDetail(
        submission=_row_to_submission(srow),
        rows=[
            SubmissionRow(
                id=r[0],
                origin=r[1],
                destination=r[2],
                vehicle_type=r[3],
                target_rate=float(r[4]) if r[4] is not None else None,
                final_rate=float(r[5]) if r[5] is not None else None,
                remarks=r[6] or "",
                matched_vendor=r[7] if show_vendor else None,
                min_trip=r[8],
                raised_to_vm=bool(r[9]),
                needs_vm=r[5] is None and r[6] == pricing.REMARK_PENDING_VM and not r[9],
            )
            for r in rows
        ],
    )


@app.get("/api/submissions/{submission_id}", response_model=SubmissionDetail)
async def get_submission(submission_id: int, request: Request):
    """The owner gets their own (drafts too); anyone else may read a submitted
    one. Vendor names only for roles that may see vendor data."""
    email, role = await require_permission(request, "viewSubmissions")
    show_vendor = permissions.can(role, "seeVendorData")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        try:
            detail = await _load_submission_detail(cur, submission_id, email, show_vendor)
        except HTTPException:
            detail = await _load_submission_detail(cur, submission_id, None, show_vendor)
        editable = permissions.can(role, "createRequest") and await _ticket_editable(cur, submission_id, email)
    return detail.model_copy(update={"ticket_no": ticket_no(submission_id), "editable": editable})


class SubmitIn(BaseModel):
    ask_vm_row_ids: list[int] = []


@app.post("/api/submissions/{submission_id}/submit", response_model=SubmissionDetail)
async def submit_submission(submission_id: int, body: SubmitIn, request: Request):
    """Sales' final gate. Until this runs a submission is a draft: nothing reaches VM
    and it shows nowhere but the history list. On submit, the lanes sales chose to
    ask VM about — plus every lane that can't be priced yet because it has a single
    vendor — become VM tickets. Lanes without a rate that sales did not ask about
    are marked "Not requested" and go no further."""
    email = await require_role(request, "sales")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT submitted_at, add_ons FROM submissions WHERE id = %s AND uploaded_by = %s",
            (submission_id, email),
        )
        srow = await cur.fetchone()
        if not srow:
            raise HTTPException(404, "Submission not found")
        if srow[0] is not None:
            raise HTTPException(400, "This submission was already submitted")
        for a in json.loads(srow[1]) if srow[1] else []:
            if a.get("service") in SERVICES:
                await cur.execute(
                    "INSERT INTO service_requests (submission_id, service, note) VALUES (%s, %s, %s)",
                    (submission_id, a["service"], (a.get("value") or None) and a["value"][:1000]),
                )

        await cur.execute(
            """SELECT id, origin, destination, vehicle_type, target_rate, final_rate, remarks
               FROM submission_rows WHERE submission_id = %s ORDER BY id""",
            (submission_id,),
        )
        rows = await cur.fetchall()
        row_ids = {r[0] for r in rows}
        asked = set(body.ask_vm_row_ids)
        if not asked <= row_ids:
            raise HTTPException(400, "Unknown lane in the selection")

        for row_id, origin, destination, vehicle, target, final_rate, remarks in rows:
            needs_vm = final_rate is None and remarks == pricing.REMARK_PENDING_VM
            if row_id in asked or needs_vm:
                await cur.execute(
                    """INSERT INTO vm_requests
                       (submission_row_id, origin, destination, vehicle_type, target_rate,
                        current_final_rate, requested_by)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (row_id, origin, destination, vehicle, target, final_rate, email),
                )
            elif final_rate is None:
                await cur.execute(
                    "UPDATE submission_rows SET remarks = 'Not requested' WHERE id = %s", (row_id,)
                )
        await cur.execute("UPDATE submissions SET submitted_at = NOW() WHERE id = %s", (submission_id,))
        return await _load_submission_detail(cur, submission_id, email)


@app.delete("/api/submissions/{submission_id}", status_code=204)
async def delete_draft_submission(submission_id: int, request: Request):
    """Discard a draft (e.g. when sales re-run Check Result). Submitted ones are kept."""
    email = await require_role(request, "sales")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT 1 FROM submissions WHERE id = %s AND uploaded_by = %s AND submitted_at IS NULL",
            (submission_id, email),
        )
        if not await cur.fetchone():
            raise HTTPException(404, "Draft not found")
        await cur.execute("DELETE FROM submission_rows WHERE submission_id = %s", (submission_id,))
        await cur.execute("DELETE FROM submissions WHERE id = %s", (submission_id,))


# ---------------------------------------------------------------------------
# VM requests
# ---------------------------------------------------------------------------


class RankedVendor(BaseModel):
    vendor: str
    cost: float


class VmRequestIn(BaseModel):
    submission_row_id: int | None = None
    origin: str
    destination: str
    vehicle_type: str
    target_rate: float | None = None
    current_final_rate: float | None = None


class VmRequest(BaseModel):
    id: int
    origin: str
    destination: str
    vehicle_type: str
    target_rate: float | None
    target_cost: float | None
    current_final_rate: float | None
    requested_by: str
    status: str
    resolved_vendor: str | None
    resolved_cost: float | None
    created_at: str
    aging_days: int
    submission_row_id: int | None = None
    submission_id: int | None = None
    shipper_name: str | None = None
    sales_pic: str | None = None
    shipper_status: str | None = None
    potential_monthly_revenue: float | None = None
    commodity_type: str | None = None
    high_value_fragile: bool | None = None
    submission_created_at: str | None = None
    add_ons: list[AddOn] = []
    sales_email: str | None = None
    min_trip: int | None = None
    auto_closed_sla: bool = False
    # VM-only (left empty/None in the sales-facing views):
    vendor_count: int | None = None
    only_one_vendor: bool = False
    single_vendor_approved: bool = False
    override_reason: str | None = None
    override_by: str | None = None
    winner_basis: str | None = None
    ranked_vendors: list["RankedVendor"] = []


class VmRequestList(BaseModel):
    requests: list[VmRequest]


class LaneSummary(BaseModel):
    origin: str
    destination: str
    vehicle_type: str
    request_count: int
    avg_target_rate: float | None = None


class VmSummary(BaseModel):
    seeking_lower_rate: list[LaneSummary]
    missing_lanes: list[LaneSummary]


VM_REQUEST_SELECT_FROM = """
    SELECT vr.id, vr.origin, vr.destination, vr.vehicle_type, vr.target_rate, vr.current_final_rate,
           vr.requested_by, vr.status, vr.resolved_vendor, vr.resolved_cost, vr.created_at,
           vr.submission_row_id, s.shipper_name, s.sales_pic, s.shipper_status,
           s.potential_monthly_revenue, s.commodity_type, s.high_value_fragile, s.id, s.created_at, s.add_ons,
           s.sales_email, sr.min_trip, sr.matched_basis, sr.matched_ranked,
           vr.single_vendor_approved, vr.override_reason, vr.override_by, vr.auto_closed_sla,
           sr.margin_pct
    FROM vm_requests vr
    LEFT JOIN submission_rows sr ON vr.submission_row_id = sr.id
    LEFT JOIN submissions s ON sr.submission_id = s.id
"""


async def _lane_vendor_counts(cur) -> dict[tuple[str, str, str], int]:
    await cur.execute(
        """SELECT norm_origin, norm_destination, norm_vehicle_type, COUNT(*)
           FROM vendor_rates GROUP BY norm_origin, norm_destination, norm_vehicle_type"""
    )
    return {(r[0], r[1], r[2]): r[3] for r in await cur.fetchall()}


def _to_vm_request(r, lane_counts: dict | None = None) -> VmRequest:
    """lane_counts is passed only for VM-facing responses: it switches on the
    VM-only fields (vendor count / "only 1 vendor" flag, winner basis, ranked list)."""
    target_rate = float(r[4]) if r[4] is not None else None
    created_at = r[10]
    aging_days = 0
    if created_at is not None:
        now = datetime.now(created_at.tzinfo) if created_at.tzinfo else datetime.now()
        aging_days = max(0, (now - created_at).days)
    return VmRequest(
        id=r[0],
        origin=r[1],
        destination=r[2],
        vehicle_type=r[3],
        target_rate=target_rate,
        target_cost=(
            round(target_rate / (1 + (float(r[29]) if r[29] is not None else pricing.MARGIN_PCT_STANDARD) / 100), 2)
            if target_rate is not None
            else None
        ),
        current_final_rate=float(r[5]) if r[5] is not None else None,
        requested_by=r[6],
        status=r[7],
        resolved_vendor=r[8],
        resolved_cost=float(r[9]) if r[9] is not None else None,
        created_at=str(created_at),
        aging_days=aging_days,
        submission_row_id=r[11],
        shipper_name=r[12],
        sales_pic=r[13],
        shipper_status=r[14],
        potential_monthly_revenue=float(r[15]) if r[15] is not None else None,
        commodity_type=r[16],
        high_value_fragile=bool(r[17]) if r[17] is not None else None,
        submission_id=r[18],
        submission_created_at=str(r[19]) if r[19] is not None else None,
        add_ons=[AddOn(**a) for a in json.loads(r[20])] if r[20] else [],
        sales_email=r[21],
        min_trip=r[22],
        auto_closed_sla=bool(r[28]),
        **_vm_only_fields(r, lane_counts),
    )


def _vm_only_fields(r, lane_counts: dict | None) -> dict:
    if lane_counts is None:
        return {}
    key = (master_rates.norm(r[1]), master_rates.norm(r[2]), master_rates.norm(r[3]))
    count = lane_counts.get(key, 0)
    ranked = []
    if r[24]:
        ranked = [RankedVendor(**v) for v in json.loads(r[24])]
    return {
        "vendor_count": count,
        "only_one_vendor": count == 1,
        "single_vendor_approved": bool(r[25]),
        "override_reason": r[26],
        "override_by": r[27],
        "winner_basis": r[23],
        "ranked_vendors": ranked,
    }


def _for_viewer(req: VmRequest, role: str | None) -> VmRequest:
    """Strip vendor names, vendor costs and cost-derived figures for anyone who
    may not see vendor data (sales). Keeps the ticket itself fully readable."""
    if permissions.can(role, "seeVendorData"):
        return req
    return req.model_copy(
        update={
            "resolved_vendor": None,
            "resolved_cost": None,
            "target_cost": None,
            "vendor_count": None,
            "winner_basis": None,
            "ranked_vendors": [],
        }
    )


@app.post("/api/vm-requests", response_model=VmRequest, status_code=201)
async def create_vm_request(body: VmRequestIn, request: Request):
    email = await require_role(request, "sales")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        if body.submission_row_id:
            await cur.execute(
                """SELECT s.submitted_at FROM submission_rows sr JOIN submissions s ON sr.submission_id = s.id
                   WHERE sr.id = %s""",
                (body.submission_row_id,),
            )
            owner = await cur.fetchone()
            if owner and owner[0] is None:
                raise HTTPException(400, "Submit this request first")
        await cur.execute(
            """INSERT INTO vm_requests
               (submission_row_id, origin, destination, vehicle_type, target_rate,
                current_final_rate, requested_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (
                body.submission_row_id,
                body.origin,
                body.destination,
                body.vehicle_type,
                body.target_rate,
                body.current_final_rate,
                email,
            ),
        )
        req_id = cur.lastrowid
        await cur.execute(f"{VM_REQUEST_SELECT_FROM} WHERE vr.id = %s", (req_id,))
        row = await cur.fetchone()
    _, role = await current_user(request)
    return _for_viewer(_to_vm_request(row), role)


@app.get("/api/vm/requests", response_model=VmRequestList)
async def list_vm_requests(request: Request, submission_id: int | None = Query(None)):
    """Every lane-level VM request (optionally one ticket's). Every role reads it;
    vendor data only for VM."""
    _, role = await require_permission(request, "viewQueue")
    where, args = ("WHERE sr.submission_id = %s", (submission_id,)) if submission_id else ("", ())
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            f"""{VM_REQUEST_SELECT_FROM}
                {where}
                ORDER BY (vr.status IN ('resolved', 'closed_no_vendor', 'closed_no_lower_rate')),
                         vr.created_at ASC""",
            args,
        )
        rows = await cur.fetchall()
        counts = await _lane_vendor_counts(cur)
    return VmRequestList(requests=[_for_viewer(_to_vm_request(r, counts), role) for r in rows])


VM_STATUSES = ("open", "in_progress", "resolved", "closed_no_vendor", "closed_no_lower_rate")


class VmRequestUpdate(BaseModel):
    status: str | None = None
    resolved_vendor: str | None = None
    resolved_cost: float | None = None


@app.patch("/api/vm/requests/{request_id}", response_model=VmRequest)
async def update_vm_request(request_id: int, body: VmRequestUpdate, request: Request):
    await require_role(request, "vm")
    if body.status is not None and body.status not in VM_STATUSES:
        raise HTTPException(400, "Invalid status")

    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT id FROM vm_requests WHERE id = %s", (request_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Request not found")

        fields, values = [], []
        if body.status is not None:
            fields.append("status = %s")
            values.append(body.status)
        if body.resolved_vendor is not None:
            fields.append("resolved_vendor = %s")
            values.append(body.resolved_vendor)
        if body.resolved_cost is not None:
            fields.append("resolved_cost = %s")
            values.append(body.resolved_cost)
        if fields:
            values.append(request_id)
            await cur.execute(f"UPDATE vm_requests SET {', '.join(fields)} WHERE id = %s", values)

        await cur.execute(f"{VM_REQUEST_SELECT_FROM} WHERE vr.id = %s", (request_id,))
        row = await cur.fetchone()
        counts = await _lane_vendor_counts(cur)
    return _to_vm_request(row, counts)


async def _fetch_vm_request_raw(cur, request_id: int):
    await cur.execute(
        """SELECT origin, destination, vehicle_type, target_rate, submission_row_id, current_final_rate,
                  single_vendor_approved
           FROM vm_requests WHERE id = %s""",
        (request_id,),
    )
    row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Request not found")
    return {
        "origin": row[0],
        "destination": row[1],
        "vehicle_type": row[2],
        "target_rate": float(row[3]) if row[3] is not None else None,
        "submission_row_id": row[4],
        "current_final_rate": float(row[5]) if row[5] is not None else None,
        "single_vendor_approved": bool(row[6]),
    }


async def _store_resolution(cur, request_id: int, row_id: int | None, result) -> None:
    """Persist a priced result on the ticket and on the sales row it came from."""
    basis, ranked_json = _snapshot(result)
    await cur.execute(
        """UPDATE vm_requests SET status = 'resolved', resolved_vendor = %s, resolved_cost = %s,
           current_final_rate = %s WHERE id = %s""",
        (result.matched_vendor, result.matched_cost, result.final_rate, request_id),
    )
    if row_id:
        await cur.execute(
            """UPDATE submission_rows SET final_rate = %s, remarks = %s, matched_vendor = %s,
               matched_cost = %s, matched_basis = %s, matched_ranked = %s, margin_pct = %s WHERE id = %s""",
            (result.final_rate, result.remarks, result.matched_vendor, result.matched_cost, basis, ranked_json,
             result.margin_pct, row_id),
        )


async def _store_ranked_only(cur, row_id: int | None, result) -> None:
    """The lane still can't be priced (fewer than 2 vendors): keep the ticket open,
    just refresh the ranked-vendor snapshot VM sees."""
    if row_id:
        _, ranked_json = _snapshot(result)
        await cur.execute("UPDATE submission_rows SET matched_ranked = %s WHERE id = %s", (ranked_json, row_id))


async def _apply_resolution(request_id: int, vendor_costs: list[tuple[str, float]], resolved_by: str) -> VmRequest:
    pool = db.pool()
    async with pool.acquire() as conn, conn.cursor() as cur:
        req = await _fetch_vm_request_raw(cur, request_id)

    if vendor_costs:
        rows = [
            {
                "origin": req["origin"],
                "destination": req["destination"],
                "vehicle_type": req["vehicle_type"],
                "vendor_name": vendor_name,
                "cost": cost,
            }
            for vendor_name, cost in vendor_costs
        ]
        await master_rates.upsert_rows(pool, rows, resolved_by, None)

    costs = await master_rates.find_costs(pool, req["origin"], req["destination"], req["vehicle_type"])
    result = pricing.compute_final_rate(
        costs, req["target_rate"], allow_single=req["single_vendor_approved"]
    )

    async with pool.acquire() as conn, conn.cursor() as cur:
        if result.final_rate is not None:
            await _store_resolution(cur, request_id, req["submission_row_id"], result)
        else:
            # Still fewer than 2 vendors: the ticket stays open (flagged for VM), now in progress.
            await cur.execute(
                "UPDATE vm_requests SET status = 'in_progress' WHERE id = %s AND status = 'open'", (request_id,)
            )
            await _store_ranked_only(cur, req["submission_row_id"], result)
        await cur.execute(f"{VM_REQUEST_SELECT_FROM} WHERE vr.id = %s", (request_id,))
        row = await cur.fetchone()
        counts = await _lane_vendor_counts(cur)

    await _auto_resolve_matching(pool, {(master_rates.norm(req["origin"]), master_rates.norm(req["destination"]), master_rates.norm(req["vehicle_type"]))}, resolved_by)
    return _to_vm_request(row, counts)


async def _auto_resolve_matching(pool, lane_keys: set[tuple[str, str, str]], resolved_by: str) -> int:
    """Resolve every open/in_progress request whose lane is in lane_keys and now
    has at least 2 vendors in the master data (or 1, if VM approved using the
    single vendor) — used after a master-rate upload (or a per-request
    resolution) so sibling requests for the same OD+vehicle across other sales
    don't need to be filled in one by one."""
    if not lane_keys:
        return 0
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT id, origin, destination, vehicle_type, target_rate, submission_row_id, single_vendor_approved "
            "FROM vm_requests WHERE status IN ('open', 'in_progress')"
        )
        rows = await cur.fetchall()

    resolved = 0
    for r in rows:
        req_id, origin, destination, vehicle_type, target_rate, submission_row_id, approved = r
        key = (master_rates.norm(origin), master_rates.norm(destination), master_rates.norm(vehicle_type))
        if key not in lane_keys:
            continue
        costs = await master_rates.find_costs(pool, origin, destination, vehicle_type)
        if not costs:
            continue
        result = pricing.compute_final_rate(
            costs, float(target_rate) if target_rate is not None else None, allow_single=bool(approved)
        )
        async with pool.acquire() as conn, conn.cursor() as cur:
            if result.final_rate is None:
                await _store_ranked_only(cur, submission_row_id, result)
                continue
            await _store_resolution(cur, req_id, submission_row_id, result)
        resolved += 1
    return resolved


class VendorCostIn(BaseModel):
    vendor_name: str
    cost: float


class VmResolveIn(BaseModel):
    vendor_costs: list[VendorCostIn]


@app.post("/api/vm/requests/{request_id}/resolve", response_model=VmRequest)
async def resolve_vm_request(request_id: int, body: VmResolveIn, request: Request):
    email = await require_role(request, "vm")
    if not body.vendor_costs:
        raise HTTPException(400, "At least one vendor cost is required")
    pairs = [(vc.vendor_name, vc.cost) for vc in body.vendor_costs if vc.vendor_name.strip() and vc.cost > 0]
    if not pairs:
        raise HTTPException(400, "At least one valid vendor cost is required")
    return await _apply_resolution(request_id, pairs, email)


@app.post("/api/vm/requests/{request_id}/resolve-upload", response_model=VmRequest)
async def resolve_vm_request_upload(request_id: int, request: Request, file: UploadFile):
    email = await require_role(request, "vm")
    content = await file.read()
    try:
        parsed = master_rates.parse_csv(content)
    except ValueError as e:
        raise HTTPException(400, str(e))

    async with db.pool().acquire() as conn, conn.cursor() as cur:
        req = await _fetch_vm_request_raw(cur, request_id)

    matching = [
        (r["vendor_name"], r["cost"])
        for r in parsed
        if master_rates.norm(r["origin"]) == master_rates.norm(req["origin"])
        and master_rates.norm(r["destination"]) == master_rates.norm(req["destination"])
        and master_rates.norm(r["vehicle_type"]) == master_rates.norm(req["vehicle_type"])
    ]
    if not matching:
        raise HTTPException(
            400,
            f"CSV has no row matching this request's lane ({req['origin']} → {req['destination']}, {req['vehicle_type']})",
        )
    return await _apply_resolution(request_id, matching, email)


SINGLE_VENDOR_REASONS = ("No other vendor serves this lane", "Dedicated/contract rate")


class SingleVendorIn(BaseModel):
    reason: str


@app.post("/api/vm/requests/{request_id}/use-single-vendor", response_model=VmRequest)
async def use_single_vendor(request_id: int, body: SingleVendorIn, request: Request):
    """VM approves pricing a lane from its one and only vendor. Approval applies
    to this ticket only (not the lane in general): sales then sees the rate with
    a neutral "Confirmed by VM" remark, and the Discussion gets an automatic note."""
    email = await require_role(request, "vm")
    reason = body.reason.strip()
    if not reason or not (reason in SINGLE_VENDOR_REASONS or reason.startswith("Other")):
        raise HTTPException(400, "A reason is required")
    pool = db.pool()
    async with pool.acquire() as conn, conn.cursor() as cur:
        req = await _fetch_vm_request_raw(cur, request_id)
        await cur.execute("SELECT status FROM vm_requests WHERE id = %s", (request_id,))
        if (await cur.fetchone())[0] not in ("open", "in_progress"):
            raise HTTPException(400, "This ticket is already closed")

    costs = await master_rates.find_costs(pool, req["origin"], req["destination"], req["vehicle_type"])
    if len(costs) != 1:
        raise HTTPException(400, "This lane does not have exactly one vendor")
    result = pricing.compute_final_rate(costs, req["target_rate"], allow_single=True)

    async with pool.acquire() as conn, conn.cursor() as cur:
        await _store_resolution(cur, request_id, req["submission_row_id"], result)
        await cur.execute(
            """UPDATE vm_requests SET single_vendor_approved = 1, override_reason = %s, override_by = %s
               WHERE id = %s""",
            (reason[:255], email, request_id),
        )
        if req["submission_row_id"]:
            await cur.execute("SELECT submission_id FROM submission_rows WHERE id = %s", (req["submission_row_id"],))
            srow = await cur.fetchone()
            if srow:
                await _system_comment(
                    cur,
                    srow[0],
                    f"{email} approved using the single vendor for {req['origin']} → {req['destination']} "
                    f"({req['vehicle_type']}): {result.matched_vendor} at {_idr(result.matched_cost)}. "
                    f"Reason: {reason}.",
                )
        await cur.execute(f"{VM_REQUEST_SELECT_FROM} WHERE vr.id = %s", (request_id,))
        row = await cur.fetchone()
        counts = await _lane_vendor_counts(cur)
    return _to_vm_request(row, counts)


@app.post("/api/vm/requests/{request_id}/close-no-vendor", response_model=VmRequest)
async def close_vm_request_no_vendor(request_id: int, request: Request):
    """VM declines to find a vendor for this lane. Two distinct cases:
      - The lane never had a rate (a "missing lane" request): close as
        closed_no_vendor and wipe the row's Final Rate — there is genuinely
        no price to show.
      - The lane already had a Final Rate and sales was asking VM for a
        LOWER one (current_final_rate was set when this ticket was raised):
        close as closed_no_lower_rate, and leave the existing Final Rate
        on the submission row untouched — sales still has a usable rate,
        it just didn't get any cheaper."""
    await require_role(request, "vm")
    pool = db.pool()
    async with pool.acquire() as conn, conn.cursor() as cur:
        req = await _fetch_vm_request_raw(cur, request_id)
        had_rate = req["current_final_rate"] is not None
        new_status = "closed_no_lower_rate" if had_rate else "closed_no_vendor"

        if had_rate:
            await cur.execute(
                "UPDATE vm_requests SET status = %s, resolved_vendor = NULL, resolved_cost = NULL WHERE id = %s",
                (new_status, request_id),
            )
        else:
            await cur.execute(
                """UPDATE vm_requests SET status = %s, resolved_vendor = NULL,
                   resolved_cost = NULL, current_final_rate = NULL WHERE id = %s""",
                (new_status, request_id),
            )
            if req["submission_row_id"]:
                await cur.execute(
                    """UPDATE submission_rows SET final_rate = NULL, remarks = %s, matched_vendor = NULL,
                       matched_cost = NULL WHERE id = %s""",
                    ("No vendor available (VM)", req["submission_row_id"]),
                )

        await cur.execute(f"{VM_REQUEST_SELECT_FROM} WHERE vr.id = %s", (request_id,))
        row = await cur.fetchone()
        counts = await _lane_vendor_counts(cur)
    return _to_vm_request(row, counts)


class ResolveReadyResult(BaseModel):
    checked_count: int
    resolved_count: int


UNKNOWN_SHIPPER_KEY = "__unknown__"


@app.post("/api/vm/requests/resolve-ready", response_model=ResolveReadyResult)
async def resolve_requests_ready(request: Request, shipper_name: str | None = Query(None)):
    """VM: recompute and resolve every open/in_progress request (optionally scoped
    to one shipper, or the ad-hoc/unknown-shipper bucket) that already has master
    vendor-rate data for its lane — for bulk-clearing a shipper's tickets after
    the master rates were uploaded, instead of resolving one by one."""
    email = await require_role(request, "vm")
    pool = db.pool()
    async with pool.acquire() as conn, conn.cursor() as cur:
        if shipper_name == UNKNOWN_SHIPPER_KEY:
            await cur.execute(
                f"{VM_REQUEST_SELECT_FROM} WHERE vr.status IN ('open', 'in_progress') AND s.shipper_name IS NULL"
            )
        elif shipper_name:
            await cur.execute(
                f"{VM_REQUEST_SELECT_FROM} WHERE vr.status IN ('open', 'in_progress') AND s.shipper_name = %s",
                (shipper_name,),
            )
        else:
            await cur.execute(f"{VM_REQUEST_SELECT_FROM} WHERE vr.status IN ('open', 'in_progress')")
        rows = await cur.fetchall()

    lane_keys = {(master_rates.norm(r[1]), master_rates.norm(r[2]), master_rates.norm(r[3])) for r in rows}
    resolved_count = await _auto_resolve_matching(pool, lane_keys, email)
    return ResolveReadyResult(checked_count=len(rows), resolved_count=resolved_count)


@app.get("/api/vm/summary", response_model=VmSummary)
async def vm_summary(request: Request, limit: int = Query(10, ge=1, le=1000)):
    await require_permission(request, "viewQueue")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """SELECT origin, destination, vehicle_type, COUNT(*) c, AVG(target_rate) avg_target
               FROM vm_requests
               WHERE status IN ('open', 'in_progress', 'closed_no_lower_rate') AND current_final_rate IS NOT NULL
               GROUP BY origin, destination, vehicle_type
               ORDER BY c DESC LIMIT %s""",
            (limit,),
        )
        seeking = await cur.fetchall()

        await cur.execute(
            """SELECT origin, destination, vehicle_type, COUNT(*) c
               FROM vm_requests
               WHERE status = 'closed_no_vendor'
               GROUP BY origin, destination, vehicle_type
               ORDER BY c DESC LIMIT %s""",
            (limit,),
        )
        missing = await cur.fetchall()

    to_seeking_lane = lambda r: LaneSummary(
        origin=r[0], destination=r[1], vehicle_type=r[2], request_count=r[3],
        avg_target_rate=round(float(r[4]), 2) if r[4] is not None else None,
    )
    to_lane = lambda r: LaneSummary(origin=r[0], destination=r[1], vehicle_type=r[2], request_count=r[3])
    return VmSummary(
        seeking_lower_rate=[to_seeking_lane(r) for r in seeking],
        missing_lanes=[to_lane(r) for r in missing],
    )


# ---------------------------------------------------------------------------
# Master vendor-rate data — VM uploads a CSV (Origin L2 | Destinasi L2 |
# Vehicle Type | Cost/Rate | Vendor Name); rows are upserted, never wiped.
# ---------------------------------------------------------------------------


class MasterRateUploadResult(BaseModel):
    row_count: int
    resolved_count: int


class MasterRateMeta(BaseModel):
    uploaded_by: str | None
    filename: str | None
    row_count: int | None
    created_at: str | None


class VendorRate(BaseModel):
    origin: str
    destination: str
    vehicle_type: str
    vendor_name: str
    cost: float
    updated_by: str | None
    updated_at: str


class VendorRateList(BaseModel):
    rates: list[VendorRate]


@app.post("/api/master-rates/upload", response_model=MasterRateUploadResult, status_code=201)
async def upload_master_rates(request: Request, file: UploadFile):
    email = await require_role(request, "vm")
    content = await file.read()
    try:
        rows = master_rates.parse_csv(content)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not rows:
        raise HTTPException(400, "No usable rows found in CSV")
    pool = db.pool()
    row_count = await master_rates.upsert_rows(pool, rows, email, file.filename)

    touched_lanes = {(master_rates.norm(r["origin"]), master_rates.norm(r["destination"]), master_rates.norm(r["vehicle_type"])) for r in rows}
    resolved_count = await _auto_resolve_matching(pool, touched_lanes, email)

    return MasterRateUploadResult(row_count=row_count, resolved_count=resolved_count)


@app.get("/api/master-rates/meta", response_model=MasterRateMeta)
async def master_rates_meta(request: Request):
    await require_role(request, "vm")
    meta = await master_rates.last_upload_meta(db.pool())
    if not meta:
        return MasterRateMeta(uploaded_by=None, filename=None, row_count=None, created_at=None)
    return MasterRateMeta(**meta)


@app.get("/api/master-rates", response_model=VendorRateList)
async def get_master_rates(request: Request):
    await require_role(request, "vm")
    rows = await master_rates.list_all(db.pool())
    return VendorRateList(rates=[VendorRate(**r) for r in rows])


class VendorNameList(BaseModel):
    vendors: list[str]


@app.get("/api/master-rates/vendors", response_model=VendorNameList)
async def master_rate_vendors(request: Request):
    await require_role(request, "vm")
    return VendorNameList(vendors=await master_rates.list_vendor_names(db.pool()))


@app.get("/api/master-rates/export")
async def export_master_rates(request: Request):
    await require_role(request, "vm")
    rows = await master_rates.list_all(db.pool())
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Origin L2", "Destinasi L2", "Vehicle Type", "Cost/Rate", "Vendor Name"])
    for r in rows:
        writer.writerow([r["origin"], r["destination"], r["vehicle_type"], r["cost"], r["vendor_name"]])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=master_vendor_rates.csv"},
    )


# ---------------------------------------------------------------------------
# Sales: tickets (VM requests) for a submission, and the quotation download
# ---------------------------------------------------------------------------


@app.get("/api/submissions/{submission_id}/tickets", response_model=VmRequestList)
async def submission_tickets(submission_id: int, request: Request):
    email = await require_role(request, "sales")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT id FROM submissions WHERE id = %s AND uploaded_by = %s", (submission_id, email))
        if not await cur.fetchone():
            raise HTTPException(404, "Submission not found")

        await cur.execute(
            f"""{VM_REQUEST_SELECT_FROM}
                WHERE sr.submission_id = %s
                ORDER BY vr.created_at ASC""",
            (submission_id,),
        )
        rows = await cur.fetchall()
    _, role = await current_user(request)
    return VmRequestList(requests=[_for_viewer(_to_vm_request(r), role) for r in rows])


@app.get("/api/tickets", response_model=VmRequestList)
async def my_tickets(request: Request):
    """Sales: every VM request this user has raised, across all their
    submissions — the basis for the global Active/Completed Request views."""
    email = await require_role(request, "sales")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            f"{VM_REQUEST_SELECT_FROM} WHERE vr.requested_by = %s ORDER BY vr.created_at DESC",
            (email,),
        )
        rows = await cur.fetchall()
    _, role = await current_user(request)
    return VmRequestList(requests=[_for_viewer(_to_vm_request(r), role) for r in rows])


class LaneItem(BaseModel):
    id: int
    submission_id: int
    submitted_at: str
    shipper_name: str | None
    sales_pic: str | None
    origin: str
    destination: str
    vehicle_type: str
    target_rate: float | None
    final_rate: float | None
    remarks: str
    matched_vendor: str | None
    vm_status: str | None
    vm_request_id: int | None
    aging_days: int | None
    add_ons: list[AddOn] = []
    sales_email: str | None = None
    min_trip: int | None = None
    auto_closed_sla: bool = False


class LaneList(BaseModel):
    lanes: list[LaneItem]


@app.get("/api/lanes", response_model=LaneList)
async def my_lanes(request: Request):
    """Sales: every lane from every one of this user's submissions — not just
    the ones raised to VM. A lane is "active" while it has a currently
    open/in_progress VM request; otherwise, if it has a Final Rate or an
    explicit "no vendor" outcome, it's "completed" (whether that came from
    the initial check or from VM resolving it) — the basis for the global
    Active/Completed Request views, which cover ALL requested OD lanes."""
    email = await require_role(request, "sales")
    _, role = await current_user(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """SELECT sr.id, sr.submission_id, s.shipper_name, s.sales_pic, sr.origin, sr.destination,
                      sr.vehicle_type, sr.target_rate, sr.final_rate, sr.remarks, sr.matched_vendor,
                      vr.status, vr.id, vr.created_at, s.created_at, s.add_ons,
                      s.sales_email, sr.min_trip,
                      (SELECT MAX(auto_closed_sla) FROM vm_requests WHERE submission_row_id = sr.id)
               FROM submission_rows sr
               JOIN submissions s ON sr.submission_id = s.id
               LEFT JOIN vm_requests vr ON vr.id = (
                   SELECT id FROM vm_requests
                   WHERE submission_row_id = sr.id AND status IN ('open', 'in_progress')
                   ORDER BY id DESC LIMIT 1
               )
               WHERE s.uploaded_by = %s AND s.submitted_at IS NOT NULL
               ORDER BY s.id DESC, sr.id ASC""",
            (email,),
        )
        rows = await cur.fetchall()

    lanes = []
    for r in rows:
        vm_created = r[13]
        aging = None
        if vm_created is not None:
            now = datetime.now(vm_created.tzinfo) if vm_created.tzinfo else datetime.now()
            aging = max(0, (now - vm_created).days)
        lanes.append(
            LaneItem(
                id=r[0],
                submission_id=r[1],
                submitted_at=str(r[14]),
                shipper_name=r[2],
                sales_pic=r[3],
                origin=r[4],
                destination=r[5],
                vehicle_type=r[6],
                target_rate=float(r[7]) if r[7] is not None else None,
                final_rate=float(r[8]) if r[8] is not None else None,
                remarks=r[9] or "",
                matched_vendor=r[10] if permissions.can(role, "seeVendorData") else None,
                vm_status=r[11],
                vm_request_id=r[12],
                aging_days=aging,
                add_ons=[AddOn(**a) for a in json.loads(r[15])] if r[15] else [],
                sales_email=r[16],
                min_trip=r[17],
                auto_closed_sla=bool(r[18]),
            )
        )
    return LaneList(lanes=lanes)


@app.get("/api/submissions/{submission_id}/quotation.xlsx")
async def submission_quotation(submission_id: int, request: Request):
    email = await require_role(request, "sales")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            f"SELECT {SUBMISSION_COLUMNS} FROM submissions WHERE id = %s AND uploaded_by = %s",
            (submission_id, email),
        )
        srow = await cur.fetchone()
        if not srow:
            raise HTTPException(404, "Submission not found")

        await cur.execute(
            """SELECT origin, destination, vehicle_type, final_rate, remarks, min_trip
               FROM submission_rows WHERE submission_id = %s AND final_rate IS NOT NULL
               ORDER BY id""",
            (submission_id,),
        )
        rows = await cur.fetchall()
        services = await _service_items(cur, [submission_id])

    submission = _row_to_submission(srow)

    wb = Workbook()
    ws = wb.active
    ws.title = "Quotation"
    ws.append(["FTL Rate Quotation"])
    ws.append(["Shipper Name", submission.shipper_name or ""])
    ws.append(["Sales PIC", submission.sales_pic or ""])
    ws.append(["Date", submission.created_at])
    ws.append([])
    ws.append(
        [
            "Origin", "Destination", "Vehicle Type", "Final Rate (IDR)", "Remarks", "Min Trip / month",
        ]
    )
    for r in rows:
        ws.append([r[0], r[1], r[2], float(r[3]), r[4] or "", r[5]])

    items = services.get(submission_id, [])
    if items:
        ws.append([])
        ws.append(["Additional Services", "Price (IDR)", "Unit", "Notes"])
        for it in items:
            if it.unavailable:
                price = "Tidak tersedia"
            elif it.unit_price is not None:
                price = it.unit_price
            else:
                price = "Menunggu VM"
            ws.append([it.label, price, it.unit, it.note or ""])
    else:
        legacy = [a for a in submission.add_ons if not a.service]
        if legacy:  # submissions from before services were priced by VM
            ws.append([])
            ws.append(["Additional Services"])
            for a in legacy:
                ws.append([a.label, a.value or ""])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=quotation_submission_{submission_id}.xlsx"},
    )


# ---------------------------------------------------------------------------
# Discussion thread on a VM request — sticks to the ticket across
# open -> resolved/closed, visible to both sales and VM.
# ---------------------------------------------------------------------------


class CommentIn(BaseModel):
    message: str


class Comment(BaseModel):
    id: int
    vm_request_id: int
    author_email: str
    message: str
    created_at: str


class CommentList(BaseModel):
    comments: list[Comment]


@app.get("/api/vm-requests/{request_id}/comments", response_model=CommentList)
async def list_comments(request_id: int, request: Request):
    await require_any_role(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT id FROM vm_requests WHERE id = %s", (request_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Request not found")
        await cur.execute(
            "SELECT id, vm_request_id, author_email, message, created_at FROM vm_request_comments "
            "WHERE vm_request_id = %s ORDER BY created_at ASC",
            (request_id,),
        )
        rows = await cur.fetchall()
    return CommentList(
        comments=[
            Comment(id=r[0], vm_request_id=r[1], author_email=r[2], message=r[3], created_at=str(r[4]))
            for r in rows
        ]
    )


@app.post("/api/vm-requests/{request_id}/comments", response_model=Comment, status_code=201)
async def create_comment(request_id: int, body: CommentIn, request: Request):
    email = await require_any_role(request)
    if not body.message.strip():
        raise HTTPException(400, "message is required")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT id FROM vm_requests WHERE id = %s", (request_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Request not found")
        await cur.execute(
            "INSERT INTO vm_request_comments (vm_request_id, author_email, message) VALUES (%s, %s, %s)",
            (request_id, email, body.message.strip()),
        )
        comment_id = cur.lastrowid
        await cur.execute(
            "SELECT id, vm_request_id, author_email, message, created_at FROM vm_request_comments WHERE id = %s",
            (comment_id,),
        )
        row = await cur.fetchone()
    return Comment(id=row[0], vm_request_id=row[1], author_email=row[2], message=row[3], created_at=str(row[4]))


# ---------------------------------------------------------------------------
# Discussion thread on a SHIPPER (submission) — shared across every VM
# request raised from that submission's rows, so it survives the OD lane
# moving from active to completed.
# ---------------------------------------------------------------------------


class SubmissionCommentIn(BaseModel):
    message: str


class SubmissionComment(BaseModel):
    id: int
    submission_id: int
    author_email: str
    message: str
    created_at: str


class SubmissionCommentList(BaseModel):
    comments: list[SubmissionComment]


@app.get("/api/submissions/{submission_id}/comments", response_model=SubmissionCommentList)
async def list_submission_comments(submission_id: int, request: Request):
    await require_any_role(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT id FROM submissions WHERE id = %s", (submission_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Submission not found")
        await cur.execute(
            "SELECT id, submission_id, author_email, message, created_at FROM submission_comments "
            "WHERE submission_id = %s ORDER BY created_at ASC",
            (submission_id,),
        )
        rows = await cur.fetchall()
    return SubmissionCommentList(
        comments=[
            SubmissionComment(id=r[0], submission_id=r[1], author_email=r[2], message=r[3], created_at=str(r[4]))
            for r in rows
        ]
    )


MENTION_RE = re.compile(r"@(\w[\w.]*)")


async def _notify_mentions(cur, submission_id: int, author_email: str, message: str) -> None:
    """Find @mentions in a discussion message (matched by prefix against the
    provisioned users' email local-part, e.g. "@adila" matches
    "adila.kestibawani@ninjavan.co") and create a notification for each
    mentioned user, excluding the author."""
    tokens = {m.group(1).lower() for m in MENTION_RE.finditer(message)}
    if not tokens:
        return
    await cur.execute("SELECT email FROM user_roles")
    all_emails = [r[0] for r in await cur.fetchall()]
    notified = set()
    for email in all_emails:
        if email == author_email:
            continue
        local = email.split("@")[0].lower()
        if any(local.startswith(t) or t.startswith(local) for t in tokens):
            notified.add(email)
    snippet = message if len(message) <= 200 else message[:197] + "..."
    for recipient in notified:
        await cur.execute(
            "INSERT INTO notifications (recipient_email, submission_id, message) VALUES (%s, %s, %s)",
            (recipient, submission_id, f"{author_email} mentioned you: {snippet}"),
        )


@app.post("/api/submissions/{submission_id}/comments", response_model=SubmissionComment, status_code=201)
async def create_submission_comment(submission_id: int, body: SubmissionCommentIn, request: Request):
    email = await require_any_role(request)
    if not body.message.strip():
        raise HTTPException(400, "message is required")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT id FROM submissions WHERE id = %s", (submission_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Submission not found")
        message = body.message.strip()
        await cur.execute(
            "INSERT INTO submission_comments (submission_id, author_email, message) VALUES (%s, %s, %s)",
            (submission_id, email, message),
        )
        comment_id = cur.lastrowid
        await _notify_mentions(cur, submission_id, email, message)
        await cur.execute(
            "SELECT id, submission_id, author_email, message, created_at FROM submission_comments WHERE id = %s",
            (comment_id,),
        )
        row = await cur.fetchone()
    return SubmissionComment(
        id=row[0], submission_id=row[1], author_email=row[2], message=row[3], created_at=str(row[4])
    )


# ---------------------------------------------------------------------------
# Additional-service requests: sales ask VM the unit price of Overnight / TKBM /
# Additional Drop Point for a shipper. One request per submitted submission; done
# once every service has a price or is marked unavailable.
# ---------------------------------------------------------------------------


class ServiceItem(BaseModel):
    id: int
    service: str
    label: str
    unit: str
    note: str | None = None
    unit_price: float | None = None
    unavailable: bool = False
    auto_closed_sla: bool = False
    answered_by: str | None = None
    answered_at: str | None = None


class ServiceLane(BaseModel):
    origin: str
    destination: str
    vehicle_type: str
    vendor: str | None = None


class ServiceRequest(BaseModel):
    submission_id: int
    shipper_name: str | None = None
    sales_pic: str | None = None
    sales_email: str | None = None
    requested_by: str
    created_at: str
    aging_days: int
    status: str  # "open" | "done"
    items: list[ServiceItem]
    # VM only: the winning vendor of each of the shipper's priced lanes.
    lanes: list[ServiceLane] = []


class ServiceRequestList(BaseModel):
    requests: list[ServiceRequest]


class ServiceAnswer(BaseModel):
    id: int
    unit_price: float | None = None
    unavailable: bool = False


class ServiceAnswerIn(BaseModel):
    items: list[ServiceAnswer]


def _service_item(r) -> ServiceItem:
    label, unit = SERVICES.get(r[2], (r[2], ""))
    return ServiceItem(
        id=r[0],
        service=r[2],
        label=label,
        unit=unit,
        note=r[3],
        unit_price=float(r[4]) if r[4] is not None else None,
        unavailable=bool(r[5]),
        auto_closed_sla=bool(r[6]),
        answered_by=r[7],
        answered_at=str(r[8]) if r[8] else None,
    )


async def _service_items(cur, submission_ids: list[int]) -> dict[int, list[ServiceItem]]:
    if not submission_ids:
        return {}
    marks = ", ".join(["%s"] * len(submission_ids))
    await cur.execute(
        f"""SELECT id, submission_id, service, note, unit_price, unavailable, auto_closed_sla,
                   answered_by, answered_at
            FROM service_requests WHERE submission_id IN ({marks}) ORDER BY id""",
        tuple(submission_ids),
    )
    out: dict[int, list[ServiceItem]] = {}
    for r in await cur.fetchall():
        out.setdefault(r[1], []).append(_service_item(r))
    return out


def _item_done(it: ServiceItem) -> bool:
    return it.unavailable or it.unit_price is not None


async def _list_service_requests(cur, sales_email: str | None, with_lanes: bool) -> list[ServiceRequest]:
    where = "WHERE s.uploaded_by = %s" if sales_email else ""
    await cur.execute(
        f"""SELECT s.id, s.shipper_name, s.sales_pic, s.sales_email, s.uploaded_by, MIN(q.created_at)
            FROM service_requests q JOIN submissions s ON q.submission_id = s.id
            {where}
            GROUP BY s.id, s.shipper_name, s.sales_pic, s.sales_email, s.uploaded_by
            ORDER BY s.id DESC""",
        (sales_email,) if sales_email else (),
    )
    heads = await cur.fetchall()
    items = await _service_items(cur, [h[0] for h in heads])

    lanes_by_shipper: dict[str, list[ServiceLane]] = {}
    if with_lanes:
        names = list({h[1] for h in heads if h[1]})
        if names:
            marks = ", ".join(["%s"] * len(names))
            await cur.execute(
                f"""SELECT s.shipper_name, sr.origin, sr.destination, sr.vehicle_type, sr.matched_vendor
                    FROM submission_rows sr JOIN submissions s ON sr.submission_id = s.id
                    WHERE s.shipper_name IN ({marks}) AND s.submitted_at IS NOT NULL
                          AND sr.final_rate IS NOT NULL
                    ORDER BY s.id ASC, sr.id ASC""",
                tuple(names),
            )
            latest: dict[str, dict] = {}
            for name, o, d, v, vendor in await cur.fetchall():
                latest.setdefault(name, {})[_lane_key(o, d, v)] = ServiceLane(
                    origin=o, destination=d, vehicle_type=v, vendor=vendor
                )
            lanes_by_shipper = {n: list(m.values()) for n, m in latest.items()}

    out = []
    for sid, shipper, sales_pic, s_email, uploaded_by, created in heads:
        its = items.get(sid, [])
        now = datetime.now(created.tzinfo) if created.tzinfo else datetime.now()
        out.append(
            ServiceRequest(
                submission_id=sid,
                shipper_name=shipper,
                sales_pic=sales_pic,
                sales_email=s_email,
                requested_by=uploaded_by,
                created_at=str(created),
                aging_days=max(0, (now - created).days),
                status="done" if its and all(_item_done(i) for i in its) else "open",
                items=its,
                lanes=lanes_by_shipper.get(shipper, []) if with_lanes else [],
            )
        )
    return out


@app.get("/api/service-requests", response_model=ServiceRequestList)
async def my_service_requests(request: Request):
    """Sales: this user's additional-service requests and VM's answers."""
    email = await require_role(request, "sales")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        reqs = await _list_service_requests(cur, email, with_lanes=False)
    return ServiceRequestList(requests=reqs)


@app.get("/api/vm/service-requests", response_model=ServiceRequestList)
async def vm_service_requests(request: Request):
    """All additional-service requests. Every role reads them; the lanes' vendor
    names only reach viewers who may see vendor data."""
    _, role = await require_permission(request, "viewQueue")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        reqs = await _list_service_requests(cur, None, with_lanes=True)
    if not permissions.can(role, "seeVendorData"):
        reqs = [
            r.model_copy(update={"lanes": [l.model_copy(update={"vendor": None}) for l in r.lanes]})
            for r in reqs
        ]
    return ServiceRequestList(requests=reqs)


@app.put("/api/vm/service-requests/{submission_id}", response_model=ServiceRequest)
async def answer_service_request(submission_id: int, body: ServiceAnswerIn, request: Request):
    """VM: give a unit price, or mark unavailable, for some or all of the services.
    Items left without either stay open."""
    email = await require_role(request, "vm")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT id FROM service_requests WHERE submission_id = %s", (submission_id,))
        ids = {r[0] for r in await cur.fetchall()}
        if not ids:
            raise HTTPException(404, "Service request not found")
        for a in body.items:
            if a.id not in ids:
                raise HTTPException(400, "Unknown service in the request")
            if a.unit_price is not None and a.unit_price < 0:
                raise HTTPException(400, "Price can't be negative")
            answered = a.unavailable or a.unit_price is not None
            await cur.execute(
                """UPDATE service_requests SET unit_price = %s, unavailable = %s, auto_closed_sla = 0,
                   answered_by = %s, answered_at = IF(%s, NOW(), NULL) WHERE id = %s""",
                (
                    None if a.unavailable else a.unit_price,
                    1 if a.unavailable else 0,
                    email if answered else None,
                    1 if answered else 0,
                    a.id,
                ),
            )
        reqs = await _list_service_requests(cur, None, with_lanes=True)
    return next(r for r in reqs if r.submission_id == submission_id)


# ---------------------------------------------------------------------------
# Quick check: sales look up a lane's price without creating a submission.
# ---------------------------------------------------------------------------


class QuickWinner(BaseModel):
    rank: int
    price: float


class QuickCheckResult(BaseModel):
    origin: str
    destination: str
    vehicle_type: str
    vendor_count: int
    available: bool
    final_rate: float | None = None
    winners: list[QuickWinner] = []


@app.get("/api/quick-check", response_model=QuickCheckResult)
async def quick_check(
    request: Request,
    origin: str = Query(...),
    destination: str = Query(...),
    vehicle_type: str = Query(...),
):
    """Selling price (cost x standard markup) of the 3 cheapest vendors on a lane,
    with the 2nd one as the Final Rate — same rule as a submission without a target.
    Fewer than 2 vendors: not available here (sales raise a request instead).
    Vendor names and costs are never returned."""
    await require_role(request, "sales")
    costs = await master_rates.find_costs(db.pool(), origin, destination, vehicle_type)
    result = pricing.compute_final_rate(costs, None)
    available = result.final_rate is not None
    return QuickCheckResult(
        origin=origin,
        destination=destination,
        vehicle_type=vehicle_type,
        vendor_count=len(costs),
        available=available,
        final_rate=result.final_rate,
        winners=[
            QuickWinner(rank=i + 1, price=round(cost * pricing.MARGIN_STANDARD, 2))
            for i, (_, cost) in enumerate(result.ranked[:3])
        ]
        if available
        else [],
    )


# ---------------------------------------------------------------------------
# SLA: tickets VM never touched are auto-closed after 7 days, per lane.
# No sales notification — the outcome shows on the lane and in the Discussion.
# ---------------------------------------------------------------------------

SLA_DAYS = 7
SLA_SWEEP_INTERVAL_SECONDS = 3600
SLA_REMARK = "No vendor available (auto closed by SLA)"


async def run_sla_sweep() -> int:
    """Close every still-untouched (status 'open') ticket older than SLA_DAYS.
    Lanes that already had a Final Rate keep it (closed_no_lower_rate); lanes
    that never had one close as closed_no_vendor. Each ticket is claimed with a
    conditional UPDATE, so concurrent replicas can't double-close or double-note."""
    closed_by_submission: dict[int, list[str]] = {}
    count = 0
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            f"""SELECT vr.id, vr.submission_row_id, vr.current_final_rate, vr.origin, vr.destination,
                       vr.vehicle_type, sr.submission_id
                FROM vm_requests vr
                LEFT JOIN submission_rows sr ON vr.submission_row_id = sr.id
                WHERE vr.status = 'open' AND vr.created_at <= NOW() - INTERVAL {SLA_DAYS} DAY"""
        )
        due = await cur.fetchall()
        for req_id, row_id, current_rate, origin, destination, vehicle, submission_id in due:
            had_rate = current_rate is not None
            new_status = "closed_no_lower_rate" if had_rate else "closed_no_vendor"
            await cur.execute(
                """UPDATE vm_requests SET status = %s, auto_closed_sla = 1, resolved_vendor = NULL,
                   resolved_cost = NULL, current_final_rate = IF(%s, current_final_rate, NULL)
                   WHERE id = %s AND status = 'open'""",
                (new_status, 1 if had_rate else 0, req_id),
            )
            if cur.rowcount == 0:
                continue
            count += 1
            if not had_rate and row_id:
                await cur.execute(
                    """UPDATE submission_rows SET final_rate = NULL, remarks = %s, matched_vendor = NULL,
                       matched_cost = NULL WHERE id = %s""",
                    (SLA_REMARK, row_id),
                )
            if submission_id:
                outcome = "kept existing rate" if had_rate else "no vendor available"
                closed_by_submission.setdefault(submission_id, []).append(
                    f"{origin} → {destination} ({vehicle}): {outcome}"
                )
        await cur.execute(
            f"""SELECT id, submission_id, service FROM service_requests
                WHERE unavailable = 0 AND unit_price IS NULL
                      AND created_at <= NOW() - INTERVAL {SLA_DAYS} DAY"""
        )
        for item_id, submission_id, service in await cur.fetchall():
            await cur.execute(
                """UPDATE service_requests SET unavailable = 1, auto_closed_sla = 1, answered_at = NOW()
                   WHERE id = %s AND unavailable = 0 AND unit_price IS NULL""",
                (item_id,),
            )
            if cur.rowcount == 0:
                continue
            count += 1
            closed_by_submission.setdefault(submission_id, []).append(
                f"{SERVICES.get(service, (service,))[0]}: not available"
            )
        for submission_id, lines in closed_by_submission.items():
            await _system_comment(
                cur,
                submission_id,
                f"Auto-closed by SLA after {SLA_DAYS} days with no VM action — "
                + "; ".join(lines),
            )
    return count


async def _sla_sweep_loop() -> None:
    while True:
        try:
            await run_sla_sweep()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # keep the loop alive; the next tick retries
            print(f"SLA sweep failed: {exc!r}", flush=True)
        await asyncio.sleep(SLA_SWEEP_INTERVAL_SECONDS)


# ---------------------------------------------------------------------------
# Users (for @mention lookup), notifications, and per-user "seen" tracking
# ---------------------------------------------------------------------------


class DirectoryUser(BaseModel):
    email: str
    role: str
    display_name: str | None = None


class DirectoryUserList(BaseModel):
    users: list[DirectoryUser]


@app.get("/api/users", response_model=DirectoryUserList)
async def list_directory_users(request: Request):
    """Any provisioned user: the full roster, for @mention autocomplete."""
    await require_any_role(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT email, role, display_name FROM user_roles ORDER BY email")
        rows = await cur.fetchall()
    return DirectoryUserList(
        users=[DirectoryUser(email=r[0], role=r[1], display_name=r[2]) for r in rows]
    )


class NotificationItem(BaseModel):
    id: int
    submission_id: int
    shipper_name: str | None
    message: str
    created_at: str
    read_at: str | None


class NotificationList(BaseModel):
    notifications: list[NotificationItem]
    unread_count: int


@app.get("/api/notifications", response_model=NotificationList)
async def list_notifications(request: Request):
    email = await require_any_role(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """SELECT n.id, n.submission_id, s.shipper_name, n.message, n.created_at, n.read_at
               FROM notifications n
               LEFT JOIN submissions s ON n.submission_id = s.id
               WHERE n.recipient_email = %s
               ORDER BY n.created_at DESC LIMIT 50""",
            (email,),
        )
        rows = await cur.fetchall()
        await cur.execute(
            "SELECT COUNT(*) FROM notifications WHERE recipient_email = %s AND read_at IS NULL", (email,)
        )
        unread = (await cur.fetchone())[0]
    return NotificationList(
        notifications=[
            NotificationItem(
                id=r[0], submission_id=r[1], shipper_name=r[2], message=r[3], created_at=str(r[4]),
                read_at=str(r[5]) if r[5] is not None else None,
            )
            for r in rows
        ],
        unread_count=unread,
    )


@app.post("/api/notifications/{notification_id}/read", status_code=204)
async def mark_notification_read(notification_id: int, request: Request):
    email = await require_any_role(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "UPDATE notifications SET read_at = NOW() WHERE id = %s AND recipient_email = %s",
            (notification_id, email),
        )


@app.post("/api/notifications/read-all", status_code=204)
async def mark_all_notifications_read(request: Request):
    email = await require_any_role(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "UPDATE notifications SET read_at = NOW() WHERE recipient_email = %s AND read_at IS NULL", (email,)
        )


class TicketViewItem(BaseModel):
    submission_id: int
    last_viewed_at: str


class TicketViewList(BaseModel):
    views: list[TicketViewItem]


@app.get("/api/ticket-views", response_model=TicketViewList)
async def list_ticket_views(request: Request):
    email = await require_any_role(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT submission_id, last_viewed_at FROM ticket_views WHERE viewer_email = %s", (email,))
        rows = await cur.fetchall()
    return TicketViewList(views=[TicketViewItem(submission_id=r[0], last_viewed_at=str(r[1])) for r in rows])


@app.post("/api/submissions/{submission_id}/view", status_code=204)
async def mark_submission_viewed(submission_id: int, request: Request):
    email = await require_any_role(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """INSERT INTO ticket_views (viewer_email, submission_id, last_viewed_at) VALUES (%s, %s, NOW())
               ON DUPLICATE KEY UPDATE last_viewed_at = NOW()""",
            (email, submission_id),
        )


# ---------------------------------------------------------------------------
# Profitability: sales pick which shippers go live; live shippers get a tracker
# "spreadsheet" (Sheet 1 quotation cost frozen at go-live, Sheet 2 orders).
# ---------------------------------------------------------------------------

TRACKER_MAX_ROWS = 5000


class GoLiveCandidate(BaseModel):
    shipper_name: str
    sales_email: str | None = None
    sales_pic: str | None = None
    lane_count: int
    priced_lane_count: int
    last_submitted_at: str


class GoLiveCandidateList(BaseModel):
    shippers: list[GoLiveCandidate]


class GoLiveIn(BaseModel):
    shipper_names: list[str]


class TrackerShipper(BaseModel):
    shipper_name: str
    sales_email: str | None = None
    sales_pic: str | None = None
    confirmed_by: str
    confirmed_at: str
    quotation_count: int
    order_count: int


class TrackerShipperList(BaseModel):
    shippers: list[TrackerShipper]


class QuotationLine(BaseModel):
    origin: str = ""
    destination: str = ""
    vehicle_type: str = ""
    vendor: str | None = None
    cost: float | None = None
    rate: float | None = None
    margin_pct: float | None = None


class OrderLine(BaseModel):
    order_no: str | None = None
    order_date: str | None = None
    origin: str | None = None
    destination: str | None = None
    vehicle_type: str | None = None
    status: str | None = None
    planned_vendor: str | None = None
    est_cost: float | None = None
    rate: float | None = None
    actual_vendor: str | None = None
    actual_invoice_cost: float | None = None
    revenue_uang_jalan: float | None = None
    revenue_overnight: float | None = None


class TrackerSheet(BaseModel):
    shipper_name: str
    quotation: list[QuotationLine]
    orders: list[OrderLine]


class QuotationBody(BaseModel):
    rows: list[QuotationLine]


class OrdersBody(BaseModel):
    rows: list[OrderLine]


def _lane_key(origin: str, destination: str, vehicle: str) -> tuple[str, str, str]:
    return (master_rates.norm(origin), master_rates.norm(destination), master_rates.norm(vehicle))


async def _shipper_summaries(cur) -> dict[str, dict]:
    """Per shipper (by the name sales typed): lane counts, newest submission, and
    the number of still-open VM tickets. Newest submission decides the sales owner."""
    await cur.execute(
        """SELECT s.shipper_name, s.id, s.sales_email, s.sales_pic, s.created_at,
                  COUNT(sr.id), COALESCE(SUM(sr.final_rate IS NOT NULL), 0)
           FROM submissions s
           LEFT JOIN submission_rows sr ON sr.submission_id = s.id
           WHERE s.shipper_name IS NOT NULL AND s.shipper_name <> '' AND s.submitted_at IS NOT NULL
           GROUP BY s.shipper_name, s.id, s.sales_email, s.sales_pic, s.created_at
           ORDER BY s.id ASC"""
    )
    out: dict[str, dict] = {}
    for name, sid, sales_email, sales_pic, created_at, lanes, priced in await cur.fetchall():
        d = out.setdefault(name, {"lanes": 0, "priced": 0, "open_tickets": 0})
        d["lanes"] += lanes
        d["priced"] += int(priced)
        d.update(submission_id=sid, sales_email=sales_email, sales_pic=sales_pic, last=str(created_at))

    await cur.execute(
        """SELECT s.shipper_name, COUNT(*)
           FROM vm_requests vr
           JOIN submission_rows sr ON vr.submission_row_id = sr.id
           JOIN submissions s ON sr.submission_id = s.id
           WHERE vr.status IN ('open', 'in_progress') AND s.shipper_name IS NOT NULL
           GROUP BY s.shipper_name"""
    )
    for name, n in await cur.fetchall():
        if name in out:
            out[name]["open_tickets"] = n

    # Unanswered additional-service prices also keep a shipper from going live.
    await cur.execute(
        """SELECT s.shipper_name, COUNT(*)
           FROM service_requests q JOIN submissions s ON q.submission_id = s.id
           WHERE q.unavailable = 0 AND q.unit_price IS NULL AND s.shipper_name IS NOT NULL
           GROUP BY s.shipper_name"""
    )
    for name, n in await cur.fetchall():
        if name in out:
            out[name]["open_tickets"] += n
    return out


@app.get("/api/profitability/candidates", response_model=GoLiveCandidateList)
async def go_live_candidates(request: Request):
    """Shippers that can be picked to go live: every ticket closed and at least one
    priced lane, and not already live."""
    await require_any_role(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        summaries = await _shipper_summaries(cur)
        await cur.execute("SELECT shipper_name FROM go_live_shippers")
        live = {r[0] for r in await cur.fetchall()}
    shippers = [
        GoLiveCandidate(
            shipper_name=name,
            sales_email=d["sales_email"],
            sales_pic=d["sales_pic"],
            lane_count=d["lanes"],
            priced_lane_count=d["priced"],
            last_submitted_at=d["last"],
        )
        for name, d in sorted(summaries.items(), key=lambda kv: kv[0].lower())
        if name not in live and d["open_tickets"] == 0 and d["priced"] > 0
    ]
    return GoLiveCandidateList(shippers=shippers)


@app.post("/api/profitability/go-live", response_model=TrackerShipperList, status_code=201)
async def confirm_go_live(body: GoLiveIn, request: Request):
    """Confirm shippers as going live. Freezes each shipper's Sheet 1 (quotation
    cost) from its priced lanes — newest submission wins per OD + vehicle — and
    tells VM. Re-confirming a shipper that was moved back keeps its existing
    sheets and only adds lanes that aren't in Sheet 1 yet."""
    email = await require_any_role(request)
    names = [n for n in dict.fromkeys(body.shipper_names) if n]
    if not names:
        raise HTTPException(400, "Pick at least one shipper")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        summaries = await _shipper_summaries(cur)
        await cur.execute("SELECT shipper_name FROM go_live_shippers")
        live = {r[0] for r in await cur.fetchall()}
        for name in names:
            d = summaries.get(name)
            if d is None:
                raise HTTPException(404, f"Unknown shipper: {name}")
            if name in live:
                raise HTTPException(400, f"{name} is already live")
            if d["open_tickets"] > 0 or d["priced"] == 0:
                raise HTTPException(400, f"{name} still has open tickets or no priced lanes")

        await cur.execute("SELECT email FROM user_roles WHERE role IN ('vm', 'procurement', 'superadmin')")
        vm_emails = [r[0] for r in await cur.fetchall() if r[0] != email]

        for name in names:
            await cur.execute(
                """SELECT sr.origin, sr.destination, sr.vehicle_type, sr.matched_vendor, sr.matched_cost, sr.final_rate,
                          sr.margin_pct
                   FROM submission_rows sr JOIN submissions s ON sr.submission_id = s.id
                   WHERE s.shipper_name = %s AND s.submitted_at IS NOT NULL AND sr.final_rate IS NOT NULL
                   ORDER BY s.id ASC, sr.id ASC""",
                (name,),
            )
            latest: dict[tuple[str, str, str], tuple] = {}
            for r in await cur.fetchall():
                latest[_lane_key(r[0], r[1], r[2])] = r

            await cur.execute(
                "SELECT origin, destination, vehicle_type FROM tracker_quotation WHERE shipper_name = %s", (name,)
            )
            existing = {_lane_key(*r) for r in await cur.fetchall()}
            await cur.execute("SELECT COALESCE(MAX(position), -1) FROM tracker_quotation WHERE shipper_name = %s", (name,))
            position = (await cur.fetchone())[0] + 1
            for key, r in latest.items():
                if key in existing:
                    continue
                margin = r[6]
                if margin is None and r[4] and r[5]:  # priced before margin_pct was recorded
                    margin = round((float(r[5]) / float(r[4]) - 1) * 100, 1)
                await cur.execute(
                    """INSERT INTO tracker_quotation
                       (shipper_name, position, origin, destination, vehicle_type, vendor, cost, rate, margin_pct)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (name, position, r[0], r[1], r[2], r[3], r[4], r[5], margin),
                )
                position += 1

            await cur.execute(
                "INSERT INTO go_live_shippers (shipper_name, confirmed_by) VALUES (%s, %s)", (name, email)
            )
            for recipient in vm_emails:
                await cur.execute(
                    "INSERT INTO notifications (recipient_email, submission_id, message) VALUES (%s, %s, %s)",
                    (recipient, summaries[name]["submission_id"], f"{email} confirmed go live: {name}"[:500]),
                )
        shippers = await _tracker_shippers(cur)
    return TrackerShipperList(shippers=[s for s in shippers if s.shipper_name in names])


async def _tracker_shippers(cur) -> list[TrackerShipper]:
    summaries = await _shipper_summaries(cur)
    await cur.execute(
        """SELECT g.shipper_name, g.confirmed_by, g.confirmed_at,
                  (SELECT COUNT(*) FROM tracker_quotation q WHERE q.shipper_name = g.shipper_name),
                  (SELECT COUNT(*) FROM tracker_orders o WHERE o.shipper_name = g.shipper_name)
           FROM go_live_shippers g ORDER BY g.confirmed_at DESC"""
    )
    return [
        TrackerShipper(
            shipper_name=r[0],
            sales_email=summaries.get(r[0], {}).get("sales_email"),
            sales_pic=summaries.get(r[0], {}).get("sales_pic"),
            confirmed_by=r[1],
            confirmed_at=str(r[2]),
            quotation_count=r[3],
            order_count=r[4],
        )
        for r in await cur.fetchall()
    ]


@app.get("/api/profitability/tracker", response_model=TrackerShipperList)
async def tracker_shippers(request: Request):
    await require_any_role(request)
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        shippers = await _tracker_shippers(cur)
    return TrackerShipperList(shippers=shippers)


@app.post("/api/profitability/undo-go-live", status_code=204)
async def undo_go_live(body: GoLiveIn, request: Request):
    """VM / superadmin: move shippers back to "Pilih Go Live". Sheets are kept."""
    await require_role(request, "vm")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        for name in body.shipper_names:
            await cur.execute("DELETE FROM go_live_shippers WHERE shipper_name = %s", (name,))


async def _require_live(cur, shipper_name: str) -> None:
    await cur.execute("SELECT 1 FROM go_live_shippers WHERE shipper_name = %s", (shipper_name,))
    if not await cur.fetchone():
        raise HTTPException(404, "Shipper is not live")


def _num(v) -> float | None:
    return float(v) if v is not None else None


@app.get("/api/profitability/sheet", response_model=TrackerSheet)
async def tracker_sheet(request: Request, shipper_name: str = Query(...)):
    _, role = await require_permission(request, "viewProfitability")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await _require_live(cur, shipper_name)
        await cur.execute(
            """SELECT origin, destination, vehicle_type, vendor, cost, rate, margin_pct
               FROM tracker_quotation WHERE shipper_name = %s ORDER BY position, id""",
            (shipper_name,),
        )
        quotation = [
            QuotationLine(
                origin=r[0], destination=r[1], vehicle_type=r[2], vendor=r[3], cost=_num(r[4]), rate=_num(r[5]),
                margin_pct=_num(r[6]),
            )
            for r in await cur.fetchall()
        ]
        await cur.execute(
            """SELECT order_no, order_date, origin, destination, vehicle_type, status, planned_vendor, est_cost,
                      rate, actual_vendor, actual_invoice_cost, revenue_uang_jalan, revenue_overnight
               FROM tracker_orders WHERE shipper_name = %s ORDER BY position, id""",
            (shipper_name,),
        )
        orders = [
            OrderLine(
                order_no=r[0], order_date=str(r[1]) if r[1] else None, origin=r[2], destination=r[3],
                vehicle_type=r[4], status=r[5], planned_vendor=r[6], est_cost=_num(r[7]), rate=_num(r[8]),
                actual_vendor=r[9], actual_invoice_cost=_num(r[10]), revenue_uang_jalan=_num(r[11]),
                revenue_overnight=_num(r[12]),
            )
            for r in await cur.fetchall()
        ]
    if not permissions.can(role, "seeVendorData"):
        quotation = [q.model_copy(update={"vendor": None, "cost": None, "margin_pct": None}) for q in quotation]
        orders = [
            o.model_copy(update={"planned_vendor": None, "est_cost": None, "actual_vendor": None,
                                 "actual_invoice_cost": None})
            for o in orders
        ]
    return TrackerSheet(shipper_name=shipper_name, quotation=quotation, orders=orders)


@app.put("/api/profitability/quotation", status_code=204)
async def save_tracker_quotation(body: QuotationBody, request: Request, shipper_name: str = Query(...)):
    # Editing needs the vendor/cost columns, which only VM sees — a save from a
    # redacted sheet would overwrite them with blanks.
    await require_permission(request, "editProfitability")
    rows = [r for r in body.rows if r.origin.strip() or r.destination.strip() or r.vehicle_type.strip()]
    if len(rows) > TRACKER_MAX_ROWS:
        raise HTTPException(400, f"At most {TRACKER_MAX_ROWS} rows")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await _require_live(cur, shipper_name)
        await conn.begin()
        try:
            await cur.execute("DELETE FROM tracker_quotation WHERE shipper_name = %s", (shipper_name,))
            for i, r in enumerate(rows):
                await cur.execute(
                    """INSERT INTO tracker_quotation
                       (shipper_name, position, origin, destination, vehicle_type, vendor, cost, rate, margin_pct)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (shipper_name, i, r.origin.strip(), r.destination.strip(), r.vehicle_type.strip(),
                     (r.vendor or "").strip() or None, r.cost, r.rate, r.margin_pct),
                )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise


def _parse_date(value: str | None):
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


@app.put("/api/profitability/orders", status_code=204)
async def save_tracker_orders(body: OrdersBody, request: Request, shipper_name: str = Query(...)):
    await require_permission(request, "editProfitability")
    if len(body.rows) > TRACKER_MAX_ROWS:
        raise HTTPException(400, f"At most {TRACKER_MAX_ROWS} rows")
    clean = lambda v: (v or "").strip() or None
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await _require_live(cur, shipper_name)
        await conn.begin()
        try:
            await cur.execute("DELETE FROM tracker_orders WHERE shipper_name = %s", (shipper_name,))
            for i, r in enumerate(body.rows):
                if r.status not in (None, "", "completed", "cancelled"):
                    raise HTTPException(400, "status must be completed or cancelled")
                await cur.execute(
                    """INSERT INTO tracker_orders
                       (shipper_name, position, order_no, order_date, origin, destination, vehicle_type, status,
                        planned_vendor, est_cost, rate, actual_vendor, actual_invoice_cost,
                        revenue_uang_jalan, revenue_overnight)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (shipper_name, i, clean(r.order_no), _parse_date(r.order_date), clean(r.origin),
                     clean(r.destination), clean(r.vehicle_type), r.status or None, clean(r.planned_vendor),
                     r.est_cost, r.rate, clean(r.actual_vendor), r.actual_invoice_cost,
                     r.revenue_uang_jalan, r.revenue_overnight),
                )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise


# ---------------------------------------------------------------------------
# Dashboard Ticket: one ticket = one submitted rate request (several lanes).
# ---------------------------------------------------------------------------


class TicketSummary(BaseModel):
    id: int
    ticket_no: str
    raised_at: str
    shipper_name: str | None
    sales_pic: str | None
    sales_email: str | None
    raised_by: str
    commodity_type: str | None = None
    add_ons: list[AddOn] = []
    lane_count: int
    vehicles: list[str]
    has_target_rate: bool
    priced_count: int
    vm_open_count: int  # lanes waiting on VM or being worked on
    vm_working_count: int  # lanes VM marked in progress
    oldest_open_days: int | None = None
    editable: bool = False


class TicketSummaryList(BaseModel):
    tickets: list[TicketSummary]


async def _ticket_editable(cur, submission_id: int, email: str | None) -> bool:
    """The salesperson who raised a ticket may edit it until VM starts on any lane
    (any of its VM requests has left 'open')."""
    if not email:
        return False
    await cur.execute(
        """SELECT s.uploaded_by,
                  (SELECT COUNT(*) FROM vm_requests vr JOIN submission_rows r ON vr.submission_row_id = r.id
                   WHERE r.submission_id = s.id AND vr.status <> 'open')
           FROM submissions s WHERE s.id = %s AND s.submitted_at IS NOT NULL""",
        (submission_id,),
    )
    row = await cur.fetchone()
    return bool(row) and row[0] == email and int(row[1]) == 0


@app.get("/api/ticket-board", response_model=TicketSummaryList)
async def ticket_board(request: Request, vm_only: bool = Query(False)):
    """All raised tickets, newest first. vm_only=true: just the tickets with at least
    one lane VM still has to answer or is working on (the VM queue, VM roles only)."""
    email, role = await require_permission(request, "workTickets" if vm_only else "viewQueue")
    vm_filter = "AND COALESCE(v.vm_open, 0) > 0" if vm_only else ""
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            f"""SELECT s.id, s.submitted_at, s.shipper_name, s.sales_pic, s.sales_email, s.uploaded_by,
                       s.commodity_type, s.add_ons,
                       a.lanes, a.vehicles, a.with_target, a.priced,
                       COALESCE(v.vm_open, 0), COALESCE(v.vm_working, 0), v.oldest_open, COALESCE(v.vm_started, 0)
                FROM submissions s
                JOIN (SELECT submission_id, COUNT(*) lanes,
                             GROUP_CONCAT(DISTINCT vehicle_type ORDER BY vehicle_type SEPARATOR '|') vehicles,
                             SUM(target_rate IS NOT NULL) with_target, SUM(final_rate IS NOT NULL) priced
                      FROM submission_rows GROUP BY submission_id) a ON a.submission_id = s.id
                LEFT JOIN (SELECT r.submission_id,
                                  SUM(vr.status IN ('open', 'in_progress')) vm_open,
                                  SUM(vr.status = 'in_progress') vm_working,
                                  MIN(CASE WHEN vr.status IN ('open', 'in_progress') THEN vr.created_at END) oldest_open,
                                  SUM(vr.status <> 'open') vm_started
                           FROM vm_requests vr JOIN submission_rows r ON vr.submission_row_id = r.id
                           GROUP BY r.submission_id) v ON v.submission_id = s.id
                WHERE s.submitted_at IS NOT NULL {vm_filter}
                ORDER BY s.submitted_at DESC, s.id DESC"""
        )
        rows = await cur.fetchall()
    can_edit = permissions.can(role, "createRequest")
    now = datetime.now()
    tickets = []
    for r in rows:
        oldest = r[14]
        tickets.append(
            TicketSummary(
                id=r[0], ticket_no=ticket_no(r[0]), raised_at=str(r[1]), shipper_name=r[2], sales_pic=r[3],
                sales_email=r[4], raised_by=r[5], commodity_type=r[6],
                add_ons=[AddOn(**a) for a in json.loads(r[7])] if r[7] else [],
                lane_count=int(r[8]), vehicles=[v for v in (r[9] or "").split("|") if v],
                has_target_rate=int(r[10] or 0) > 0, priced_count=int(r[11] or 0),
                vm_open_count=int(r[12]), vm_working_count=int(r[13]),
                oldest_open_days=max(0, (now - oldest.replace(tzinfo=None)).days) if oldest else None,
                editable=can_edit and r[5] == email and int(r[15]) == 0,
            )
        )
    return TicketSummaryList(tickets=tickets)


class LaneEdit(BaseModel):
    origin: str
    destination: str
    vehicle_type: str
    target_rate: float | None = None
    min_trip: int | None = None


@app.put("/api/submissions/{submission_id}/rows/{row_id}", response_model=SubmissionDetail)
async def edit_lane(submission_id: int, row_id: int, body: LaneEdit, request: Request):
    """The ticket's owner edits one lane until VM starts on the ticket. The lane is
    re-priced from master rates; a lane that now needs VM gets a request, and an
    open request on it is updated to the new details."""
    email = await require_role(request, "sales")
    _, role = await current_user(request)
    origin, destination, vehicle = body.origin.strip(), body.destination.strip(), body.vehicle_type.strip()
    if not (origin and destination and vehicle):
        raise HTTPException(400, "Origin, destination and vehicle are required")
    if body.target_rate is not None and body.target_rate <= 0:
        raise HTTPException(400, "Target rate must be positive")
    if body.min_trip is not None and body.min_trip < 0:
        raise HTTPException(400, "Minimum trip can't be negative")

    pool = db.pool()
    async with pool.acquire() as conn, conn.cursor() as cur:
        if not await _ticket_editable(cur, submission_id, email):
            raise HTTPException(403, "Only the person who raised this ticket can edit it, until VM starts on it")
        await cur.execute(
            "SELECT id FROM submission_rows WHERE id = %s AND submission_id = %s", (row_id, submission_id)
        )
        if not await cur.fetchone():
            raise HTTPException(404, "Lane not found on this ticket")

    costs = await master_rates.find_costs(pool, origin, destination, vehicle)
    result = pricing.compute_final_rate(costs, body.target_rate)
    basis, ranked_json = _snapshot(result)

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """UPDATE submission_rows
               SET origin = %s, destination = %s, vehicle_type = %s, target_rate = %s, min_trip = %s,
                   final_rate = %s, remarks = %s, matched_vendor = %s, matched_cost = %s,
                   matched_basis = %s, matched_ranked = %s, margin_pct = %s
               WHERE id = %s""",
            (origin, destination, vehicle, body.target_rate, body.min_trip, result.final_rate, result.remarks,
             result.matched_vendor, result.matched_cost, basis, ranked_json, result.margin_pct, row_id),
        )
        await cur.execute(
            "SELECT id FROM vm_requests WHERE submission_row_id = %s AND status = 'open'", (row_id,)
        )
        open_req = await cur.fetchone()
        if open_req:
            await cur.execute(
                """UPDATE vm_requests SET origin = %s, destination = %s, vehicle_type = %s, target_rate = %s,
                          current_final_rate = %s WHERE id = %s""",
                (origin, destination, vehicle, body.target_rate, result.final_rate, open_req[0]),
            )
        elif result.single_vendor:
            await cur.execute(
                """INSERT INTO vm_requests
                   (submission_row_id, origin, destination, vehicle_type, target_rate, current_final_rate, requested_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (row_id, origin, destination, vehicle, body.target_rate, result.final_rate, email),
            )
        await _system_comment(cur, submission_id, f"{email} edited a lane: {origin} → {destination} ({vehicle}).")
        detail = await _load_submission_detail(cur, submission_id, email, permissions.can(role, "seeVendorData"))
        editable = await _ticket_editable(cur, submission_id, email)
    return detail.model_copy(update={"ticket_no": ticket_no(submission_id), "editable": editable})


# ---------------------------------------------------------------------------
# Available routes: which lanes have master rates — for sales, without vendor data.
# ---------------------------------------------------------------------------


class AvailableRoute(BaseModel):
    origin: str
    destination: str
    vehicle_type: str
    # "ready": 2+ vendors, priced instantly. "single": 1 vendor, VM must confirm.
    status: str
    final_rate: float | None = None  # what a request without target rate would quote


class AvailableRouteList(BaseModel):
    routes: list[AvailableRoute]


@app.get("/api/available-routes", response_model=AvailableRouteList)
async def available_routes(request: Request):
    """Every OD + vehicle with vendor rates on file, and the price a request without a
    target rate would get (same rule as Quick Check). Vendor names and costs are never
    returned."""
    await require_permission(request, "quickCheck")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """SELECT origin, destination, vehicle_type, norm_origin, norm_destination, norm_vehicle_type,
                      norm_vendor_name, cost
               FROM vendor_rates
               ORDER BY norm_origin, norm_destination, norm_vehicle_type"""
        )
        rows = await cur.fetchall()
    lanes: dict[tuple, dict] = {}
    for o, d, v, no, nd, nv, vendor, cost in rows:
        lane = lanes.setdefault((no, nd, nv), {"origin": o, "destination": d, "vehicle_type": v, "costs": {}})
        lane["costs"][vendor] = float(cost)
    routes = []
    for lane in lanes.values():
        result = pricing.compute_final_rate(lane["costs"], None)
        routes.append(
            AvailableRoute(
                origin=lane["origin"], destination=lane["destination"], vehicle_type=lane["vehicle_type"],
                status="single" if result.single_vendor else "ready", final_rate=result.final_rate,
            )
        )
    return AvailableRouteList(routes=routes)
