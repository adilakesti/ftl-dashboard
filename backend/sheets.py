"""Read-only access to the master "FTL Rates" Google Sheet (tab "Database Rate").

Header row is row 11 (1-indexed), data starts row 12. Columns (as lettered in the
sheet, B is the first fetched column so index 0):
  B origin | C destination | D jawo/exJawo | E vehicle type | F client expected rate
  G duta SLA | H duta rate | I diff | J %diff
  K seryu SLA | L seryu rate | M diff | N %diff
  O ab-cargo SLA | P ab-cargo rate | Q diff | R %diff
  S sjl SLA | T sjl rate | U diff | V %diff

Only the four vendor "oneway rate" columns (H, L, P, T) are used — the sheet's own
Diff/%Diff columns are ignored; this app computes its own margin logic.
"""
import os
import time

from google.oauth2 import service_account
from googleapiclient.discovery import build

SHEET_TAB = "Database Rate"
DATA_RANGE = f"'{SHEET_TAB}'!B12:T5000"
CACHE_TTL_SECONDS = 300

VENDOR_COL_OFFSETS = {
    "Duta Trans": 6,   # H
    "Seryu": 10,       # L
    "AB Cargo": 14,    # P
    "SJL": 18,         # T
}

_cache: dict = {"data": None, "fetched_at": 0.0}


def _service():
    raw = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    import json

    info = json.loads(raw)
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
    )
    return build("sheets", "v4", credentials=creds)


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
    svc = _service()
    resp = (
        svc.spreadsheets()
        .values()
        .get(spreadsheetId=sheet_id, range=DATA_RANGE)
        .execute()
    )
    rows = resp.get("values", [])

    lanes = []
    for row in rows:
        if len(row) <= 4:
            continue
        origin = row[0].strip() if len(row) > 0 and row[0] else None
        dest = row[1].strip() if len(row) > 1 and row[1] else None
        vehicle = row[3].strip() if len(row) > 3 and row[3] else None
        if not origin or not dest or not vehicle:
            continue

        costs = {}
        for vendor, offset in VENDOR_COL_OFFSETS.items():
            cell = row[offset] if len(row) > offset else None
            val = _parse_number(cell)
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
