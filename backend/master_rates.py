"""Master vendor-cost data. Long format: one row per (origin, destination,
vehicle type, vendor) — VM uploads a CSV in this shape (bulk, or scoped to a
single request when resolving it), and each row is upserted into vendor_rates
so re-uploads only add/update, never wipe unrelated lanes.

CSV columns (case-insensitive, a few aliases accepted):
  Origin L2 | Destinasi L2 | Vehicle Type | Cost/Rate | Vendor Name | [Valid Until]

A rate is *active* — used for pricing — unless it was revoked or its valid-until date
has passed. Revoked/expired rows are kept for history; uploading the same lane +
vendor again reactivates it with the new cost.
"""
import csv
import io
import re
from datetime import date

# SQL condition for a rate that may be used for pricing (alias-free column names).
ACTIVE_SQL = "revoked_at IS NULL AND (valid_until IS NULL OR valid_until >= CURDATE())"

HEADER_ALIASES = {
    "origin l2": "origin",
    "origin": "origin",
    "destinasi l2": "destination",
    "destination l2": "destination",
    "destinasi": "destination",
    "destination": "destination",
    "vehicle type": "vehicle_type",
    "cost/rate": "cost",
    "cost": "cost",
    "rate": "cost",
    "vendor name": "vendor_name",
    "vendor": "vendor_name",
    "valid until": "valid_until",
    "valid_until": "valid_until",
    "berlaku sampai": "valid_until",
}


def norm(s: str) -> str:
    return " ".join(str(s).strip().lower().split())


def parse_date(cell) -> date | None:
    """YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY; blank -> None; anything else -> ValueError."""
    s = str(cell or "").strip()
    if not s:
        return None
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        return date(int(m[1]), int(m[2]), int(m[3]))
    m = re.fullmatch(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)
    if m:
        return date(int(m[3]), int(m[2]), int(m[1]))
    raise ValueError(f"Valid Until '{s}' is not a date (use DD-MM-YYYY)")


def _parse_number(cell) -> float | None:
    if cell is None:
        return None
    s = str(cell).strip().replace(",", "")
    if s in ("", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_csv(content: bytes) -> list[dict]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV has no header row")

    colmap = {}
    for field in reader.fieldnames:
        key = HEADER_ALIASES.get(field.strip().lower())
        if key:
            colmap[field] = key

    for required in ("origin", "destination", "vehicle_type", "cost", "vendor_name"):
        if required not in colmap.values():
            raise ValueError(f"CSV missing required column for '{required}'")

    rows = []
    for raw in reader:
        row = {colmap[k]: (v.strip() if v else "") for k, v in raw.items() if k in colmap}
        cost = _parse_number(row.get("cost"))
        if not row.get("origin") or not row.get("destination") or not row.get("vehicle_type") or not row.get("vendor_name"):
            continue
        if cost is None or cost <= 0:
            continue
        rows.append(
            {
                "origin": row["origin"],
                "destination": row["destination"],
                "vehicle_type": row["vehicle_type"],
                "vendor_name": row["vendor_name"],
                "cost": cost,
                "valid_until": parse_date(row.get("valid_until")),
            }
        )
    return rows


async def upsert_rows(pool, rows: list[dict], uploaded_by: str, filename: str | None) -> int:
    async with pool.acquire() as conn, conn.cursor() as cur:
        for row in rows:
            await cur.execute(
                """INSERT INTO vendor_rates
                   (origin, destination, vehicle_type, vendor_name, cost,
                    norm_origin, norm_destination, norm_vehicle_type, norm_vendor_name, updated_by, valid_until)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE
                       cost = VALUES(cost), origin = VALUES(origin), destination = VALUES(destination),
                       vehicle_type = VALUES(vehicle_type), vendor_name = VALUES(vendor_name),
                       updated_by = VALUES(updated_by), valid_until = VALUES(valid_until),
                       revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL""",
                (
                    row["origin"],
                    row["destination"],
                    row["vehicle_type"],
                    row["vendor_name"],
                    row["cost"],
                    norm(row["origin"]),
                    norm(row["destination"]),
                    norm(row["vehicle_type"]),
                    norm(row["vendor_name"]),
                    uploaded_by,
                    row.get("valid_until"),
                ),
            )
        await cur.execute(
            "INSERT INTO master_rate_uploads (uploaded_by, filename, row_count) VALUES (%s, %s, %s)",
            (uploaded_by, filename, len(rows)),
        )
    return len(rows)


async def find_costs(pool, origin: str, destination: str, vehicle_type: str) -> dict[str, float]:
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            f"""SELECT vendor_name, cost FROM vendor_rates
               WHERE norm_origin = %s AND norm_destination = %s AND norm_vehicle_type = %s AND {ACTIVE_SQL}""",
            (norm(origin), norm(destination), norm(vehicle_type)),
        )
        rows = await cur.fetchall()
    return {r[0]: float(r[1]) for r in rows}


