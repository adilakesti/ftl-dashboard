import { useEffect, useState } from "react";
import { L2_LOCATIONS, canonicalL2, VEHICLE_TYPES } from "../l2Locations.js";
import { DEFAULT_ADD_ONS_STATE, DEFAULT_SHIPPER_FORM, Discussion, OD_REGIONS, FilterBar, RATE_REQUEST_TEMPLATE_URL, SERVICES, Td, Th, buildAddOns, fmt, idr, matchesFilters, useDirectoryUsers, userLabel } from "../shared.jsx";

export const UNKNOWN_SHIPPER_SALES = "Ad-hoc / unknown shipper";

export function ShipperLaneGroup({ shipperName, lanes, kind, focusSubmissionId, onFocusHandled, onOpenDiscussion }) {
  const [expanded, setExpanded] = useState(false);
  const first = lanes[0];

  const bySubmission = {};
  for (const l of lanes) {
    const cur = bySubmission[l.submission_id];
    if (!cur || new Date(l.submitted_at) > new Date(cur)) bySubmission[l.submission_id] = l.submitted_at;
  }
  const submissions = Object.entries(bySubmission)
    .map(([id, date]) => ({ id: Number(id), date }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const primarySubmissionId = submissions[0]?.id;
  const anchorId = `shipper-group-${encodeURIComponent(shipperName)}`;

  const toggleAndOpen = () => {
    setExpanded((v) => {
      const next = !v;
      if (next && primarySubmissionId) onOpenDiscussion(`/api/submissions/${primarySubmissionId}/comments`);
      return next;
    });
  };

  useEffect(() => {
    if (!focusSubmissionId || !submissions.some((sub) => sub.id === focusSubmissionId)) return;
    setExpanded(true);
    onOpenDiscussion(`/api/submissions/${focusSubmissionId}/comments`);
    setTimeout(() => {
      document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    onFocusHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSubmissionId]);

  return (
    <div id={anchorId} className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 hover:bg-ink-50">
        <button onClick={toggleAndOpen} className="flex-1 text-left">
          <span className="text-sm">
            <span className="font-semibold">{shipperName}</span>
            {first.sales_pic && <span className="ml-2 text-xs text-ink-400">{first.sales_pic}</span>}
            <span className="ml-2 text-xs text-ink-400">
              ({lanes.length} lane{lanes.length !== 1 ? "s" : ""})
            </span>
            {first.add_ons?.length > 0 && (
              <span className="ml-2 text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded-full">
                + {first.add_ons.map((a) => a.label).join(", ")}
              </span>
            )}
          </span>
        </button>
        <button
          onClick={() => primarySubmissionId && onOpenDiscussion(`/api/submissions/${primarySubmissionId}/comments`)}
          className="text-xs px-2.5 py-1 rounded border border-ink-200 hover:bg-white mr-3"
        >
          💬 Discussion
        </button>
        <div className="flex gap-1 mr-3">
          {submissions.map((sub) => (
            <a
              key={sub.id}
              href={`/api/submissions/${sub.id}/quotation.xlsx`}
              onClick={(e) => e.stopPropagation()}
              title={`Quotation for the ${sub.date} submission`}
              className="text-xs px-2 py-1 rounded border border-ink-200 hover:bg-white whitespace-nowrap"
            >
              Quotation {sub.date.slice(0, 10)}
            </a>
          ))}
        </div>
        <button onClick={toggleAndOpen} className="text-xs text-ink-400">
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-ink-100 px-4 py-3">
          <table className="w-full mb-1">
            <thead>
              <tr>
                <Th>Submitted</Th>
                <Th>Origin</Th>
                <Th>Destination</Th>
                <Th>Vehicle</Th>
                <Th>Target Rate</Th>
                <Th>Final Rate</Th>
                <Th>Remarks</Th>
                <Th>Min Trip</Th>
                {kind === "active" && <Th>Aging (days)</Th>}
              </tr>
            </thead>
            <tbody>
              {lanes.map((l) => (
                <tr key={l.id}>
                  <Td className="text-ink-500 whitespace-nowrap">{l.submitted_at}</Td>
                  <Td>{l.origin}</Td>
                  <Td>{l.destination}</Td>
                  <Td>{l.vehicle_type}</Td>
                  <Td>{fmt(l.target_rate)}</Td>
                  <Td className={l.final_rate == null ? "text-ink-400" : "font-medium"}>{fmt(l.final_rate)}</Td>
                  <Td className={(l.remarks || "").startsWith("No vendor available") ? "text-red-500" : "text-ink-500"}>
                    {l.remarks || "-"}
                    {l.auto_closed_sla && (
                      <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                        Auto-closed (SLA)
                      </span>
                    )}
                  </Td>
                  <Td>{l.min_trip ?? "-"}</Td>
                  {kind === "active" && <Td>{l.aging_days ?? "-"}</Td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function GlobalLanesList({ lanes, emptyLabel, kind, focusSubmissionId, onFocusHandled, onOpenDiscussion }) {
  const [shipperFilter, setShipperFilter] = useState("");
  const [salesFilter, setSalesFilter] = useState("");
  const filtered = lanes.filter((l) => matchesFilters(l, shipperFilter, salesFilter));

  const groups = {};
  for (const l of filtered) {
    const key = l.shipper_name || UNKNOWN_SHIPPER_SALES;
    (groups[key] = groups[key] || []).push(l);
  }
  const shipperNames = Object.keys(groups).sort((a, b) => {
    if (a === UNKNOWN_SHIPPER_SALES) return 1;
    if (b === UNKNOWN_SHIPPER_SALES) return -1;
    return a.localeCompare(b);
  });

  return (
    <div>
      <FilterBar
        items={lanes}
        shipper={shipperFilter}
        setShipper={setShipperFilter}
        sales={salesFilter}
        setSales={setSalesFilter}
      />
      <div className="space-y-2">
        {shipperNames.map((name) => (
          <ShipperLaneGroup
            key={name}
            shipperName={name}
            lanes={groups[name]}
            kind={kind}
            focusSubmissionId={focusSubmissionId}
            onFocusHandled={onFocusHandled}
            onOpenDiscussion={onOpenDiscussion}
          />
        ))}
        {shipperNames.length === 0 && <p className="text-sm text-ink-400">{emptyLabel}</p>}
      </div>
    </div>
  );
}

export const CSV_ALIASES = {
  "l2 origin": "origin",
  "origin": "origin",
  "l2 destinasi": "destination",
  "l2 destination": "destination",
  "destination": "destination",
  "vehicle type": "vehicle_type",
  "target rate": "target_rate",
  "minimum trip": "min_trip",
  "min trip": "min_trip",
};

export function parseCsvPreview(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const colmap = {};
  header.forEach((h, i) => {
    const key = CSV_ALIASES[h.toLowerCase()];
    if (key) colmap[i] = key;
  });
  return lines
    .slice(1)
    .map((line) => {
      const cells = line.split(",");
      const row = {};
      Object.entries(colmap).forEach(([i, key]) => {
        row[key] = (cells[Number(i)] || "").trim();
      });
      return row;
    })
    .filter((r) => r.origin && r.destination && r.vehicle_type);
}

// ---------------------------------------------------------------------------
// Sales: Quick Check (lane price lookup, nothing saved) + price calculator
// ---------------------------------------------------------------------------

export const CALC_MARGIN = 0.1; // 10% margin on the selling price (not a markup on cost)
export const CALC_PPN = 1.11;

export function PriceCalculator() {
  const [cost, setCost] = useState("");
  const [withPpn, setWithPpn] = useState(false);
  const c = Number(String(cost).replace(/[^0-9]/g, "")) || 0;
  const beforePpn = c / (1 - CALC_MARGIN);
  const price = withPpn ? beforePpn * CALC_PPN : beforePpn;

  return (
    <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4">
      <h2 className="font-semibold mb-1">Kalkulator harga (cost dari procurement)</h2>
      <p className="text-xs text-ink-400 mb-3">
        Harga = Cost ÷ (1 − 10%). Margin 10% dari harga jual, bukan mark up dari cost.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="text-xs text-ink-500">Cost (IDR)</label>
          <input
            className="mt-1 w-48 border border-ink-200 rounded px-2 py-1.5 text-sm"
            placeholder="mis. 3.000.000"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={withPpn} onChange={(e) => setWithPpn(e.target.checked)} />
          Include PPN 11%
        </label>
      </div>
      {c > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg border-2 border-brand-500 bg-brand-50 p-3">
            <div className="text-xs text-ink-500">Harga jual{withPpn ? " (incl. PPN 11%)" : ""}</div>
            <div className="text-xl font-bold text-brand-700">{idr(Math.round(price))}</div>
          </div>
          <div className="rounded-lg border border-ink-100 p-3">
            <div className="text-xs text-ink-500">Keuntungan</div>
            <div className="text-lg font-semibold">{idr(Math.round(beforePpn - c))}</div>
          </div>
          <div className="rounded-lg border border-ink-100 p-3">
            <div className="text-xs text-ink-500">Margin</div>
            <div className="text-lg font-semibold">10%</div>
          </div>
          <p className="col-span-3 text-sm rounded border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
            Harga ini sudah batas bawah. Kalau mau di bawah harga ini, harus tanya ke PSP dulu.
          </p>
        </div>
      )}
    </div>
  );
}

export function QuickCheck({ onRequest }) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [vehicleChoice, setVehicleChoice] = useState("");
  const [vehicleOther, setVehicleOther] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const vehicle = (vehicleChoice === "__other__" ? vehicleOther : vehicleChoice).trim();
  const bad = (v) => v.trim() !== "" && !canonicalL2(v);

  const search = async () => {
    const o = canonicalL2(origin);
    const d = canonicalL2(destination);
    if (!o || !d || !vehicle) {
      setError("Pilih Origin, Destinasi (dari list L2) dan tipe kendaraan");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ origin: o, destination: d, vehicle_type: vehicle });
      const res = await fetch(`/api/quick-check?${q}`);
      if (!res.ok) throw new Error("Gagal mengecek harga");
      setResult(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const RANK_LABEL = ["1st winner", "2nd winner", "3rd winner"];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4">
        <h2 className="font-semibold mb-1">Quick Check harga lane</h2>
        <p className="text-xs text-ink-400 mb-3">Cek cepat dari rate card — tidak menyimpan apa pun dan tidak membuat tiket.</p>
        <datalist id="l2-locations-quick">
          {L2_LOCATIONS.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <div className="flex flex-wrap gap-2 items-start">
          {[
            [origin, setOrigin, "L2 Origin"],
            [destination, setDestination, "L2 Destinasi"],
          ].map(([v, set, ph]) => (
            <input
              key={ph}
              list="l2-locations-quick"
              placeholder={ph}
              className={`flex-1 min-w-[200px] border rounded px-2 py-1.5 text-sm ${
                bad(v) ? "border-red-400 bg-red-50" : "border-ink-200"
              }`}
              value={v}
              onChange={(e) => {
                set(e.target.value);
                setResult(null);
              }}
              onBlur={(e) => {
                const c = canonicalL2(e.target.value);
                if (c) set(c);
              }}
            />
          ))}
          <div className="w-44 flex flex-col gap-1">
            <select
              className="border border-ink-200 rounded px-2 py-1.5 text-sm bg-white"
              value={vehicleChoice}
              onChange={(e) => {
                setVehicleChoice(e.target.value);
                setResult(null);
              }}
            >
              <option value="">Vehicle type…</option>
              {VEHICLE_TYPES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
              <option value="__other__">Others…</option>
            </select>
            {vehicleChoice === "__other__" && (
              <input
                placeholder="Type the vehicle"
                className="border border-ink-200 rounded px-2 py-1.5 text-sm"
                value={vehicleOther}
                onChange={(e) => setVehicleOther(e.target.value)}
              />
            )}
          </div>
          <button
            onClick={search}
            disabled={loading}
            className="px-4 py-1.5 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? "Mencari…" : "Cek harga"}
          </button>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

        {result &&
          (result.available ? (
            <div className="mt-4">
              <div className="grid grid-cols-3 gap-3">
                {result.winners.map((w) => {
                  const used = w.rank === 2;
                  return (
                    <div
                      key={w.rank}
                      className={`rounded-lg p-3 ${used ? "border-2 border-brand-500 bg-brand-50" : "border border-ink-100"}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase text-ink-500">{RANK_LABEL[w.rank - 1]}</span>
                        {used && (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-brand-600 text-white">
                            Rate yang dipakai
                          </span>
                        )}
                      </div>
                      <div className={`mt-1 font-bold ${used ? "text-2xl text-brand-700" : "text-lg"}`}>{idr(Math.round(w.price))}</div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-ink-500 mt-2">
                Final rate memakai 2nd winner (vendor termurah ke-2) + margin 11,1% (termasuk PPN). Semua angka sudah harga
                jual.
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-center justify-between gap-3">
              <span>
                Rate belum tersedia untuk lane ini
                {result.vendor_count === 1 ? " (baru ada 1 vendor)" : ""}. Ajukan request ke VM.
              </span>
              <button
                onClick={() => onRequest({ origin: result.origin, destination: result.destination, vehicle_type: result.vehicle_type })}
                className="px-3 py-1.5 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 whitespace-nowrap"
              >
                Buat request ke VM
              </button>
            </div>
          ))}
      </div>

      <PriceCalculator />
    </div>
  );
}

// Additional-service price requests (Overnight / TKBM / Drop point), one card per submission.
export function serviceAnswerText(it) {
  if (it.unavailable) return it.auto_closed_sla ? "Tidak tersedia (auto-closed SLA)" : "Tidak tersedia";
  if (it.unit_price != null) return `${idr(it.unit_price)} ${it.unit}`;
  return "Menunggu VM";
}

export function ServiceRequestCards({ requests }) {
  if (requests.length === 0) return null;
  return (
    <div className="space-y-2 mb-4">
      <h3 className="text-sm font-semibold text-ink-500 uppercase">Additional services</h3>
      {requests.map((r) => (
        <div key={r.submission_id} className="bg-white rounded-xl border border-ink-100 shadow-sm p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-sm">{r.shipper_name || `Submission #${r.submission_id}`}</span>
            <span className="text-xs text-ink-400">
              {r.created_at} · {r.aging_days}d
            </span>
          </div>
          <table className="w-full">
            <tbody>
              {r.items.map((it) => (
                <tr key={it.id}>
                  <Td className="w-48 font-medium">{it.label}</Td>
                  <Td className="text-ink-500">{it.note || "-"}</Td>
                  <Td className={it.unit_price != null ? "font-medium text-right" : "text-ink-400 text-right"}>
                    {serviceAnswerText(it)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}


// `tab` is driven by the app's sidebar: "quick" | "new" | "active" | "completed".
export function SalesView({ tab, onTabChange, focusSubmissionId, onFocusHandled }) {
  const mainTab = tab;
  const setMainTab = onTabChange;
  const [submissions, setSubmissions] = useState([]);
  const [active, setActive] = useState(null); // {submission, rows} — set once "Check Result" runs
  const [lanes, setLanes] = useState([]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [askIds, setAskIds] = useState(new Set()); // draft lanes sales marked "Ask VM"
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [discussionEndpoint, setDiscussionEndpoint] = useState(null);

  const salesUsers = useDirectoryUsers().filter((u) => u.role === "sales");
  const [shipperForm, setShipperForm] = useState(DEFAULT_SHIPPER_FORM);
  const [addOnsState, setAddOnsState] = useState(DEFAULT_ADD_ONS_STATE);
  const [file, setFile] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [uploadMode, setUploadMode] = useState("csv"); // "csv" | "manual"
  const [manualRows, setManualRows] = useState([{ origin: "", destination: "", vehicle_type: "", vehicle_choice: "", target_rate: "", min_trip: "" }]);

  const loadSubmissions = () => {
    fetch("/api/submissions")
      .then((r) => r.json())
      .then((d) => setSubmissions(d.submissions));
  };

  const loadLanes = () => {
    fetch("/api/lanes")
      .then((r) => r.json())
      .then((d) => setLanes(d.lanes));
  };

  useEffect(() => {
    loadSubmissions();
    loadLanes();
  }, []);

  const startNew = () => {
    setMainTab("new");
    setActive(null);
    setShipperForm(DEFAULT_SHIPPER_FORM);
    setAddOnsState(DEFAULT_ADD_ONS_STATE);
    setFile(null);
    setPreviewRows([]);
    setUploadMode("csv");
    setManualRows([{ origin: "", destination: "", vehicle_type: "", vehicle_choice: "", target_rate: "", min_trip: "" }]);
    setAskIds(new Set());
    setError(null);
  };

  // Lane pre-filled from Quick Check when its rate isn't available.
  const startNewWithLane = (lane) => {
    startNew();
    setUploadMode("manual");
    const known = VEHICLE_TYPES.includes(lane.vehicle_type);
    setManualRows([
      {
        origin: lane.origin,
        destination: lane.destination,
        vehicle_choice: known ? lane.vehicle_type : "__other__",
        vehicle_type: known ? "" : lane.vehicle_type,
        target_rate: "",
        min_trip: "",
      },
    ]);
  };

  const updateManualRow = (i, field, value) => {
    setActive(null);
    setManualRows((rows) => rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  };
  const addManualRow = () => {
    setManualRows((rows) => [...rows, { origin: "", destination: "", vehicle_type: "", vehicle_choice: "", target_rate: "", min_trip: "" }]);
  };
  const removeManualRow = (i) => {
    setActive(null);
    setManualRows((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : rows));
  };

  const effectiveVehicle = (r) => (r.vehicle_choice === "__other__" ? r.vehicle_type : r.vehicle_choice).trim();
  const manualRowsFilled = manualRows.filter((r) => r.origin.trim() && r.destination.trim() && effectiveVehicle(r));
  const badLocation = (v) => v.trim() !== "" && !canonicalL2(v);

  const manualRowsToCsvFile = () => {
    // Quote every cell and keep numbers digits-only: "3,800,000" would otherwise split into extra CSV columns.
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const digits = (v) => String(v ?? "").replace(/[^0-9]/g, "");
    const lines = ["L2 Origin,L2 Destinasi,Vehicle Type,Target Rate,Minimum trip"];
    for (const r of manualRowsFilled) {
      lines.push(
        [canonicalL2(r.origin), canonicalL2(r.destination), effectiveVehicle(r), digits(r.target_rate), digits(r.min_trip)]
          .map(cell)
          .join(",")
      );
    }
    return new File([lines.join("\n")], "manual_entry.csv", { type: "text/csv" });
  };

  const onFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setActive(null);
    setAskIds(new Set());
    setFile(f);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setPreviewRows(parseCsvPreview(String(reader.result || "")));
    reader.readAsText(f);
  };

  const checkResult = async () => {
    if (!shipperForm.salescrm_id.trim() || !shipperForm.shipper_name.trim() || !shipperForm.sales_email || !shipperForm.od_region) {
      setError("SalesCRM ID, Shipper Name, Sales PIC and OD Region are required");
      return;
    }
    if (uploadMode === "csv" && !file) {
      setError("Upload a lanes CSV first");
      return;
    }
    if (uploadMode === "manual" && manualRowsFilled.length === 0) {
      setError("Add at least one lane (origin, destination, vehicle type)");
      return;
    }
    if (uploadMode === "manual" && manualRows.some((r) => badLocation(r.origin) || badLocation(r.destination))) {
      setError("Pick Origin and Destination from the L2 list (red fields aren't in the list)");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      // Re-running Check Result replaces the unsubmitted draft instead of piling up drafts.
      if (active && !active.submission.submitted_at) {
        await fetch(`/api/submissions/${active.submission.id}`, { method: "DELETE" });
      }
      const selectedAddOns = buildAddOns(addOnsState);

      const form = new FormData();
      form.append("file", uploadMode === "manual" ? manualRowsToCsvFile() : file);
      form.append("shipper_name", shipperForm.shipper_name);
      const picUser = salesUsers.find((u) => u.email === shipperForm.sales_email);
      form.append("sales_pic", picUser ? userLabel(picUser) : shipperForm.sales_email);
      form.append("sales_email", shipperForm.sales_email);
      form.append("shipper_status", shipperForm.shipper_status);
      form.append("potential_monthly_revenue", shipperForm.potential_monthly_revenue);
      form.append("commodity_type", shipperForm.commodity_type);
      form.append("high_value_fragile", shipperForm.high_value_fragile ? "true" : "false");
      form.append("od_region", shipperForm.od_region);
      form.append("salescrm_id", shipperForm.salescrm_id.trim());
      form.append("add_ons_json", JSON.stringify(selectedAddOns));

      const res = await fetch("/api/submissions/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Upload failed");
      }
      const data = await res.json();
      setActive(data);
      setAskIds(new Set());
      loadSubmissions();
      loadLanes();
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const openSubmission = (id) => {
    setMainTab("new");
    fetch(`/api/submissions/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setActive(d);
        setAskIds(new Set());
        setFile(null);
        setPreviewRows([]);
      });
  };

  const isDraft = active && !active.submission.submitted_at;
  const askable = (row) => !row.needs_vm; // single-vendor lanes are always sent on Submit
  const askableRows = isDraft ? active.rows.filter(askable) : [];
  const allAsked = askableRows.length > 0 && askableRows.every((r) => askIds.has(r.id));

  const toggleAsk = (id) => {
    setAskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAskAll = () => setAskIds(allAsked ? new Set() : new Set(askableRows.map((r) => r.id)));

  const draftRows = isDraft ? active.rows : [];
  const notAskedNoRate = draftRows.filter((r) => askable(r) && r.final_rate == null && !askIds.has(r.id));
  const notAskedWithRate = draftRows.filter((r) => askable(r) && r.final_rate != null && !askIds.has(r.id));
  const autoSent = draftRows.filter((r) => r.needs_vm);
  const draftServices = isDraft ? active.submission.add_ons.filter((a) => a.service) : [];

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/submissions/${active.submission.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ask_vm_row_ids: [...askIds] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Submit failed");
      }
      setActive(await res.json());
      setAskIds(new Set());
      setConfirmingSubmit(false);
      loadSubmissions();
      loadLanes();
      loadServiceRequests();
    } catch (err) {
      setError(err.message);
      setConfirmingSubmit(false);
    } finally {
      setSubmitting(false);
    }
  };

  const [serviceRequests, setServiceRequests] = useState([]);
  const loadServiceRequests = () => {
    fetch("/api/service-requests")
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => setServiceRequests(d.requests));
  };
  useEffect(loadServiceRequests, []);

  const activeLanes = lanes.filter((l) => l.vm_status === "open" || l.vm_status === "in_progress");
  const completedLanes = lanes.filter(
    (l) => !(l.vm_status === "open" || l.vm_status === "in_progress") && (l.final_rate != null || (l.remarks || "").startsWith("No vendor available"))
  );

  const openServices = serviceRequests.filter((r) => r.status === "open");
  const doneServices = serviceRequests.filter((r) => r.status === "done");

  useEffect(() => {
    if (!focusSubmissionId) return;
    if (activeLanes.some((l) => l.submission_id === focusSubmissionId)) setMainTab("active");
    else if (completedLanes.some((l) => l.submission_id === focusSubmissionId)) setMainTab("completed");
  }, [focusSubmissionId, lanes]);

  return (
    <div>
      {(mainTab === "active" || mainTab === "completed") && <div className="flex gap-1 mb-4 p-1 bg-ink-100 rounded-lg w-fit">
        {[
          { key: "active", label: `In progress (${activeLanes.length + openServices.length})` },
          { key: "completed", label: `Completed (${completedLanes.length + doneServices.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setMainTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${
              mainTab === t.key ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>}

      {(mainTab === "active" || mainTab === "completed") && (
        <div className="flex gap-5 items-start">
          <div className="flex-1 min-w-0">
            <ServiceRequestCards requests={mainTab === "active" ? openServices : doneServices} />
            {mainTab === "active" ? (
              <GlobalLanesList
                lanes={activeLanes}
                emptyLabel="No active requests."
                kind="active"
                focusSubmissionId={focusSubmissionId}
                onFocusHandled={onFocusHandled}
                onOpenDiscussion={setDiscussionEndpoint}
              />
            ) : (
              <GlobalLanesList
                lanes={completedLanes}
                emptyLabel="No completed requests yet."
                kind="completed"
                focusSubmissionId={focusSubmissionId}
                onFocusHandled={onFocusHandled}
                onOpenDiscussion={setDiscussionEndpoint}
              />
            )}
          </div>

          {discussionEndpoint && (
            <aside className="w-[440px] shrink-0 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
              <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-sm">Discussion</h3>
                  <button onClick={() => setDiscussionEndpoint(null)} className="text-xs text-ink-500 hover:underline">
                    Close
                  </button>
                </div>
                <Discussion endpoint={discussionEndpoint} />
              </div>
            </aside>
          )}
        </div>
      )}

      {mainTab === "quick" && <QuickCheck onRequest={startNewWithLane} />}

      {mainTab === "new" && (
        <div className="flex gap-6">
          <div className="w-64 shrink-0">
            <button
              onClick={startNew}
              className="w-full mb-3 px-3 py-1.5 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700"
            >
              + New submission
            </button>
            <h3 className="text-sm font-semibold text-ink-500 uppercase mb-2">Submission history</h3>
            <ul className="space-y-1">
              {submissions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => openSubmission(s.id)}
                    className="text-sm text-left w-full px-2 py-1.5 rounded hover:bg-ink-100"
                  >
                    <div className="truncate">
                      {!s.submitted_at && (
                        <span className="mr-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold uppercase">
                          Draft
                        </span>
                      )}
                      {s.shipper_name || s.filename || `Submission #${s.id}`}
                    </div>
                    <div className="text-xs text-ink-400">{s.created_at}</div>
                  </button>
                </li>
              ))}
              {submissions.length === 0 && <li className="text-sm text-ink-400">No submissions yet</li>}
            </ul>
          </div>

          <div className="flex-1 min-w-0 space-y-4">
            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4 space-y-6">
              <div>
                <h2 className="font-semibold mb-3">Shipper details</h2>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-ink-500">SalesCRM ID *</label>
                    <input
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.salescrm_id}
                      maxLength={64}
                      placeholder="Deal / opportunity ID in SalesCRM"
                      onChange={(e) => setShipperForm((f) => ({ ...f, salescrm_id: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-500">Shipper Name *</label>
                    <input
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.shipper_name}
                      onChange={(e) => setShipperForm((f) => ({ ...f, shipper_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-500">Sales PIC *</label>
                    <select
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.sales_email}
                      onChange={(e) => setShipperForm((f) => ({ ...f, sales_email: e.target.value }))}
                    >
                      <option value="">Select sales…</option>
                      {salesUsers.map((u) => (
                        <option key={u.email} value={u.email}>
                          {userLabel(u)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-ink-500">OD Region *</label>
                    <select
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.od_region}
                      onChange={(e) => setShipperForm((f) => ({ ...f, od_region: e.target.value }))}
                    >
                      <option value="">Select region…</option>
                      {OD_REGIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-ink-500">New or Existing Shipper</label>
                    <select
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.shipper_status}
                      onChange={(e) => setShipperForm((f) => ({ ...f, shipper_status: e.target.value }))}
                    >
                      <option value="new">New</option>
                      <option value="existing">Existing</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-ink-500">Potential Monthly Revenue (IDR)</label>
                    <input
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.potential_monthly_revenue}
                      onChange={(e) => setShipperForm((f) => ({ ...f, potential_monthly_revenue: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-500">Commodity / Item Type</label>
                    <input
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.commodity_type}
                      onChange={(e) => setShipperForm((f) => ({ ...f, commodity_type: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-500">High-value or Fragile?</label>
                    <select
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.high_value_fragile ? "yes" : "no"}
                      onChange={(e) => setShipperForm((f) => ({ ...f, high_value_fragile: e.target.value === "yes" }))}
                    >
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <h2 className="font-semibold mb-3">Additional services</h2>
                <p className="text-xs text-ink-400 mb-3">
                  Tick the services you need priced. On Submit they go to VM as one request for this shipper; VM answers the
                  price per unit and it shows in Completed Request and the quotation.
                </p>
                <div className="space-y-3">
                  {SERVICES.map((sv) => (
                    <div key={sv.key}>
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          checked={addOnsState[sv.key].checked}
                          onChange={(e) =>
                            setAddOnsState((a) => ({ ...a, [sv.key]: { ...a[sv.key], checked: e.target.checked } }))
                          }
                        />
                        {sv.label} <span className="text-xs font-normal text-ink-400">({sv.unit})</span>
                      </label>
                      {addOnsState[sv.key].checked && (
                        <div className="pl-6 mt-1">
                          <input
                            placeholder="Notes for VM (optional)"
                            className="w-full max-w-lg border border-ink-200 rounded px-2 py-1 text-sm"
                            value={addOnsState[sv.key].note}
                            onChange={(e) =>
                              setAddOnsState((a) => ({ ...a, [sv.key]: { ...a[sv.key], note: e.target.value } }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold">Lanes</h2>
                  <div className="flex gap-1">
                    {[
                      { key: "csv", label: "Upload CSV" },
                      { key: "manual", label: "Enter manually" },
                    ].map((m) => (
                      <button
                        key={m.key}
                        onClick={() => {
                          setUploadMode(m.key);
                          setActive(null);
                        }}
                        className={`px-3 py-1 rounded text-xs font-medium ${
                          uploadMode === m.key ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-500"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {uploadMode === "csv" ? (
                  <div>
                    <p className="text-sm text-ink-500 mb-3">
                      Columns: L2 Origin | L2 Destinasi | Vehicle Type | Target Rate, Minimum trip (both optional; minimum trip is per month).{" "}
                      <a
                        href={RATE_REQUEST_TEMPLATE_URL}
                        download="ftl_rate_request_template.csv"
                        className="text-brand-600 hover:underline"
                      >
                        Download template
                      </a>
                    </p>
                    <input type="file" accept=".csv" onChange={onFileChange} />
                    {file && !active && <p className="text-xs text-ink-400 mt-2">{previewRows.length} lane(s) parsed from {file.name}.</p>}
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-ink-500 mb-3">
                      Good for a quick 1-2 lane request — add rows below instead of preparing a CSV.
                    </p>
                    <datalist id="l2-locations">
                      {L2_LOCATIONS.map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                    <div className="space-y-2">
                      {manualRows.map((row, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <input
                            list="l2-locations"
                            placeholder="L2 Origin (pick from list)"
                            className={`flex-1 border rounded px-2 py-1.5 text-sm ${
                              badLocation(row.origin) ? "border-red-400 bg-red-50" : "border-ink-200"
                            }`}
                            value={row.origin}
                            onChange={(e) => updateManualRow(i, "origin", e.target.value)}
                            onBlur={(e) => {
                              const c = canonicalL2(e.target.value);
                              if (c && c !== row.origin) updateManualRow(i, "origin", c);
                            }}
                          />
                          <input
                            list="l2-locations"
                            placeholder="L2 Destinasi (pick from list)"
                            className={`flex-1 border rounded px-2 py-1.5 text-sm ${
                              badLocation(row.destination) ? "border-red-400 bg-red-50" : "border-ink-200"
                            }`}
                            value={row.destination}
                            onChange={(e) => updateManualRow(i, "destination", e.target.value)}
                            onBlur={(e) => {
                              const c = canonicalL2(e.target.value);
                              if (c && c !== row.destination) updateManualRow(i, "destination", c);
                            }}
                          />
                          <div className="w-40 flex flex-col gap-1">
                            <select
                              className="border border-ink-200 rounded px-2 py-1.5 text-sm bg-white"
                              value={row.vehicle_choice}
                              onChange={(e) => updateManualRow(i, "vehicle_choice", e.target.value)}
                            >
                              <option value="">Vehicle type…</option>
                              {VEHICLE_TYPES.map((v) => (
                                <option key={v} value={v}>
                                  {v}
                                </option>
                              ))}
                              <option value="__other__">Others…</option>
                            </select>
                            {row.vehicle_choice === "__other__" && (
                              <input
                                placeholder="Type the vehicle"
                                className="border border-ink-200 rounded px-2 py-1.5 text-sm"
                                value={row.vehicle_type}
                                onChange={(e) => updateManualRow(i, "vehicle_type", e.target.value)}
                              />
                            )}
                          </div>
                          <input
                            placeholder="Target Rate (optional)"
                            className="w-40 border border-ink-200 rounded px-2 py-1.5 text-sm"
                            value={row.target_rate}
                            onChange={(e) => updateManualRow(i, "target_rate", e.target.value)}
                          />
                          <input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="Min trip /mo"
                            className="w-32 border border-ink-200 rounded px-2 py-1.5 text-sm"
                            value={row.min_trip}
                            onChange={(e) => updateManualRow(i, "min_trip", e.target.value)}
                          />
                          {manualRows.length > 1 && (
                            <button onClick={() => removeManualRow(i)} className="text-ink-400 hover:text-red-600 text-sm px-1">
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button onClick={addManualRow} className="mt-2 text-sm text-brand-600 hover:underline">
                      + Add lane
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={checkResult}
                disabled={checking || (uploadMode === "csv" ? !file : manualRowsFilled.length === 0)}
                className="px-4 py-2 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {checking ? "Checking…" : "Check Result"}
              </button>
            </div>

            {!active && uploadMode === "csv" && previewRows.length > 0 && (
              <div className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <Th>Origin</Th>
                      <Th>Destination</Th>
                      <Th>Vehicle Type</Th>
                      <Th>Target Rate</Th>
                      <Th>Min Trip</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i}>
                        <Td>{row.origin}</Td>
                        <Td>{row.destination}</Td>
                        <Td>{row.vehicle_type}</Td>
                        <Td>{row.target_rate || "-"}</Td>
                        <Td>{row.min_trip || "-"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-ink-400 px-3 py-2 border-t border-ink-100">
                  Preview only — click "Check Result" to compute Final Rates.
                </p>
              </div>
            )}

            {active && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {isDraft ? (
                      <>
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-bold uppercase">Draft</span>
                        <span className="text-xs text-ink-500">
                          Nothing is sent until you Submit. Mark the lanes VM should look at, then Submit.
                        </span>
                      </>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-green-100 text-green-700 text-xs font-bold uppercase">
                        Submitted {active.submission.submitted_at}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={`/api/submissions/${active.submission.id}/quotation.xlsx`}
                      className="text-sm px-3 py-1.5 rounded border border-ink-200 hover:bg-ink-50"
                    >
                      Download quotation (Excel)
                    </a>
                    {isDraft && (
                      <button
                        onClick={() => setConfirmingSubmit(true)}
                        className="text-sm px-4 py-1.5 rounded font-medium bg-brand-600 text-white hover:bg-brand-700"
                      >
                        Submit
                      </button>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        {isDraft && (
                          <Th>
                            <input
                              type="checkbox"
                              title="Ask VM for every lane"
                              checked={allAsked}
                              onChange={toggleAskAll}
                              disabled={askableRows.length === 0}
                            />
                          </Th>
                        )}
                        <Th>Origin</Th>
                        <Th>Destination</Th>
                        <Th>Vehicle Type</Th>
                        <Th>Target Rate</Th>
                        <Th>Final Rate</Th>
                        <Th>Remarks</Th>
                        <Th></Th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.rows.map((row) => (
                        <tr key={row.id} className={askIds.has(row.id) ? "bg-brand-50" : ""}>
                          {isDraft && (
                            <Td>
                              {askable(row) && (
                                <input type="checkbox" checked={askIds.has(row.id)} onChange={() => toggleAsk(row.id)} />
                              )}
                            </Td>
                          )}
                          <Td>{row.origin}</Td>
                          <Td>{row.destination}</Td>
                          <Td>{row.vehicle_type}</Td>
                          <Td>{fmt(row.target_rate)}</Td>
                          <Td className={row.final_rate == null ? "text-ink-400" : "font-medium"}>
                            {fmt(row.final_rate)}
                          </Td>
                          <Td className="text-ink-500">{row.remarks}</Td>
                          <Td>
                            {!isDraft ? (
                              row.raised_to_vm && <span className="text-xs text-green-600">Requested</span>
                            ) : !askable(row) ? (
                              <span className="text-xs text-ink-500 whitespace-nowrap">Sent to VM on Submit</span>
                            ) : (
                              <button
                                onClick={() => toggleAsk(row.id)}
                                className={`text-xs px-2 py-1 rounded border whitespace-nowrap ${
                                  askIds.has(row.id)
                                    ? "border-brand-600 bg-brand-600 text-white"
                                    : "border-ink-200 hover:bg-ink-50"
                                }`}
                              >
                                {askIds.has(row.id)
                                  ? "✓ Will ask VM"
                                  : row.final_rate == null
                                  ? "Ask VM for rates"
                                  : "Ask VM for a lower rate"}
                              </button>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {confirmingSubmit && (
              <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-3 max-h-[85vh] overflow-y-auto">
                  <h3 className="font-semibold text-lg">Confirm submission?</h3>
                  <p className="text-sm text-ink-600">
                    {askIds.size + autoSent.length} lane(s) will be sent to VM
                    {draftServices.length > 0 && `, plus a price request for ${draftServices.map((a) => a.label).join(", ")}`}.
                  </p>
                  {notAskedNoRate.length > 0 && (
                    <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      <p className="font-medium mb-1">
                        {notAskedNoRate.length} lane(s) have no rate and weren't asked to VM — they won't be processed and
                        won't show in Active Request:
                      </p>
                      <ul className="list-disc pl-5 text-xs">
                        {notAskedNoRate.map((r) => (
                          <li key={r.id}>
                            {r.origin} → {r.destination} ({r.vehicle_type})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {notAskedWithRate.length > 0 && (
                    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      <p className="font-medium mb-1">
                        {notAskedWithRate.length} lane(s) weren't asked for a lower rate — they will use the rate shown, and
                        VM won't look for a cheaper one:
                      </p>
                      <ul className="list-disc pl-5 text-xs">
                        {notAskedWithRate.map((r) => (
                          <li key={r.id}>
                            {r.origin} → {r.destination} ({r.vehicle_type}): {fmt(r.final_rate)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {autoSent.length > 0 && (
                    <p className="text-xs text-ink-500">
                      {autoSent.length} lane(s) with only one vendor are always sent to VM for review.
                    </p>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={() => setConfirmingSubmit(false)}
                      className="px-3 py-1.5 rounded text-sm border border-ink-200 hover:bg-ink-50"
                    >
                      Back
                    </button>
                    <button
                      onClick={submit}
                      disabled={submitting}
                      className="px-4 py-1.5 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {submitting ? "Submitting…" : "Confirm submit"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!active && uploadMode === "csv" && previewRows.length === 0 && (
              <div className="text-sm text-ink-400">Fill in shipper details and upload a CSV to see a preview here.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
