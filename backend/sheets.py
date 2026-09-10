"""Read-only access to the master "FTL Rates" Google Sheet (tab "Database Rate").

The sheet is shared as "Anyone with the link can view", so this fetches it via
Google's public CSV export endpoint — no service account or API key needed.

Header row is sheet row 11 (1-indexed), data starts row 12. Columns as lettered
in the sheet (A is the first CSV column, index 0):
  A (unused) | B origin | C destination | D jawo/exJawo | E vehicle type
  F client expected rate
  G duta SLA | H duta rate | I diff | J %diff
  K seryu SLA | L seryu rate | M diff | N %diff
  O ab-cargo SLA | P ab-cargo rate | Q diff | R %diff
  S sjl SLA | T sjl rate | U diff | V %diff

Only the four vendor "oneway rate" columns (H, L, P, T) are used — the sheet's own
Diff/%Diff columns are ignored; this app computes its own margin logic.
"""
import csv
import io
import os
import time
import urllib.request

SHEET_TAB_GID = os.getenv("GOOGLE_SHEET_GID", "0")
DATA_START_ROW_INDEX = 11  # 0-indexed; sheet row 12
CACHE_TTL_SECONDS = 300


def _col(letter: str) -> int:
    return ord(letter) - ord("A")


VENDOR_COLS = {
    "Duta Trans": _col("H"),
    "Seryu": _col("L"),
    "AB Cargo": _col("P"),
    "SJL": _col("T"),
}
ORIGIN_COL = _col("B")
DEST_COL = _col("C")
VEHICLE_COL = _col("E")

_cache: dict = {"data": None, "fetched_at": 0.0}


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


def _norm(s: str) -> str:
    return " ".join(str(s).strip().lower().split())


def _fetch_raw() -> list[dict]:
    sheet_id = os.environ["GOOGLE_SHEET_ID"]
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={SHEET_TAB_GID}"
    req = urllib.request.Request(url, headers={"User-Agent": "ftl-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        text = resp.read().decode("utf-8-sig")

    all_rows = list(csv.reader(io.StringIO(text)))
    data_rows = all_rows[DATA_START_ROW_INDEX:]

    lanes = []
    for row in data_rows:
        max_col = max(VEHICLE_COL, *VENDOR_COLS.values())
        if len(row) <= max_col:
            continue
        origin = row[ORIGIN_COL].strip() if row[ORIGIN_COL] else None
        dest = row[DEST_COL].strip() if row[DEST_COL] else None
        vehicle = row[VEHICLE_COL].strip() if row[VEHICLE_COL] else None
        if not origin or not dest or not vehicle:
            continue

        costs = {}
        for vendor, col in VENDOR_COLS.items():
            val = _parse_number(row[col])
            if val is not None and val > 0:
                costs[vendor] = val

        lanes.append(
            {
                "origin": origin,
                "destination": dest,
                "vehicle_type": vehicle,
                "costs": costs,
            }
        )
    return lanes


def _build_lookup(lanes: list[dict]) -> dict:
    lookup = {}
    for lane in lanes:
        key = (_norm(lane["origin"]), _norm(lane["destination"]), _norm(lane["vehicle_type"]))
        lookup[key] = lane
    return lookup


def get_lookup(force_refresh: bool = False) -> dict:
    now = time.time()
    if (
        not force_refresh
        and _cache["data"] is not None
        and now - _cache["fetched_at"] < CACHE_TTL_SECONDS
    ):
        return _cache["data"]

    lanes = _fetch_raw()
    lookup = _build_lookup(lanes)
    _cache["data"] = lookup
    _cache["fetched_at"] = now
    return lookup


def find_lane(origin: str, destination: str, vehicle_type: str) -> dict | None:
    lookup = get_lookup()
    return lookup.get((_norm(origin), _norm(destination), _norm(vehicle_type)))
