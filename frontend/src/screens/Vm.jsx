import { useEffect, useState } from "react";
import { MASTER_RATE_TEMPLATE_URL, Td, Th, fmt } from "../shared.jsx";

// VM: answer additional-service price requests.
export function VmServiceRequests({ requests, onSaved, canEdit = true }) {
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);

  const draftOf = (it) =>
    drafts[it.id] || { price: it.unit_price != null ? String(it.unit_price) : "", unavailable: it.unavailable };
  const setDraft = (it, patch) => setDrafts((d) => ({ ...d, [it.id]: { ...draftOf(it), ...patch } }));

  const save = async (r) => {
    setSavingId(r.submission_id);
    setError(null);
    try {
      const items = r.items.map((it) => {
        const d = draftOf(it);
        const digits = String(d.price).replace(/[^0-9.]/g, "");
        return { id: it.id, unavailable: d.unavailable, unit_price: d.unavailable || digits === "" ? null : Number(digits) };
      });
      const res = await fetch(`/api/vm/service-requests/${r.submission_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Save failed");
      }
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => !r.items.some((it) => String(it.id) === id))));
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  };

  if (requests.length === 0) return <p className="text-sm text-ink-400">No additional-service requests.</p>;

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {requests.map((r) => (
        <div key={r.submission_id} className="bg-white rounded-xl border border-ink-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="font-semibold">{r.shipper_name || `Submission #${r.submission_id}`}</span>
              <span className="ml-2 text-xs text-ink-400">
                {r.sales_pic || r.requested_by} · {r.created_at} · {r.aging_days}d
              </span>
            </div>
            <span
              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                r.status === "done" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {r.status === "done" ? "Done" : "Open"}
            </span>
          </div>

          {r.lanes.some((l) => l.vendor) && (
            <div className="mb-3 text-xs text-ink-500">
              <p className="font-medium mb-1">Winning vendor per lane:</p>
              <ul className="space-y-0.5">
                {r.lanes.map((l, i) => (
                  <li key={i}>
                    {l.origin} → {l.destination} ({l.vehicle_type}): <span className="font-medium text-ink-700">{l.vendor || "-"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <table className="w-full">
            <thead>
              <tr>
                <Th>Service</Th>
                <Th>Sales notes</Th>
                <Th>Price per unit (IDR)</Th>
                <Th>Tidak tersedia</Th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((it) => {
                const d = draftOf(it);
                return (
                  <tr key={it.id}>
                    <Td className="font-medium">{it.label}</Td>
                    <Td className="text-ink-500">{it.note || "-"}</Td>
                    <Td>
                      {!canEdit ? (
                        <span className="text-sm">
                          {it.unavailable ? "Not available" : it.unit_price != null ? `${fmt(it.unit_price)} ${it.unit}` : "Waiting for VM"}
                        </span>
                      ) : (
                      <div className="flex items-center gap-2">
                        <input
                          className="w-36 border border-ink-200 rounded px-2 py-1 text-sm disabled:bg-ink-50"
                          disabled={d.unavailable}
                          value={d.unavailable ? "" : d.price}
                          onChange={(e) => setDraft(it, { price: e.target.value })}
                        />
                        <span className="text-xs text-ink-400">{it.unit}</span>
                      </div>
                      )}
                    </Td>
                    <Td>
                      <input type="checkbox" disabled={!canEdit} checked={d.unavailable} onChange={(e) => setDraft(it, { unavailable: e.target.checked })} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {canEdit && <div className="flex justify-end mt-2">
            <button
              onClick={() => save(r)}
              disabled={savingId === r.submission_id}
              className="px-4 py-1.5 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {savingId === r.submission_id ? "Saving…" : "Save"}
            </button>
          </div>}
        </div>
      ))}
    </div>
  );
}


// VM: master rates panel
// ---------------------------------------------------------------------------

export function MasterRatesPanel() {
  const [meta, setMeta] = useState(null);
  const [rates, setRates] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [vehicle, setVehicle] = useState("");
  const [picked, setPicked] = useState(new Set());
  const [action, setAction] = useState(null); // null | "revoke" | "valid"
  const [reason, setReason] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);

  const loadMeta = () => fetch("/api/master-rates/meta").then((r) => r.json()).then(setMeta);
  const loadRates = () =>
    fetch("/api/master-rates")
      .then((r) => r.json())
      .then((d) => setRates(d.rates));
  useEffect(() => {
    loadMeta();
    loadRates();
  }, []);

  const onUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setOk(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/master-rates/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Upload failed");
      }
      const data = await res.json();
      setOk(
        `Saved ${data.row_count} vendor rate row(s).` +
          (data.resolved_count > 0 ? ` Auto-resolved ${data.resolved_count} matching VM request(s).` : "")
      );
      loadMeta();
      loadRates();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const ddmmyyyy = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "–");
  const laneKey = (r) => [r.origin, r.destination, r.vehicle_type].map((x) => x.trim().toLowerCase()).join("|");
  const activeCount = {};
  for (const r of rates || []) if (r.status === "active") activeCount[laneKey(r)] = (activeCount[laneKey(r)] || 0) + 1;

  const vehicles = [...new Set((rates || []).map((r) => r.vehicle_type))].sort();
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (rates || [])
    .filter((r) => statusFilter === "all" || r.status === statusFilter)
    .filter((r) => !vehicle || r.vehicle_type === vehicle)
    .filter((r) => words.every((w) => `${r.origin} ${r.destination} ${r.vendor_name}`.toLowerCase().includes(w)));
  const LIMIT = 500;
  const shown = rows.slice(0, LIMIT);
  const pickedRows = (rates || []).filter((r) => picked.has(r.id));
  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.id));
  const counts = { active: 0, expired: 0, revoked: 0 };
  for (const r of rates || []) counts[r.status] = (counts[r.status] || 0) + 1;

  const togglePick = (id) =>
    setPicked((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAllShown = () =>
    setPicked((p) => {
      const n = new Set(p);
      if (allShownPicked) shown.forEach((r) => n.delete(r.id));
      else shown.forEach((r) => n.add(r.id));
      return n;
    });

  const run = async (path, body, doneMsg) => {
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await fetch(`/api/master-rates/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...picked], ...body }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.detail || "That didn't work.");
      return;
    }
    setOk(doneMsg);
    setPicked(new Set());
    setAction(null);
    setReason("");
    setValidUntil("");
    loadRates();
  };

  const STATUS_PILL = {
    active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    expired: "bg-amber-50 text-amber-800 ring-amber-200",
    revoked: "bg-red-50 text-red-700 ring-red-200",
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4">
        <h2 className="font-semibold mb-2">Upload vendor rates</h2>
        <p className="text-sm text-ink-500 mb-3">
          Columns: Origin L2 | Destinasi L2 | Vehicle Type | Cost/Rate | Vendor Name | Valid Until (optional, DD-MM-YYYY).{" "}
          <a href={MASTER_RATE_TEMPLATE_URL} download="master_vendor_rate_template.csv" className="text-brand-600 hover:underline">
            Download template
          </a>
          . A row for an existing lane + vendor updates its cost (and makes it active again if it was revoked); rates not in
          the file stay as they are.
        </p>
        <input type="file" accept=".csv" onChange={onUpload} disabled={uploading} />
        {uploading && <p className="text-sm text-ink-500 mt-2">Processing…</p>}
        {meta?.created_at ? (
          <p className="text-xs text-ink-400 mt-3">
            Last upload {meta.created_at} by {meta.uploaded_by}: {meta.row_count} row(s)
            {meta.filename ? ` (${meta.filename})` : ""}.
          </p>
        ) : (
          <p className="text-xs text-ink-400 mt-3">No master rates loaded yet.</p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {ok && <p className="text-sm text-green-700">{ok}</p>}

      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search origin, destination or vendor"
            className="flex-1 min-w-[220px] border border-ink-200 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:border-brand-600"
          />
          <div className="flex p-1 bg-ink-100 rounded-lg">
            {[
              ["active", `Active (${counts.active})`],
              ["expired", `Expired (${counts.expired})`],
              ["revoked", `Revoked (${counts.revoked})`],
              ["all", "All"],
            ].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setStatusFilter(k)}
                className={`px-3 py-1 rounded-md text-sm font-medium ${statusFilter === k ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="border border-ink-200 rounded-md px-2 py-2 text-sm bg-white">
            <option value="">All vehicles</option>
            {vehicles.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <a href="/api/master-rates/export" className="text-sm px-3 py-2 rounded-md border border-ink-200 bg-white hover:bg-ink-50">
            Download active rates
          </a>
        </div>

        {picked.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-lg bg-brand-50 ring-1 ring-brand-200 text-sm">
            <span className="font-medium">{picked.size} selected</span>
            <button onClick={() => setAction(action === "revoke" ? null : "revoke")} className="px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700">
              Revoke
            </button>
            {pickedRows.some((r) => r.status === "revoked") && (
              <button
                disabled={busy}
                onClick={() => run("restore", {}, "Rates restored. Open tickets on those lanes were re-checked.")}
                className="px-3 py-1.5 rounded-md border border-ink-200 bg-white hover:bg-ink-50"
              >
                Restore
              </button>
            )}
            <button onClick={() => setAction(action === "valid" ? null : "valid")} className="px-3 py-1.5 rounded-md border border-ink-200 bg-white hover:bg-ink-50">
              Set valid until
            </button>
            <button onClick={() => setPicked(new Set())} className="text-ink-500 hover:underline ml-auto">
              Clear selection
            </button>
            {action === "revoke" && (
              <div className="w-full flex flex-wrap items-center gap-2 pt-2">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason, e.g. vendor no longer serves this lane"
                  className="flex-1 min-w-[260px] border border-ink-200 rounded-md px-3 py-1.5 bg-white"
                />
                <button
                  disabled={busy || !reason.trim()}
                  onClick={() => run("revoke", { reason }, "Rates revoked. They're no longer used for new prices.")}
                  className="px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
                >
                  Revoke {picked.size}
                </button>
                <span className="text-xs text-ink-500 w-full">Quotes already given keep their final rate. Revoked rates stay in history and can be restored.</span>
              </div>
            )}
            {action === "valid" && (
              <div className="w-full flex flex-wrap items-center gap-2 pt-2">
                <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="border border-ink-200 rounded-md px-2 py-1.5 bg-white" />
                <button
                  disabled={busy || !validUntil}
                  onClick={() => run("valid-until", { valid_until: validUntil }, "Valid-until date set.")}
                  className="px-3 py-1.5 rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  Apply to {picked.size}
                </button>
                <button
                  disabled={busy}
                  onClick={() => run("valid-until", { valid_until: null }, "Valid-until date removed.")}
                  className="px-3 py-1.5 rounded-md border border-ink-200 bg-white hover:bg-ink-50"
                >
                  Remove date
                </button>
                <span className="text-xs text-ink-500 w-full">After this date the rates stop being used for pricing automatically.</span>
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60">
              <tr className="text-left text-xs text-ink-500">
                <th className="px-3 py-2.5 w-8">
                  <input type="checkbox" checked={allShownPicked} onChange={toggleAllShown} aria-label="Select all shown" />
                </th>
                <th className="px-3 py-2.5 font-medium">Origin</th>
                <th className="px-3 py-2.5 font-medium">Destination</th>
                <th className="px-3 py-2.5 font-medium">Vehicle</th>
                <th className="px-3 py-2.5 font-medium">Vendor</th>
                <th className="px-3 py-2.5 font-medium text-right">Cost</th>
                <th className="px-3 py-2.5 font-medium">Valid until</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Updated by</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={`border-t border-ink-100 ${picked.has(r.id) ? "bg-brand-50/60" : ""} ${r.status !== "active" ? "text-ink-500" : ""}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => togglePick(r.id)} aria-label={`Select ${r.vendor_name} ${r.origin} to ${r.destination}`} />
                  </td>
                  <td className="px-3 py-2">{r.origin}</td>
                  <td className="px-3 py-2">{r.destination}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.vehicle_type}
                    {r.status === "active" && activeCount[laneKey(r)] === 1 && <OnlyOneVendorBadge />}
                  </td>
                  <td className="px-3 py-2">{r.vendor_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.cost)}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{ddmmyyyy(r.valid_until)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset capitalize ${STATUS_PILL[r.status]}`}>{r.status}</span>
                    {r.status === "revoked" && (
                      <p className="text-xs text-ink-500 mt-0.5 max-w-[220px]">
                        {r.revoke_reason} · {r.revoked_by}, {ddmmyyyy(r.revoked_at)}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-400">{r.updated_by}</td>
                </tr>
              ))}
              {rates && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-sm text-ink-400">
                    No rates match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-ink-400 border-t border-ink-100">
            {!rates ? "Loading…" : `Showing ${shown.length} of ${rows.length} matching (${rates.length} total).`}
            {rows.length > LIMIT && " Narrow the search to see the rest."}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VM: prioritization (with view-more + per-column filters)
// ---------------------------------------------------------------------------

export function LaneFilterTable({ lanes, onClose, showAvgTarget, hideCollapse }) {
  const [filters, setFilters] = useState({ origin: "", destination: "", vehicle_type: "" });
  const filtered = lanes.filter(
    (l) =>
      l.origin.toLowerCase().includes(filters.origin.toLowerCase()) &&
      l.destination.toLowerCase().includes(filters.destination.toLowerCase()) &&
      l.vehicle_type.toLowerCase().includes(filters.vehicle_type.toLowerCase())
  );
  return (
    <div className={hideCollapse ? "" : "mt-3 border border-gray-200 rounded"}>
      {!hideCollapse && (
        <div className="flex justify-end p-2 border-b border-ink-100">
          <button onClick={onClose} className="text-xs text-ink-500 hover:underline">
            Collapse
          </button>
        </div>
      )}
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr>
              <Th>Origin</Th>
              <Th>Destination</Th>
              <Th>Vehicle</Th>
              <Th>Requests</Th>
              {showAvgTarget && <Th>Avg Target Rate</Th>}
            </tr>
            <tr>
              <Td>
                <input
                  className="w-full border border-ink-200 rounded px-1.5 py-1 text-xs"
                  placeholder="Filter…"
                  value={filters.origin}
                  onChange={(e) => setFilters((f) => ({ ...f, origin: e.target.value }))}
                />
              </Td>
              <Td>
                <input
                  className="w-full border border-ink-200 rounded px-1.5 py-1 text-xs"
                  placeholder="Filter…"
                  value={filters.destination}
                  onChange={(e) => setFilters((f) => ({ ...f, destination: e.target.value }))}
                />
              </Td>
              <Td>
                <input
                  className="w-full border border-ink-200 rounded px-1.5 py-1 text-xs"
                  placeholder="Filter…"
                  value={filters.vehicle_type}
                  onChange={(e) => setFilters((f) => ({ ...f, vehicle_type: e.target.value }))}
                />
              </Td>
              <Td></Td>
              {showAvgTarget && <Td></Td>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((l, i) => (
              <tr key={i}>
                <Td>{l.origin}</Td>
                <Td>{l.destination}</Td>
                <Td>{l.vehicle_type}</Td>
                <Td>{l.request_count}</Td>
                {showAvgTarget && <Td>{l.avg_target_rate != null ? fmt(l.avg_target_rate) : "-"}</Td>}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <Td className="text-ink-400" colSpan={showAvgTarget ? 5 : 4}>No matches</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PrioritizationSection({ title, lanes, showAvgTarget, onViewMore, lanesKey }) {
  return (
    <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>Origin</Th>
            <Th>Destination</Th>
            <Th>Vehicle</Th>
            <Th>Requests</Th>
            {showAvgTarget && <Th>Avg Target Rate</Th>}
          </tr>
        </thead>
        <tbody>
          {lanes.slice(0, 10).map((l, i) => (
            <tr key={i}>
              <Td>{l.origin}</Td>
              <Td>{l.destination}</Td>
              <Td>{l.vehicle_type}</Td>
              <Td>{l.request_count}</Td>
              {showAvgTarget && <Td>{l.avg_target_rate != null ? fmt(l.avg_target_rate) : "-"}</Td>}
            </tr>
          ))}
          {lanes.length === 0 && (
            <tr>
              <Td className="text-ink-400" colSpan={showAvgTarget ? 5 : 4}>None</Td>
            </tr>
          )}
        </tbody>
      </table>
      {lanes.length >= 10 && (
        <button onClick={() => onViewMore(lanesKey, title)} className="mt-2 text-sm text-brand-600 hover:underline">
          View more
        </button>
      )}
    </div>
  );
}

export function PrioritizationFullPage({ lanesKey, title, showAvgTarget, onBack, days = 90 }) {
  const [lanes, setLanes] = useState(null);

  useEffect(() => {
    fetch(`/api/vm/summary?limit=500&days=${days}`)
      .then((r) => r.json())
      .then((d) => setLanes(d[lanesKey]));
  }, [lanesKey, days]);

  return (
    <div>
      <button onClick={onBack} className="text-sm text-ink-500 hover:underline mb-3">
        ← Back to Prioritization
      </button>
      <h2 className="font-semibold text-lg mb-3">{title}</h2>
      <div className="bg-white rounded-xl border border-ink-100 shadow-sm">
        {lanes ? (
          <LaneFilterTable lanes={lanes} onClose={onBack} showAvgTarget={showAvgTarget} hideCollapse />
        ) : (
          <p className="text-sm text-ink-400 p-4">Loading…</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VM: per-request resolve panel
// ---------------------------------------------------------------------------

export function ResolveRequestPanel({ request, onDone, onCancel }) {
  const emptyRow = { vendor_choice: "", vendor_name: "", cost: "" };
  const [vendorRows, setVendorRows] = useState([emptyRow]);
  const [knownVendors, setKnownVendors] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideOther, setOverrideOther] = useState("");

  useEffect(() => {
    fetch("/api/master-rates/vendors")
      .then((r) => r.json())
      .then((d) => setKnownVendors(d.vendors || []))
      .catch(() => {});
  }, []);

  const updateRow = (i, field, value) => {
    setVendorRows((rows) => rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  };
  const effectiveVendor = (r) => (r.vendor_choice === "__other__" ? r.vendor_name : r.vendor_choice).trim();
  const addRow = () => setVendorRows((rows) => [...rows, emptyRow]);
  const removeRow = (i) => setVendorRows((rows) => rows.filter((_, j) => j !== i));

  const submitManual = async () => {
    setBusy(true);
    setError(null);
    try {
      const vendor_costs = vendorRows
        .filter((r) => effectiveVendor(r) && Number(r.cost) > 0)
        .map((r) => ({ vendor_name: effectiveVendor(r), cost: Number(r.cost) }));
      if (vendor_costs.length === 0) {
        setError("Enter at least one vendor name and cost");
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/vm/requests/${request.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor_costs }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to resolve");
      }
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitCsv = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/vm/requests/${request.id}/resolve-upload`, { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to resolve from CSV");
      }
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const submitOverride = async () => {
    const reason = overrideReason === "Other…" ? `Other: ${overrideOther.trim()}` : overrideReason;
    if (!overrideReason || (overrideReason === "Other…" && !overrideOther.trim())) {
      setError("Pick a reason for using the single vendor");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vm/requests/${request.id}/use-single-vendor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to approve the single vendor");
      }
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const closeNoVendor = async () => {
    const msg =
      request.current_final_rate != null
        ? "Close this ticket as 'no lower rate found'? The existing Final Rate stays as the standing quote."
        : "Close this ticket as 'no vendor available'? This cannot supply a rate for this OD.";
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await fetch(`/api/vm/requests/${request.id}/close-no-vendor`, { method: "POST" });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">
          {request.origin} → {request.destination} · {request.vehicle_type}
        </h3>
        <button onClick={onCancel} className="text-xs text-ink-500 hover:underline">Close</button>
      </div>
      {request.target_cost != null && (
        <p className="text-sm text-ink-500 mb-3">Target cost to beat: <span className="font-medium">{fmt(request.target_cost)}</span></p>
      )}

      {request.only_one_vendor && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-800">Only 1 Vendor on this lane</p>
          <p className="text-xs text-amber-800 mt-0.5">
            Sales sees no rate until a second vendor is added. Add another vendor below, or price this ticket
            from the only vendor — that approval applies to this ticket only and sales will see the rate
            marked "Confirmed by VM".
          </p>
          {!overrideOpen ? (
            <button
              onClick={() => setOverrideOpen(true)}
              className="mt-2 text-xs px-2 py-1 rounded border border-amber-300 bg-white hover:bg-amber-100"
            >
              Price from the only vendor anyway…
            </button>
          ) : (
            <div className="mt-2 space-y-2">
              <select
                className="w-full border border-ink-200 rounded px-2 py-1 text-sm bg-white"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              >
                <option value="">Reason…</option>
                <option value="No other vendor serves this lane">No other vendor serves this lane</option>
                <option value="Dedicated/contract rate">Dedicated/contract rate</option>
                <option value="Other…">Other…</option>
              </select>
              {overrideReason === "Other…" && (
                <input
                  placeholder="Explain why"
                  className="w-full border border-ink-200 rounded px-2 py-1 text-sm"
                  value={overrideOther}
                  onChange={(e) => setOverrideOther(e.target.value)}
                />
              )}
              <div className="flex gap-3">
                <button
                  onClick={submitOverride}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded bg-brand-600 text-white hover:bg-brand-700"
                >
                  Approve & price
                </button>
                <button onClick={() => setOverrideOpen(false)} className="text-xs text-ink-500 hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 mb-3">
        <p className="text-xs text-ink-500 uppercase font-semibold">Enter vendor cost(s)</p>
        {vendorRows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <select
                className="border border-ink-200 rounded px-2 py-1 text-sm bg-white"
                value={r.vendor_choice}
                onChange={(e) => updateRow(i, "vendor_choice", e.target.value)}
              >
                <option value="">Select vendor…</option>
                {knownVendors.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
                <option value="__other__">Others…</option>
              </select>
              {r.vendor_choice === "__other__" && (
                <input
                  placeholder="Vendor name"
                  className="border border-ink-200 rounded px-2 py-1 text-sm"
                  value={r.vendor_name}
                  onChange={(e) => updateRow(i, "vendor_name", e.target.value)}
                />
              )}
            </div>
            <input
              placeholder="Cost"
              type="number"
              className="w-40 border border-ink-200 rounded px-2 py-1 text-sm"
              value={r.cost}
              onChange={(e) => updateRow(i, "cost", e.target.value)}
            />
            {vendorRows.length > 1 && (
              <button onClick={() => removeRow(i)} className="text-xs text-red-500">✕</button>
            )}
          </div>
        ))}
        <button onClick={addRow} className="text-xs text-brand-600 hover:underline">+ Add vendor</button>
      </div>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={submitManual}
          disabled={busy}
          className="px-3 py-1.5 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700"
        >
          Save & Resolve
        </button>
        <span className="text-xs text-ink-400">or</span>
        <label className="text-sm text-brand-600 hover:underline cursor-pointer">
          Upload CSV for this lane
          <input type="file" accept=".csv" className="hidden" onChange={submitCsv} disabled={busy} />
        </label>
        <span className="flex-1" />
        <button onClick={closeNoVendor} disabled={busy} className="text-sm text-red-600 hover:underline">
          {request.current_final_rate != null
            ? "Close — no lower rate found (keeps current rate)"
            : "Close — no vendor available"}
        </button>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// VM: ticket badges and detail pieces (used by the shared ticket queue)
// ---------------------------------------------------------------------------

export const UNKNOWN_SHIPPER = "Ad-hoc / unknown shipper";

export function OnlyOneVendorBadge() {
  return (
    <span className="ml-2 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
      Only 1 Vendor
    </span>
  );
}

const PERIODS = [
  [30, "Last 30 days"],
  [90, "Last 90 days"],
  [365, "Last 12 months"],
  [0, "All time"],
];

export function PrioritizationScreen() {
  const [summary, setSummary] = useState(null);
  const [fullView, setFullView] = useState(null); // null | { key, title }
  const [days, setDays] = useState(90);
  useEffect(() => {
    setSummary(null);
    fetch(`/api/vm/summary?days=${days}`).then((r) => r.json()).then(setSummary);
  }, [days]);

  if (fullView) {
    return (
      <PrioritizationFullPage
        lanesKey={fullView.key}
        title={fullView.title}
        showAvgTarget={fullView.key === "seeking_lower_rate"}
        days={days}
        onBack={() => setFullView(null)}
      />
    );
  }
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-ink-500">Counting requests raised in</span>
        <div className="flex p-1 bg-ink-100 rounded-lg">
          {PERIODS.map(([d, l]) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 rounded-md text-sm font-medium ${days === d ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {!summary ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : (
    <div className="grid lg:grid-cols-2 gap-6">
      <div>
        <PrioritizationSection
          title="Seeking a lower rate"
          lanes={summary.seeking_lower_rate}
          showAvgTarget
          lanesKey="seeking_lower_rate"
          onViewMore={(key, title) => setFullView({ key, title })}
        />
        <p className="text-xs text-ink-500 mt-2">
          Lanes that already have a final rate where sales asked for a lower one, including requests closed as
          "no lower rate found". Avg target rate averages every request on the lane.
        </p>
      </div>
      <div>
        <PrioritizationSection
          title="Confirmed no vendor available"
          lanes={summary.missing_lanes}
          lanesKey="missing_lanes"
          onViewMore={(key, title) => setFullView({ key, title })}
        />
        <p className="text-xs text-ink-500 mt-2">
          Lanes closed as "no vendor available", counted by how often. Repeat lanes are worth another vendor push. A lane
          drops off as soon as it has an active vendor rate again (e.g. after an upload).
        </p>
      </div>
    </div>
      )}
    </div>
  );
}

export function ServicesScreen({ canEdit }) {
  const [requests, setRequests] = useState([]);
  const load = () =>
    fetch("/api/vm/service-requests")
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => setRequests(d.requests));
  useEffect(() => {
    load();
  }, []);
  const open = requests.filter((r) => r.status === "open");
  const done = requests.filter((r) => r.status === "done");
  return (
    <div className="space-y-6">
      {open.length === 0 && <p className="text-sm text-ink-400">No open service requests.</p>}
      <VmServiceRequests requests={open} onSaved={load} canEdit={canEdit} />
      {done.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-ink-500 uppercase mb-2">Done</h3>
          <VmServiceRequests requests={done} onSaved={load} canEdit={canEdit} />
        </div>
      )}
    </div>
  );
}
