"""FTL pricing dashboard backend. Port 8000, GET /health, API under /api.

Auth: Google SSO via the platform's X-Forwarded-Email header (trustworthy only
while SSO is enabled — see /api/me). Role (sales / vm) is a simple allowlist
table (user_roles) keyed by email; an unprovisioned email is shown a
"not provisioned" message by the frontend rather than crashing.
"""
import csv
import io
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

import db
import master_rates
import pricing


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with db.lifespan_pool():
        yield


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
    role: str | None


async def current_user(request: Request) -> tuple[str, str | None]:
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
    if actual_role != role and actual_role != "superadmin":
        raise HTTPException(403, f"Not provisioned as {role}")
    return email


@app.get("/api/me", response_model=Me)
async def me(request: Request):
    email, role = await current_user(request)
    return {"email": email, "role": role}


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


class AddOn(BaseModel):
    label: str
    value: str | None = None


class Submission(BaseModel):
    id: int
    uploaded_by: str
    filename: str | None
    created_at: str
    shipper_name: str | None = None
    sales_pic: str | None = None
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


CSV_HEADER_ALIASES = {
    "l2 origin": "origin",
    "origin": "origin",
    "l2 destinasi": "destination",
    "l2 destination": "destination",
    "destination": "destination",
    "vehicle type": "vehicle_type",
    "target rate": "target_rate",
}


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
    )


