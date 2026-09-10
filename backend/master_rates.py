"""Master vendor-cost data: parsed from a CSV export of the "Database Rate"
Google Sheet tab and stored in the vendor_rates table (VM re-uploads whenever
the master sheet changes — see /api/master-rates/upload in main.py).

The CSV keeps the sheet's own layout: header row 11 (1-indexed), data from
row 12. Columns as lettered in the sheet (A is the first CSV column, index 0):
  B origin | C destination | D jawo/exJawo | E vehicle type | F client expected rate
  G duta SLA | H duta rate | I diff | J %diff
  K seryu SLA | L seryu rate | M diff | N %diff
  O ab-cargo SLA | P ab-cargo rate | Q diff | R %diff
  S sjl SLA | T sjl rate | U diff | V %diff

Only the four vendor "oneway rate" columns (H, L, P, T) are used.
"""
import csv
import io

DATA_START_ROW_INDEX = 11  # 0-indexed; sheet row 12


def _col(letter: str) -> int:
    return ord(letter) - ord("A")


VENDOR_COLS = {
    "duta_cost": _col("H"),
    "seryu_cost": _col("L"),
    "ab_cargo_cost": _col("P"),
    "sjl_cost": _col("T"),
}
ORIGIN_COL = _col("B")
DEST_COL = _col("C")
VEHICLE_COL = _col("E")


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
    all_rows = list(csv.reader(io.StringIO(text)))
    data_rows = all_rows[DATA_START_ROW_INDEX:]

    lanes = []
    max_col = max(VEHICLE_COL, *VENDOR_COLS.values())
    for row in data_rows:
        if len(row) <= max_col:
            continue
        origin = row[ORIGIN_COL].strip() if row[ORIGIN_COL] else None
        dest = row[DEST_COL].strip() if row[DEST_COL] else None
        vehicle = row[VEHICLE_COL].strip() if row[VEHICLE_COL] else None
        if not origin or not dest or not vehicle:
            continue

        lane = {
            "origin": origin,
            "destination": dest,
            "vehicle_type": vehicle,
            "norm_origin": norm(origin),
            "norm_destination": norm(dest),
            "norm_vehicle_type": norm(vehicle),
        }
        for field, col in VENDOR_COLS.items():
            lane[field] = _parse_number(row[col])
        lanes.append(lane)
    return lanes


async def replace_all(pool, lanes: list[dict], uploaded_by: str, filename: str | None) -> int:
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("DELETE FROM vendor_rates")
        for lane in lanes:
            await cur.execute(
                """INSERT INTO vendor_rates
                   (origin, destination, vehicle_type, norm_origin, norm_destination,
                    norm_vehicle_type, duta_cost, seryu_cost, ab_cargo_cost, sjl_cost)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    lane["origin"],
                    lane["destination"],
                    lane["vehicle_type"],
                    lane["norm_origin"],
                    lane["norm_destination"],
                    lane["norm_vehicle_type"],
                    lane["duta_cost"],
                    lane["seryu_cost"],
                    lane["ab_cargo_cost"],
                    lane["sjl_cost"],
                ),
            )
        await cur.execute(
            "INSERT INTO master_rate_uploads (uploaded_by, filename, row_count) VALUES (%s, %s, %s)",
            (uploaded_by, filename, len(lanes)),
        )
    return len(lanes)


VENDOR_LABELS = {
    "duta_cost": "Duta Trans",
    "seryu_cost": "Seryu",
    "ab_cargo_cost": "AB Cargo",
    "sjl_cost": "SJL",
}


async def find_costs(pool, origin: str, destination: str, vehicle_type: str) -> dict[str, float]:
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            """SELECT duta_cost, seryu_cost, ab_cargo_cost, sjl_cost
               FROM vendor_rates
               WHERE norm_origin = %s AND norm_destination = %s AND norm_vehicle_type = %s
               LIMIT 1""",
            (norm(origin), norm(destination), norm(vehicle_type)),
        )
        row = await cur.fetchone()

    if not row:
        return {}

    costs = {}
    for (field, _col), value in zip(VENDOR_COLS.items(), row):
        if value is not None:
            costs[VENDOR_LABELS[field]] = float(value)
    return costs


async def last_upload_meta(pool) -> dict | None:
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT uploaded_by, filename, row_count, created_at FROM master_rate_uploads ORDER BY id DESC LIMIT 1"
        )
        row = await cur.fetchone()
    if not row:
        return None
    return {"uploaded_by": row[0], "filename": row[1], "row_count": row[2], "created_at": str(row[3])}
