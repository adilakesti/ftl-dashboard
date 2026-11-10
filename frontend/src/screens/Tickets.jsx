import { useEffect, useMemo, useState } from "react";
import { L2_LOCATIONS, VEHICLE_TYPES, canonicalL2 } from "../l2Locations.js";
import { Discussion, STATUS_LABEL } from "../shared.jsx";
import { AgePill, StatTile, StatusBadge, isOpenStatus, rp } from "./Queue.jsx";
import { OnlyOneVendorBadge, ResolveRequestPanel } from "./Vm.jsx";

// A ticket is one submitted rate request: a shipper and several lanes (OD + vehicle).
// Dashboard Ticket lists every ticket for everyone; the VM queue lists only the ones
// with lanes VM still has to answer. Clicking a ticket opens its detail page.

export const ticketNo = (id) => `FTL-${String(id).padStart(6, "0")}`;

function ticketState(t) {
  if (t.vm_working_count > 0) return { label: `VM working · ${t.vm_open_count}`, tone: "warning" };
  if (t.vm_open_count > 0) return { label: `Waiting on VM · ${t.vm_open_count}`, tone: "info" };
  return { label: "Complete", tone: "ok" };
}

const PILL = {
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  neutral: "bg-ink-50 text-ink-600 ring-ink-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
};

