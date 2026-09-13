"""Master vendor-cost data. Long format: one row per (origin, destination,
vehicle type, vendor) — VM uploads a CSV in this shape (bulk, or scoped to a
single request when resolving it), and each row is upserted into vendor_rates
so re-uploads only add/update, never wipe unrelated lanes.

CSV columns (case-insensitive, a few aliases accepted):
  Origin L2 | Destinasi L2 | Vehicle Type | Cost/Rate | Vendor Name
"""
import csv
import io

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
}


def norm(s: str) -> str:
    return " ".join(str(s).strip().lower().split())


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
            }
        )
    return rows


async def upsert_rows(pool, rows: list[dict], uploaded_by: str, filename: str | None) -> int:
    async with pool.acquire() as conn, conn.cursor() as cur:
        for row in rows:
            await cur.execute(
                """INSERT INTO vendor_rates
                   (origin, destination, vehicle_type, vendor_name, cost,
                    norm_origin, norm_destination, norm_vehicle_type, norm_vendor_name, updated_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE
                       cost = VALUES(cost), origin = VALUES(origin), destination = VALUES(destination),
                       vehicle_type = VALUES(vehicle_type), vendor_name = VALUES(vendor_name),
                       updated_by = VALUES(updated_by)""",
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
            """SELECT vendor_name, cost FROM vendor_rates
               WHERE norm_origin = %s AND norm_destination = %s AND norm_vehicle_type = %s""",
            (norm(origin), norm(destination), norm(vehicle_type)),
        )
        rows = await cur.fetchall()
    return {r[0]: float(r[1]) for r in rows}


async def list_all(pool) -> list[dict]:
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """SELECT origin, destination, vehicle_type, vendor_name, cost, updated_by, updated_at
               FROM vendor_rates ORDER BY origin, destination, vehicle_type, vendor_name"""
        )
        rows = await cur.fetchall()
    return [
        {
            "origin": r[0],
            "destination": r[1],
            "vehicle_type": r[2],
            "vendor_name": r[3],
            "cost": float(r[4]),
            "updated_by": r[5],
            "updated_at": str(r[6]),
        }
        for r in rows
    ]


async def last_upload_meta(pool) -> dict | None:
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT uploaded_by, filename, row_count, created_at FROM master_rate_uploads ORDER BY id DESC LIMIT 1"
        )
        row = await cur.fetchone()
    if not row:
        return None
    return {"uploaded_by": row[0], "filename": row[1], "row_count": row[2], "created_at": str(row[3])}
