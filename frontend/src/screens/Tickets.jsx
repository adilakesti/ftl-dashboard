import { useEffect, useMemo, useRef, useState } from "react";
import { L2_LOCATIONS, VEHICLE_TYPES, canonicalL2 } from "../l2Locations.js";
import { Discussion, MARGIN_TIERS, OD_REGIONS, STATUS_LABEL } from "../shared.jsx";
import { AgePill, StatTile, StatusBadge, isOpenStatus, rp } from "./Queue.jsx";
import { OnlyOneVendorBadge, ResolveRequestPanel } from "./Vm.jsx";

// A ticket is one submitted rate request: a shipper and several lanes (OD + vehicle).
// Dashboard Ticket lists every ticket for everyone; the VM queue lists only the ones
// with lanes VM still has to answer. Clicking a ticket opens its detail page.

export const ticketNo = (id) => `FTL-${String(id).padStart(6, "0")}`;

function ticketState(t) {
  if (t.went_live_at) return { label: "Live", tone: "live" };
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
  live: "bg-violet-50 text-violet-700 ring-violet-200",
};

function Pill({ tone = "neutral", children }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset whitespace-nowrap ${PILL[tone]}`}>
      {children}
    </span>
  );
}

// Dates as DD-MM-YYYY (no time).
export const fmtDay = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "–";
};

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
      .filter((t) =>
        stateFilter === "vm"
          ? t.vm_open_count > 0
          : stateFilter === "done"
            ? t.vm_open_count === 0 && !t.went_live_at
            : stateFilter === "live"
              ? !!t.went_live_at
              : true
      )
      .filter(
        (t) =>
          !q ||
          [t.ticket_no, t.salescrm_id, t.shipper_name, t.sales_pic, t.raised_by, t.od_region, ...t.vehicles].filter(Boolean).join(" ").toLowerCase().includes(q)
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
        {mode !== "vm" && (
          <StatTile label="Live" value={tickets.filter((t) => t.went_live_at).length} onClick={() => setStateFilter("live")} active={stateFilter === "live"} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticket no., SalesCRM ID, shipper, sales, region, vehicle"
          className="flex-1 min-w-[220px] border border-ink-200 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:border-brand-600"
        />
        {mode !== "vm" && (
          <div className="flex p-1 bg-ink-100 rounded-lg">
            {[
              ["all", "All"],
              ["vm", "Need VM"],
              ["done", "Complete"],
              ["live", "Live"],
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
              <th className="px-3 py-2.5 font-medium">OD Region</th>
              <th className="px-3 py-2.5 font-medium">Sales PIC</th>
              <th className="px-3 py-2.5 font-medium text-right">Potential / month</th>
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
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-600 tabular-nums">{fmtDay(t.raised_at)}</td>
                  <td className="px-3 py-2.5 max-w-[220px]">
                    <p className="font-medium text-ink-900 truncate">{t.shipper_name || "–"}</p>
                    {t.editable && <p className="text-xs text-brand-700">editable</p>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{t.od_region || <span className="text-ink-400">–</span>}</td>
                  <td className="px-3 py-2.5 max-w-[160px] truncate">{t.sales_pic || t.raised_by}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{rp(t.potential_monthly_revenue)}</td>
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
                      {t.oldest_open_days != null && !t.went_live_at && <AgePill t={{ status: "open", aging_days: t.oldest_open_days }} />}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-sm text-ink-400">
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
      <td colSpan={5} className="px-2 py-2 align-top">
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

function TicketHistory({ ticketId, refreshKey }) {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    fetch(`/api/submissions/${ticketId}/history`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setEvents(d.events));
  }, [ticketId, refreshKey]);
  const when = (at) => `${fmtDay(at)} ${String(at).slice(11, 16)}`;
  return (
    <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4">
      <h3 className="font-semibold text-sm mb-3">Ticket History</h3>
      {!events ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-ink-400">Nothing yet.</p>
      ) : (
        <ol className="relative border-l border-ink-200 ml-1.5 space-y-3">
          {[...events].reverse().map((e, i) => (
            <li key={i} className="pl-4">
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand-600" aria-hidden="true" />
              <p className="text-xs text-ink-500 tabular-nums">
                {when(e.at)}
                {e.actor ? ` · ${e.actor}` : ""}
              </p>
              <p className="text-sm font-medium text-ink-900">{e.stage}</p>
              {e.detail && <p className="text-sm text-ink-600">{e.detail}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function TicketDetail({ ticketId, perms, me, onBack }) {
  const [detail, setDetail] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [feedbackFor, setFeedbackFor] = useState(null); // vm request id
  const [busyRow, setBusyRow] = useState(null);

  const [historyKey, setHistoryKey] = useState(0);
  const load = () => {
    setHistoryKey((k) => k + 1);
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

  const canSetRegion = (me && me.email === s.uploaded_by) || perms.manageUsers;
  const pricedCount = rows.filter((r) => (reqByRow[r.id]?.current_final_rate ?? r.final_rate) != null).length;
  const liveBlocker = openCount > 0 ? "Some lanes are still waiting on VM" : pricedCount === 0 ? "No lane has a final rate yet" : null;

  const setRegion = async (od_region) => {
    const res = await fetch(`/api/submissions/${s.id}/od-region`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ od_region }),
    });
    if (res.ok) load();
  };

  const saveCrmId = async (value) => {
    const v = value.trim();
    if (v === (s.salescrm_id || "")) return;
    const res = await fetch(`/api/submissions/${s.id}/salescrm-id`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ salescrm_id: v || null }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      window.alert(b.detail || "Couldn't save the SalesCRM ID.");
    }
    load();
  };

  const setLive = async (live) => {
    if (!live && !window.confirm("Move this ticket back from live?")) return;
    const res = await fetch(`/api/tickets/${s.id}/go-live`, { method: live ? "POST" : "DELETE" });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      window.alert(b.detail || "Couldn't update go-live.");
    }
    load();
  };

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
            <p className="tabular-nums">{fmtDay(s.submitted_at || s.created_at)}</p>
          </div>
          <div>
            <p className="text-xs text-ink-500">SalesCRM ID</p>
            {canSetRegion ? (
              <input
                key={s.salescrm_id || ""}
                defaultValue={s.salescrm_id || ""}
                maxLength={64}
                placeholder="Add ID"
                onBlur={(e) => saveCrmId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="mt-0.5 w-40 border border-ink-200 rounded-md px-2 py-1 text-sm bg-white"
                aria-label="SalesCRM ID"
              />
            ) : (
              <p>{s.salescrm_id || "–"}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-ink-500">OD Region</p>
            {canSetRegion ? (
              <select
                value={s.od_region || ""}
                onChange={(e) => e.target.value && setRegion(e.target.value)}
                className="mt-0.5 border border-ink-200 rounded-md px-2 py-1 text-sm bg-white"
                aria-label="OD Region"
              >
                <option value="">Select…</option>
                {OD_REGIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.value}
                  </option>
                ))}
              </select>
            ) : (
              <p>{s.od_region || "–"}</p>
            )}
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
          {s.went_live_at && (
            <Pill tone="live">
              Live since {fmtDay(s.went_live_at)}
              {s.went_live_by ? ` · ${s.went_live_by}` : ""}
            </Pill>
          )}
          <span className="flex-1" />
          {perms.confirmGoLive && !s.went_live_at && (
            <button
              onClick={() => setLive(true)}
              disabled={!!liveBlocker}
              title={liveBlocker || "Mark this shipper as live"}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Mark as live
            </button>
          )}
          {perms.confirmGoLive && s.went_live_at && (
            <button onClick={() => setLive(false)} className="px-3 py-1.5 rounded-md text-sm border border-ink-200 hover:bg-ink-50">
              Undo live
            </button>
          )}
        </div>
        {perms.confirmGoLive && !s.went_live_at && liveBlocker && (
          <p className="text-xs text-ink-500 mt-1.5 text-right">Can't go live yet: {liveBlocker}.</p>
        )}
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
                <th className="px-3 py-2.5 font-medium text-right">Vendor cost</th>
                <th className="px-3 py-2.5 font-medium text-right">Margin at target</th>
                {MARGIN_TIERS.map((t) => (
                  <th key={t.pct} className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                    {t.pct}% margin
                    <span className="block font-normal text-ink-400">
                      {t.category ? `Cat ${t.category} · ` : ""}
                      {t.approval}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2.5 font-medium">Status</th>
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
                const pr = row.pricing;
                return (
                  <tr key={row.id} className={`border-t border-ink-100 ${feedbackFor && req?.id === feedbackFor ? "bg-brand-50" : ""}`}>
                    <td className="px-3 py-2.5 text-ink-400 text-xs">{row.idx}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.origin}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.destination}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.vehicle_type}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{row.target_rate != null ? rp(row.target_rate) : "–"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.min_trip ?? "–"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {pr ? rp(pr.basis_cost) : <span className="text-ink-400">–</span>}
                      {perms.seeVendorData && (req?.resolved_vendor || row.matched_vendor) && (
                        <p className="text-xs text-ink-500">{req?.resolved_vendor || row.matched_vendor}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {pr?.margin_at_target != null ? (
                        <span className={pr.margin_at_target < 5 ? "text-red-600" : ""}>
                          {pr.margin_at_target.toFixed(1)}%
                          <span className="block text-xs text-ink-500">Cat {pr.target_category}</span>
                        </span>
                      ) : (
                        <span className="text-ink-400">–</span>
                      )}
                    </td>
                    {MARGIN_TIERS.map((t) => {
                      const tier = pr?.tiers.find((x) => x.margin_pct === t.pct);
                      const suggested = tier && finalRate != null && tier.price === finalRate;
                      const overTarget = tier && row.target_rate != null && tier.price > row.target_rate;
                      return (
                        <td key={t.pct} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                          {tier ? (
                            <span
                              className={`inline-block px-2 py-1 rounded-md ${
                                suggested ? "bg-emerald-50 ring-1 ring-emerald-300 font-semibold text-emerald-800" : overTarget ? "text-ink-400" : ""
                              }`}
                              title={suggested ? "Suggested rate" : overTarget ? "Above the target rate" : undefined}
                            >
                              {rp(tier.price)}
                            </span>
                          ) : (
                            <span className="text-ink-400">–</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5">
                      <LaneResult row={row} req={req} />
                      {!pr && !req && <p className="text-xs text-ink-500 mt-1">VM sets this rate</p>}
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

      <p className="text-xs text-ink-500 mt-2">
        Vendor cost = 2nd-cheapest active vendor (or the rate VM set). Prices = cost ÷ (1 − margin), rounded up to Rp 100,
        before PPN, overnight, TKBM and extra drop points. Highlighted = suggested rate: the highest margin that still meets
        the target, or 15% when there's no target.
      </p>

      <div className="grid lg:grid-cols-2 gap-5 mt-5 items-start">
        <TicketHistory ticketId={s.id} refreshKey={historyKey} />
        <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4">
          <Discussion endpoint={`/api/submissions/${s.id}/comments`} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Go-live: the shippers that went live, and the tickets ready to be marked live
// ---------------------------------------------------------------------------

export function GoLive({ perms, onOpen }) {
  const [tickets, setTickets] = useState(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(null);

  const load = () =>
    fetch("/api/ticket-board")
      .then((r) => (r.ok ? r.json() : { tickets: [] }))
      .then((d) => setTickets(d.tickets));
  useEffect(() => {
    load();
  }, []);

  if (!tickets) return <p className="text-sm text-ink-400">Loading…</p>;
  const q = search.trim().toLowerCase();
  const match = (t) =>
    !q || [t.ticket_no, t.shipper_name, t.sales_pic, t.od_region].filter(Boolean).join(" ").toLowerCase().includes(q);
  const live = tickets.filter((t) => t.went_live_at && match(t)).sort((a, b) => String(b.went_live_at).localeCompare(String(a.went_live_at)));
  const ready = tickets.filter((t) => !t.went_live_at && t.vm_open_count === 0 && t.priced_count > 0 && match(t));

  const markLive = async (t) => {
    setBusy(t.id);
    const res = await fetch(`/api/tickets/${t.id}/go-live`, { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      window.alert(b.detail || "Couldn't mark live.");
    }
    load();
  };

  const row = (t, kind) => (
    <tr key={t.id} onClick={() => onOpen(t.id)} className="border-t border-ink-100 cursor-pointer hover:bg-ink-50">
      <td className="px-3 py-2.5 font-medium text-brand-700 tabular-nums whitespace-nowrap">{t.ticket_no}</td>
      <td className="px-3 py-2.5 font-medium">{t.shipper_name || "–"}</td>
      <td className="px-3 py-2.5">{t.od_region || "–"}</td>
      <td className="px-3 py-2.5">{t.sales_pic || t.raised_by}</td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{rp(t.potential_monthly_revenue)}</td>
      <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
        {kind === "live" ? (
          <>
            {fmtDay(t.went_live_at)}
            {t.went_live_by && <span className="block text-xs text-ink-500">{t.went_live_by}</span>}
          </>
        ) : (
          fmtDay(t.raised_at)
        )}
      </td>
      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
        {kind === "ready" && perms.confirmGoLive && (
          <button
            onClick={() => markLive(t)}
            disabled={busy === t.id}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            Mark as live
          </button>
        )}
      </td>
    </tr>
  );
  const table = (list, kind, empty) => (
    <div className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-ink-50/60">
          <tr className="text-left text-xs text-ink-500">
            {["Ticket no.", "Shipper", "OD Region", "Sales PIC", "Potential / month", kind === "live" ? "Live since" : "Raised", ""].map((h, i) => (
              <th key={i} className={`px-3 py-2.5 font-medium ${i === 4 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((t) => row(t, kind))}
          {list.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-sm text-ink-400">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search ticket no., shipper, sales PIC, region"
        className="w-full max-w-md border border-ink-200 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:border-brand-600"
      />
      <section>
        <h2 className="text-sm font-semibold text-ink-900 mb-2">
          Live shippers <span className="text-ink-400 font-normal">({live.length})</span>
        </h2>
        {table(live, "live", "No shipper is live yet.")}
      </section>
      <section>
        <h2 className="text-sm font-semibold text-ink-900 mb-1">
          Ready to go live <span className="text-ink-400 font-normal">({ready.length})</span>
        </h2>
        <p className="text-xs text-ink-500 mb-2">Tickets with no lane waiting on VM and at least one final rate. You can also mark a ticket live from its page in Dashboard Ticket.</p>
        {table(ready, "ready", "Nothing ready yet.")}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Available routes (sales): which OD + vehicle combinations we can serve. Only the
// lane itself — no price, vendor or vendor count — so sales knows what to sell.
// ---------------------------------------------------------------------------

function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const shown = options.filter((o) => o.value.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (v) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const summary =
    selected.length === 0 ? `All ${label.toLowerCase()}s` : selected.length === 1 ? selected[0] : `${selected.length} ${label.toLowerCase()}s`;

  return (
    <div className="relative" ref={ref}>
      <p className="text-xs text-ink-500 mb-1">{label}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm bg-white text-left ${
          selected.length ? "border-brand-600 text-ink-900" : "border-ink-200 text-ink-600"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{summary}</span>
        <span className="text-ink-400 text-xs" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[260px] bg-white border border-ink-100 rounded-lg shadow-xl">
          <div className="p-2 border-b border-ink-100">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              className="w-full border border-ink-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-brand-600"
            />
            <div className="flex justify-between mt-1.5 text-xs">
              <button
                type="button"
                onClick={() => onChange([...new Set([...selected, ...shown.map((o) => o.value)])])}
                className="text-brand-600 hover:underline"
              >
                Select all{q ? " shown" : ""}
              </button>
              <button type="button" onClick={() => onChange([])} className="text-ink-500 hover:underline">
                Clear
              </button>
            </div>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox" aria-multiselectable="true">
            {shown.map((o) => (
              <li key={o.value}>
                <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-ink-50 cursor-pointer">
                  <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                  <span className="flex-1 truncate">{o.value}</span>
                  <span className="text-xs text-ink-400 tabular-nums">{o.count}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-3 text-sm text-ink-400">No matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

const ROUTE_FIELDS = [
  ["origin", "Origin"],
  ["destination", "Destination"],
  ["vehicle_type", "Vehicle"],
];

export function AvailableRoutes() {
  const [routes, setRoutes] = useState(null);
  const [filters, setFilters] = useState({ origin: [], destination: [], vehicle_type: [] });

  useEffect(() => {
    fetch("/api/available-routes")
      .then((r) => (r.ok ? r.json() : { routes: [] }))
      .then((d) => setRoutes(d.routes));
  }, []);

  const passes = (r, skip) => ROUTE_FIELDS.every(([k]) => k === skip || !filters[k].length || filters[k].includes(r[k]));

  // Each filter offers the values still possible under the OTHER filters, with counts.
  const optionsFor = (key) => {
    const counts = new Map();
    for (const r of routes || []) if (passes(r, key)) counts.set(r[key], (counts.get(r[key]) || 0) + 1);
    for (const v of filters[key]) if (!counts.has(v)) counts.set(v, 0); // keep picked values visible
    return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
  };

  if (!routes) return <p className="text-sm text-ink-400">Loading routes…</p>;
  const rows = routes.filter((r) => passes(r, null));
  const anyFilter = ROUTE_FIELDS.some(([k]) => filters[k].length);

  return (
    <div>
      <div className="grid sm:grid-cols-3 gap-3 mb-3">
        {ROUTE_FIELDS.map(([key, label]) => (
          <MultiSelect
            key={key}
            label={label}
            options={optionsFor(key)}
            selected={filters[key]}
            onChange={(v) => setFilters((f) => ({ ...f, [key]: v }))}
          />
        ))}
      </div>

      {anyFilter && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {ROUTE_FIELDS.flatMap(([key, label]) =>
            filters[key].map((v) => (
              <button
                key={`${key}:${v}`}
                onClick={() => setFilters((f) => ({ ...f, [key]: f[key].filter((x) => x !== v) }))}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-xs ring-1 ring-inset ring-brand-200"
                title={`Remove ${label} filter`}
              >
                <span className="text-brand-700/70">{label}:</span> {v} <span aria-hidden="true">×</span>
              </button>
            ))
          )}
          <button onClick={() => setFilters({ origin: [], destination: [], vehicle_type: [] })} className="text-xs text-ink-500 hover:underline ml-1">
            Clear all
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-50/60">
            <tr className="text-left text-xs text-ink-500">
              <th className="px-3 py-2.5 font-medium">Origin</th>
              <th className="px-3 py-2.5 font-medium">Destination</th>
              <th className="px-3 py-2.5 font-medium">Vehicle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.origin}|${r.destination}|${r.vehicle_type}`} className="border-t border-ink-100">
                <td className="px-3 py-2.5">{r.origin}</td>
                <td className="px-3 py-2.5">{r.destination}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.vehicle_type}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-10 text-center text-sm text-ink-400">
                  No route matches. Raise a new request and VM will source it.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-ink-400 border-t border-ink-100">
          {rows.length} of {routes.length} routes we have vendors for. Use Quick check or a new request for prices.
        </p>
      </div>
    </div>
  );
}