async def list_all(pool, active_only: bool = False) -> list[dict]:
    where = f"WHERE {ACTIVE_SQL}" if active_only else ""
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            f"""SELECT id, origin, destination, vehicle_type, vendor_name, cost, updated_by, updated_at,
                       valid_until, revoked_at, revoked_by, revoke_reason
                FROM vendor_rates {where} ORDER BY origin, destination, vehicle_type, vendor_name"""
        )
        rows = await cur.fetchall()
    today = date.today()
    out = []
    for r in rows:
        valid_until, revoked_at = r[8], r[9]
        status = "revoked" if revoked_at else "expired" if valid_until and valid_until < today else "active"
        out.append(
            {
                "id": r[0],
                "origin": r[1],
                "destination": r[2],
                "vehicle_type": r[3],
                "vendor_name": r[4],
                "cost": float(r[5]),
                "updated_by": r[6],
                "updated_at": str(r[7]),
                "valid_until": str(valid_until) if valid_until else None,
                "revoked_at": str(revoked_at) if revoked_at else None,
                "revoked_by": r[10],
                "revoke_reason": r[11],
                "status": status,
            }
        )
    return out


async def revoke(pool, ids: list[int], by: str, reason: str) -> list[tuple[str, str, str]]:
    """Revoke rates (kept for history). Returns the lanes touched."""
    return await _update_ids(
        pool, ids, "revoked_at = NOW(), revoked_by = %s, revoke_reason = %s WHERE revoked_at IS NULL AND", (by, reason)
    )


async def restore(pool, ids: list[int], by: str) -> list[tuple[str, str, str]]:
    return await _update_ids(
        pool, ids, "revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL, updated_by = %s WHERE", (by,)
    )


async def set_valid_until(pool, ids: list[int], valid_until: date | None, by: str) -> list[tuple[str, str, str]]:
    return await _update_ids(pool, ids, "valid_until = %s, updated_by = %s WHERE", (valid_until, by))


async def _update_ids(pool, ids: list[int], set_and_where: str, args: tuple) -> list[tuple[str, str, str]]:
    if not ids:
        return []
    marks = ", ".join(["%s"] * len(ids))
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(f"UPDATE vendor_rates SET {set_and_where} id IN ({marks})", (*args, *ids))
        await cur.execute(
            f"SELECT DISTINCT origin, destination, vehicle_type FROM vendor_rates WHERE id IN ({marks})", tuple(ids)
        )
        return [tuple(r) for r in await cur.fetchall()]


async def last_upload_meta(pool) -> dict | None:
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT uploaded_by, filename, row_count, created_at FROM master_rate_uploads ORDER BY id DESC LIMIT 1"
        )
        row = await cur.fetchone()
    if not row:
        return None
    return {"uploaded_by": row[0], "filename": row[1], "row_count": row[2], "created_at": str(row[3])}


async def list_vendor_names(pool) -> list[str]:
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT MIN(vendor_name) FROM vendor_rates GROUP BY norm_vendor_name ORDER BY 1")
        rows = await cur.fetchall()
    return [r[0] for r in rows]