function Pill({ tone = "neutral", children }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset whitespace-nowrap ${PILL[tone]}`}>
      {children}
    </span>
  );
}

const fmtDate = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "–");

// ---------------------------------------------------------------------------
// Ticket list (Dashboard Ticket and VM queue)
// ---------------------------------------------------------------------------

export function TicketBoard({ mode = "all", onOpen, initialSearch = "" }) {
  const [tickets, setTickets] = useState(null);
  const [search, setSearch] = useState(initialSearch);
  const [stateFilter, setStateFilter] = useState(mode === "vm" ? "vm" : "all"); // all | vm | done
  const [sort, setSort] = useState(mode === "vm" ? "oldest-open" : "newest");

  useEffect(() => setSearch(initialSearch), [initialSearch]);
  useEffect(() => {
    setTickets(null);
    fetch(`/api/ticket-board${mode === "vm" ? "?vm_only=true" : ""}`)
      .then((r) => (r.ok ? r.json() : { tickets: [] }))
      .then((d) => setTickets(d.tickets));
  }, [mode]);

  const rows = useMemo(() => {
    if (!tickets) return [];
    const q = search.trim().toLowerCase();
    const list = tickets
      .filter((t) => (stateFilter === "vm" ? t.vm_open_count > 0 : stateFilter === "done" ? t.vm_open_count === 0 : true))
      .filter(
        (t) =>
          !q ||
          [t.ticket_no, t.shipper_name, t.sales_pic, t.raised_by, ...t.vehicles].filter(Boolean).join(" ").toLowerCase().includes(q)
      );
    const sorters = {
      newest: (a, b) => String(b.raised_at).localeCompare(String(a.raised_at)) || b.id - a.id,
      oldest: (a, b) => String(a.raised_at).localeCompare(String(b.raised_at)) || a.id - b.id,
      "oldest-open": (a, b) => (b.oldest_open_days ?? -1) - (a.oldest_open_days ?? -1) || b.id - a.id,
    };
    return list.sort(sorters[sort]);
  }, [tickets, search, stateFilter, sort]);

  if (!tickets) return <p className="text-sm text-ink-400">Loading tickets…</p>;

  const needVm = tickets.filter((t) => t.vm_open_count > 0).length;
  const lanesWaiting = tickets.reduce((n, t) => n + t.vm_open_count, 0);

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatTile label={mode === "vm" ? "Tickets in VM queue" : "Tickets raised"} value={tickets.length} onClick={() => setStateFilter("all")} active={stateFilter === "all"} />
        <StatTile label="Need VM" value={needVm} tone={needVm ? "warning" : undefined} onClick={() => setStateFilter("vm")} active={stateFilter === "vm"} />
        <StatTile label="Lanes waiting on VM" value={lanesWaiting} />
        {mode !== "vm" && <StatTile label="Complete" value={tickets.length - needVm} onClick={() => setStateFilter("done")} active={stateFilter === "done"} />}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticket no., shipper, sales, vehicle"
          className="flex-1 min-w-[220px] border border-ink-200 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:border-brand-600"
        />
        {mode !== "vm" && (
          <div className="flex p-1 bg-ink-100 rounded-lg">
            {[
              ["all", "All"],
              ["vm", "Need VM"],
              ["done", "Complete"],
            ].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setStateFilter(k)}
                className={`px-3 py-1 rounded-md text-sm font-medium ${stateFilter === k ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"}`}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="border border-ink-200 rounded-md px-2 py-2 text-sm bg-white">
          <option value="newest">Newest raised first</option>
          <option value="oldest">Oldest raised first</option>
          <option value="oldest-open">Longest waiting on VM</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-50/60">
            <tr className="text-left text-xs text-ink-500">
              <th className="px-3 py-2.5 font-medium">Ticket no.</th>
              <th className="px-3 py-2.5 font-medium">Raised</th>
              <th className="px-3 py-2.5 font-medium">Shipper</th>
              <th className="px-3 py-2.5 font-medium text-right">Lanes</th>
              <th className="px-3 py-2.5 font-medium">Vehicles</th>
              <th className="px-3 py-2.5 font-medium">Target rate</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const st = ticketState(t);
              return (
                <tr key={t.id} onClick={() => onOpen(t.id)} className="border-t border-ink-100 cursor-pointer hover:bg-ink-50">
                  <td className="px-3 py-2.5 font-medium text-brand-700 whitespace-nowrap tabular-nums">{t.ticket_no}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-600 tabular-nums">{fmtDate(t.raised_at)}</td>
                  <td className="px-3 py-2.5 max-w-[240px]">
                    <p className="font-medium text-ink-900 truncate">{t.shipper_name || "–"}</p>
                    <p className="text-xs text-ink-500 truncate">
                      {t.sales_pic || t.raised_by}
                      {t.editable && <span className="ml-1.5 text-brand-700">· editable</span>}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{t.lane_count}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {t.vehicles.map((v) => (
                        <span key={v} className="px-1.5 py-0.5 rounded bg-ink-100 text-ink-700 text-xs whitespace-nowrap">
                          {v}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{t.has_target_rate ? <Pill tone="info">Yes</Pill> : <Pill>No</Pill>}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Pill tone={st.tone}>{st.label}</Pill>
                      {t.oldest_open_days != null && <AgePill t={{ status: "open", aging_days: t.oldest_open_days }} />}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-ink-400">
                  {mode === "vm" ? "Nothing waiting on VM." : "No tickets match."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-ink-400 border-t border-ink-100">
          {rows.length} of {tickets.length} tickets
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket detail: every OD pair, its price or VM status, VM feedback, owner edits
// ---------------------------------------------------------------------------

function LaneResult({ row, req }) {
  if (req) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusBadge status={req.status} />
        {isOpenStatus(req.status) && <AgePill t={req} />}
        {req.only_one_vendor && isOpenStatus(req.status) && <OnlyOneVendorBadge />}
      </div>
    );
  }
  if (row.final_rate != null) return <Pill tone="ok">Priced automatically</Pill>;
  return <Pill>{row.remarks || "No rate"}</Pill>;
}

function EditLaneRow({ row, ticketId, onSaved, onCancel }) {
  const known = VEHICLE_TYPES.includes(row.vehicle_type);
  const [f, setF] = useState({
    origin: row.origin,
    destination: row.destination,
    vehicle_choice: known ? row.vehicle_type : "__other__",
    vehicle_type: known ? "" : row.vehicle_type,
    target_rate: row.target_rate != null ? String(Math.round(row.target_rate)) : "",
    min_trip: row.min_trip != null ? String(row.min_trip) : "",
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const vehicle = (f.vehicle_choice === "__other__" ? f.vehicle_type : f.vehicle_choice).trim();

  const save = async () => {
    const origin = canonicalL2(f.origin);
    const destination = canonicalL2(f.destination);
    if (!origin || !destination) return setError("Pick origin and destination from the L2 list.");
    if (!vehicle) return setError("Pick a vehicle.");
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/submissions/${ticketId}/rows/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin,
        destination,
        vehicle_type: vehicle,
        target_rate: f.target_rate ? Number(f.target_rate.replace(/[^0-9]/g, "")) : null,
        min_trip: f.min_trip ? Number(f.min_trip) : null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setError(b.detail || "Couldn't save this lane.");
    }
    onSaved(await res.json());
  };

  const input = "border border-ink-200 rounded-md px-2 py-1.5 text-sm bg-white w-full focus:outline-none focus:border-brand-600";
  return (
    <tr className="border-t border-ink-100 bg-brand-50/40">
      <td className="px-3 py-2 text-ink-400 text-xs align-top pt-3">{row.idx}</td>
      <td className="px-2 py-2 align-top">
        <input list="dl-l2" value={f.origin} onChange={(e) => set("origin", e.target.value)} className={input} aria-label="Origin" />
      </td>
      <td className="px-2 py-2 align-top">
        <input list="dl-l2" value={f.destination} onChange={(e) => set("destination", e.target.value)} className={input} aria-label="Destination" />
      </td>
      <td className="px-2 py-2 align-top">
        <select value={f.vehicle_choice} onChange={(e) => set("vehicle_choice", e.target.value)} className={input} aria-label="Vehicle">
          {VEHICLE_TYPES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
          <option value="__other__">Others…</option>
        </select>
        {f.vehicle_choice === "__other__" && (
          <input value={f.vehicle_type} onChange={(e) => set("vehicle_type", e.target.value)} placeholder="Vehicle type" className={`${input} mt-1`} />
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <input inputMode="numeric" value={f.target_rate} onChange={(e) => set("target_rate", e.target.value)} placeholder="Optional" className={`${input} text-right`} aria-label="Target rate" />
      </td>
      <td className="px-2 py-2 align-top">
        <input inputMode="numeric" value={f.min_trip} onChange={(e) => set("min_trip", e.target.value.replace(/[^0-9]/g, ""))} className={`${input} text-right w-20`} aria-label="Minimum trips" />
      </td>
      <td colSpan={3} className="px-2 py-2 align-top">
        <div className="flex gap-2">
          <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save and re-price"}
          </button>
          <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-sm border border-ink-200 bg-white hover:bg-ink-50">
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </td>
    </tr>
  );
}

export function TicketDetail({ ticketId, perms, onBack }) {
  const [detail, setDetail] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [feedbackFor, setFeedbackFor] = useState(null); // vm request id
  const [busyRow, setBusyRow] = useState(null);

  const load = () => {
    fetch(`/api/submissions/${ticketId}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json().catch(() => ({}))).detail || "Ticket not found")))
      .then(setDetail)
      .catch((e) => setError(String(e)));
    fetch(`/api/vm/requests?submission_id=${ticketId}`)
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => setReqs(d.requests));
  };
  useEffect(() => {
    setDetail(null);
    setError(null);
    setEditingId(null);
    setFeedbackFor(null);
    load();
  }, [ticketId]);

  // Latest request per lane (a lane can be asked more than once).
  const reqByRow = useMemo(() => {
    const m = {};
    for (const r of reqs) if (!m[r.submission_row_id] || r.id > m[r.submission_row_id].id) m[r.submission_row_id] = r;
    return m;
  }, [reqs]);

  if (error) {
    return (
      <div>
        <button onClick={onBack} className="text-sm text-brand-600 hover:underline mb-3">
          ← Back
        </button>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!detail) return <p className="text-sm text-ink-400">Loading ticket…</p>;

  const s = detail.submission;
  const rows = detail.rows.map((r, i) => ({ ...r, idx: i + 1 }));
  const feedbackReq = reqs.find((r) => r.id === feedbackFor);
  const openCount = rows.filter((r) => reqByRow[r.id] && isOpenStatus(reqByRow[r.id].status)).length;

  const setStatus = async (req, status) => {
    await fetch(`/api/vm/requests/${req.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const askVm = async (row) => {
    setBusyRow(row.id);
    await fetch("/api/vm-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submission_row_id: row.id,
        origin: row.origin,
        destination: row.destination,
        vehicle_type: row.vehicle_type,
        target_rate: row.target_rate,
        current_final_rate: row.final_rate,
      }),
    });
    setBusyRow(null);
    load();
  };

  return (
    <div>
      <datalist id="dl-l2">
        {L2_LOCATIONS.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>

      <button onClick={onBack} className="text-sm text-brand-600 hover:underline mb-3">
        ← All tickets
      </button>

      <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4 mb-5">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
          <div>
            <p className="text-xs text-ink-500">Ticket</p>
            <p className="text-lg font-semibold text-brand-700 tabular-nums">{detail.ticket_no || ticketNo(s.id)}</p>
          </div>
          <div className="min-w-[180px]">
            <p className="text-xs text-ink-500">Shipper</p>
            <p className="font-medium">{s.shipper_name || "–"}</p>
            <p className="text-xs text-ink-500 capitalize">{s.shipper_status}</p>
          </div>
          <div>
            <p className="text-xs text-ink-500">Sales PIC</p>
            <p>{s.sales_pic || s.uploaded_by}</p>
          </div>
          <div>
            <p className="text-xs text-ink-500">Raised</p>
            <p className="tabular-nums">{fmtDate(s.submitted_at || s.created_at)}</p>
          </div>
          <div>
            <p className="text-xs text-ink-500">Commodity</p>
            <p>
              {s.commodity_type || "–"}
              {s.high_value_fragile && <span className="text-amber-700"> · high value / fragile</span>}
            </p>
          </div>
          <div>
            <p className="text-xs text-ink-500">Potential / month</p>
            <p className="tabular-nums">{rp(s.potential_monthly_revenue)}</p>
          </div>
          {s.add_ons?.length > 0 && (
            <div>
              <p className="text-xs text-ink-500">Extra services</p>
              <p>{s.add_ons.map((a) => (a.value ? `${a.label} (${a.value})` : a.label)).join(", ")}</p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <Pill tone={openCount ? "warning" : "ok"}>{openCount ? `${openCount} lane${openCount > 1 ? "s" : ""} waiting on VM` : "No lanes waiting on VM"}</Pill>
          {detail.editable && <Pill tone="info">You can edit lanes until VM starts on this ticket</Pill>}
        </div>
      </div>

      <div className="flex gap-5 items-start">
        <div className="flex-1 min-w-0 bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60">
              <tr className="text-left text-xs text-ink-500">
                <th className="px-3 py-2.5 font-medium">#</th>
                <th className="px-3 py-2.5 font-medium">Origin</th>
                <th className="px-3 py-2.5 font-medium">Destination</th>
                <th className="px-3 py-2.5 font-medium">Vehicle</th>
                <th className="px-3 py-2.5 font-medium text-right">Target rate</th>
                <th className="px-3 py-2.5 font-medium text-right">Min. trips</th>
                <th className="px-3 py-2.5 font-medium text-right">Final rate</th>
                <th className="px-3 py-2.5 font-medium">Result</th>
                <th className="px-3 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const req = reqByRow[row.id];
                if (editingId === row.id) {
                  return (
                    <EditLaneRow
                      key={row.id}
                      row={row}
                      ticketId={s.id}
                      onCancel={() => setEditingId(null)}
                      onSaved={(d) => {
                        setDetail(d);
                        setEditingId(null);
                        load();
                      }}
                    />
                  );
                }
                const finalRate = req?.current_final_rate ?? row.final_rate;
                return (
                  <tr key={row.id} className={`border-t border-ink-100 ${feedbackFor && req?.id === feedbackFor ? "bg-brand-50" : ""}`}>
                    <td className="px-3 py-2.5 text-ink-400 text-xs">{row.idx}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.origin}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.destination}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.vehicle_type}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{row.target_rate != null ? rp(row.target_rate) : "–"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.min_trip ?? "–"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-medium">
                      {finalRate != null ? rp(finalRate) : <span className="text-ink-400 font-normal">–</span>}
                      {perms.seeVendorData && (req?.resolved_vendor || row.matched_vendor) && (
                        <p className="text-xs text-ink-500 font-normal">{req?.resolved_vendor || row.matched_vendor}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <LaneResult row={row} req={req} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-2 justify-end">
                        {perms.workTickets && req && (
                          <select
                            value={req.status}
                            onChange={(e) => setStatus(req, e.target.value)}
                            className="text-xs border border-ink-200 rounded-md px-1.5 py-1 bg-white"
                            aria-label="Lane status"
                          >
                            {Object.entries(STATUS_LABEL).map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        )}
                        {perms.workTickets && req && isOpenStatus(req.status) && (
                          <button
                            onClick={() => setFeedbackFor(feedbackFor === req.id ? null : req.id)}
                            className="px-2.5 py-1 rounded-md text-xs font-medium bg-brand-600 text-white hover:bg-brand-700"
                          >
                            Give feedback
                          </button>
                        )}
                        {detail.editable && (
                          <button onClick={() => setEditingId(row.id)} className="px-2.5 py-1 rounded-md text-xs border border-ink-200 hover:bg-ink-50">
                            Edit
                          </button>
                        )}
                        {perms.createRequest && s.uploaded_by && detail.editable && !req && (
                          <button
                            onClick={() => askVm(row)}
                            disabled={busyRow === row.id}
                            className="px-2.5 py-1 rounded-md text-xs border border-ink-200 hover:bg-ink-50 disabled:opacity-50"
                          >
                            Ask VM
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {feedbackReq && perms.workTickets && (
          <aside className="w-[380px] shrink-0 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
            <ResolveRequestPanel
              request={feedbackReq}
              onDone={() => {
                setFeedbackFor(null);
                load();
              }}
              onCancel={() => setFeedbackFor(null)}
            />
          </aside>
        )}
      </div>

      <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4 mt-5 max-w-3xl">
        <Discussion endpoint={`/api/submissions/${s.id}/comments`} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Available routes (sales): lanes with vendor rates on file, no vendor data
// ---------------------------------------------------------------------------

export function AvailableRoutes() {
  const [routes, setRoutes] = useState(null);
  const [search, setSearch] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [onlyReady, setOnlyReady] = useState(false);

  useEffect(() => {
    fetch("/api/available-routes")
      .then((r) => (r.ok ? r.json() : { routes: [] }))
      .then((d) => setRoutes(d.routes));
  }, []);

  const vehicles = useMemo(() => [...new Set((routes || []).map((r) => r.vehicle_type))].sort(), [routes]);
  if (!routes) return <p className="text-sm text-ink-400">Loading routes…</p>;

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = routes
    .filter((r) => !vehicle || r.vehicle_type === vehicle)
    .filter((r) => !onlyReady || r.status === "ready")
    .filter((r) => words.every((w) => `${r.origin} ${r.destination}`.toLowerCase().includes(w)))
    .sort((a, b) => a.origin.localeCompare(b.origin) || a.destination.localeCompare(b.destination));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search origin or destination, e.g. bekasi surabaya"
          className="flex-1 min-w-[240px] border border-ink-200 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:border-brand-600"
        />
        <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="border border-ink-200 rounded-md px-2 py-2 text-sm bg-white">
          <option value="">All vehicles</option>
          {vehicles.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-700 px-2">
          <input type="checkbox" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} />
          Ready to quote only
        </label>
      </div>
      <div className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-50/60">
            <tr className="text-left text-xs text-ink-500">
              <th className="px-3 py-2.5 font-medium">Origin</th>
              <th className="px-3 py-2.5 font-medium">Destination</th>
              <th className="px-3 py-2.5 font-medium">Vehicle</th>
              <th className="px-3 py-2.5 font-medium text-right">Price (no target)</th>
              <th className="px-3 py-2.5 font-medium">Availability</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.origin}|${r.destination}|${r.vehicle_type}`} className="border-t border-ink-100">
                <td className="px-3 py-2.5">{r.origin}</td>
                <td className="px-3 py-2.5">{r.destination}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.vehicle_type}</td>
                <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{r.final_rate != null ? rp(r.final_rate) : "–"}</td>
                <td className="px-3 py-2.5">
                  {r.status === "ready" ? <Pill tone="ok">Ready to quote</Pill> : <Pill tone="warning">1 vendor · VM confirms</Pill>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-ink-400">
                  No routes match. Raise a new request and VM will source it.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-ink-400 border-t border-ink-100">
          {rows.length} of {routes.length} routes with vendor rates on file. Prices use the standard rule (2nd-cheapest vendor + 11.1%); a target rate can change it.
        </p>
      </div>
    </div>
  );
}