SUBMISSION_COLUMNS = (
    "id, uploaded_by, filename, created_at, shipper_name, sales_pic, shipper_status, "
    "potential_monthly_revenue, commodity_type, high_value_fragile, add_ons"
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
):
    email = await require_role(request, "sales")
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

    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """INSERT INTO submissions
               (uploaded_by, filename, shipper_name, sales_pic, shipper_status,
                potential_monthly_revenue, commodity_type, high_value_fragile, add_ons)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
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
            ),
        )
        submission_id = cur.lastrowid

        result_rows = []
        for row in rows:
            costs = await master_rates.find_costs(db.pool(), row["origin"], row["destination"], row["vehicle_type"])
            result = pricing.compute_final_rate(costs, row["target_rate"])

            await cur.execute(
                """INSERT INTO submission_rows
                   (submission_id, origin, destination, vehicle_type, target_rate,
                    final_rate, remarks, matched_vendor, matched_cost)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
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
                ),
            )
            result_rows.append(
                SubmissionRow(
                    id=cur.lastrowid,
                    origin=row["origin"],
                    destination=row["destination"],
                    vehicle_type=row["vehicle_type"],
                    target_rate=row["target_rate"],
                    final_rate=result.final_rate,
                    remarks=result.remarks,
                    matched_vendor=result.matched_vendor,
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
async def list_submissions(request: Request):
    email = await require_role(request, "sales")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            f"SELECT {SUBMISSION_COLUMNS} FROM submissions WHERE uploaded_by = %s ORDER BY id DESC",
            (email,),
        )
        rows = await cur.fetchall()
    return SubmissionList(submissions=[_row_to_submission(r) for r in rows])


@app.get("/api/submissions/{submission_id}", response_model=SubmissionDetail)
async def get_submission(submission_id: int, request: Request):
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
            """SELECT id, origin, destination, vehicle_type, target_rate, final_rate,
                      remarks, matched_vendor
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
                matched_vendor=r[7],
            )
            for r in rows
        ],
    )


# ---------------------------------------------------------------------------
# VM requests
# ---------------------------------------------------------------------------


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


class VmRequestList(BaseModel):
    requests: list[VmRequest]


class LaneSummary(BaseModel):
    origin: str
    destination: str
    vehicle_type: str
    request_count: int


class VmSummary(BaseModel):
    seeking_lower_rate: list[LaneSummary]
    missing_lanes: list[LaneSummary]


def _to_vm_request(r) -> VmRequest:
    target_rate = float(r[4]) if r[4] is not None else None
    return VmRequest(
        id=r[0],
        origin=r[1],
        destination=r[2],
        vehicle_type=r[3],
        target_rate=target_rate,
        target_cost=round(target_rate / 1.111, 2) if target_rate is not None else None,
        current_final_rate=float(r[5]) if r[5] is not None else None,
        requested_by=r[6],
        status=r[7],
        resolved_vendor=r[8],
        resolved_cost=float(r[9]) if r[9] is not None else None,
        created_at=str(r[10]),
    )


@app.post("/api/vm-requests", response_model=VmRequest, status_code=201)
async def create_vm_request(body: VmRequestIn, request: Request):
    email = await require_role(request, "sales")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
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
        await cur.execute(
            """SELECT id, origin, destination, vehicle_type, target_rate,
                      current_final_rate, requested_by, status, resolved_vendor,
                      resolved_cost, created_at
               FROM vm_requests WHERE id = %s""",
            (req_id,),
        )
        row = await cur.fetchone()
    return _to_vm_request(row)


@app.get("/api/vm/requests", response_model=VmRequestList)
async def list_vm_requests(request: Request):
    await require_role(request, "vm")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """SELECT id, origin, destination, vehicle_type, target_rate,
                      current_final_rate, requested_by, status, resolved_vendor,
                      resolved_cost, created_at
               FROM vm_requests ORDER BY (status = 'resolved'), created_at DESC"""
        )
        rows = await cur.fetchall()
    return VmRequestList(requests=[_to_vm_request(r) for r in rows])


class VmRequestUpdate(BaseModel):
    status: str | None = None
    resolved_vendor: str | None = None
    resolved_cost: float | None = None


@app.patch("/api/vm/requests/{request_id}", response_model=VmRequest)
async def update_vm_request(request_id: int, body: VmRequestUpdate, request: Request):
    await require_role(request, "vm")
    if body.status is not None and body.status not in ("open", "in_progress", "resolved"):
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

        await cur.execute(
            """SELECT id, origin, destination, vehicle_type, target_rate,
                      current_final_rate, requested_by, status, resolved_vendor,
                      resolved_cost, created_at
               FROM vm_requests WHERE id = %s""",
            (request_id,),
        )
        row = await cur.fetchone()
    return _to_vm_request(row)


@app.get("/api/vm/summary", response_model=VmSummary)
async def vm_summary(request: Request):
    await require_role(request, "vm")
    async with db.pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """SELECT origin, destination, vehicle_type, COUNT(*) c
               FROM vm_requests
               WHERE status != 'resolved' AND current_final_rate IS NOT NULL
               GROUP BY origin, destination, vehicle_type
               ORDER BY c DESC LIMIT 20"""
        )
        seeking = await cur.fetchall()

        await cur.execute(
            """SELECT origin, destination, vehicle_type, COUNT(*) c
               FROM vm_requests
               WHERE status != 'resolved' AND current_final_rate IS NULL
               GROUP BY origin, destination, vehicle_type
               ORDER BY c DESC LIMIT 20"""
        )
        missing = await cur.fetchall()

    to_lane = lambda r: LaneSummary(origin=r[0], destination=r[1], vehicle_type=r[2], request_count=r[3])
    return VmSummary(
        seeking_lower_rate=[to_lane(r) for r in seeking],
        missing_lanes=[to_lane(r) for r in missing],
    )


# ---------------------------------------------------------------------------
# Master vendor-rate data (VM uploads a CSV export of the "Database Rate" tab)
# ---------------------------------------------------------------------------


class MasterRateUploadResult(BaseModel):
    row_count: int


class MasterRateMeta(BaseModel):
    uploaded_by: str | None
    filename: str | None
    row_count: int | None
    created_at: str | None


@app.post("/api/master-rates/upload", response_model=MasterRateUploadResult, status_code=201)
async def upload_master_rates(request: Request, file: UploadFile):
    email = await require_role(request, "vm")
    content = await file.read()
    lanes = master_rates.parse_csv(content)
    if not lanes:
        raise HTTPException(400, "No usable lane rows found in CSV")
    row_count = await master_rates.replace_all(db.pool(), lanes, email, file.filename)
    return MasterRateUploadResult(row_count=row_count)


@app.get("/api/master-rates/meta", response_model=MasterRateMeta)
async def master_rates_meta(request: Request):
    await require_role(request, "vm")
    meta = await master_rates.last_upload_meta(db.pool())
    if not meta:
        return MasterRateMeta(uploaded_by=None, filename=None, row_count=None, created_at=None)
    return MasterRateMeta(**meta)
