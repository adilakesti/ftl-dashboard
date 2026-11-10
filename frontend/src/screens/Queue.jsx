import { useEffect, useMemo, useState } from "react";
import { Discussion, STATUS_LABEL, fmt } from "../shared.jsx";
import { OnlyOneVendorBadge, ResolveRequestPanel, UNKNOWN_SHIPPER } from "./Vm.jsx";

// The shared ticket queue. Every role opens the same screen; what differs is what the
// backend sends (no vendor data for sales) and the controls `perms` allows.

export const SLA_DAYS = 7;
export const isOpenStatus = (s) => s === "open" || s === "in_progress";

// Age colour against the 7-day SLA: overdue, close to it, or fine. Closed tickets are neutral.
export function ageTone(t) {
  if (!isOpenStatus(t.status)) return "neutral";
  if (t.aging_days >= SLA_DAYS) return "danger";
  if (t.aging_days >= SLA_DAYS - 2) return "warning";
  return "ok";
}

const TONE = {
  danger: "bg-red-50 text-red-700 ring-red-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  neutral: "bg-ink-50 text-ink-500 ring-ink-200",
};

export function AgePill({ t }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset tabular-nums ${TONE[ageTone(t)]}`}>
      {t.aging_days}d
    </span>
  );
}

const STATUS_TONE = {
  open: "bg-sky-50 text-sky-700 ring-sky-200",
  in_progress: "bg-amber-50 text-amber-800 ring-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  closed_no_vendor: "bg-red-50 text-red-700 ring-red-200",
  closed_no_lower_rate: "bg-ink-50 text-ink-600 ring-ink-200",
};

export function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset whitespace-nowrap ${STATUS_TONE[status] || TONE.neutral}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export const rp = (n) => (n === null || n === undefined ? "–" : `Rp ${fmt(Math.round(n))}`);

const SORTS = {
  oldest: { label: "Oldest first", fn: (a, b) => b.aging_days - a.aging_days || a.id - b.id },
  newest: { label: "Newest first", fn: (a, b) => a.aging_days - b.aging_days || b.id - a.id },
  shipper: { label: "Shipper A–Z", fn: (a, b) => (a.shipper_name || "~").localeCompare(b.shipper_name || "~") || b.aging_days - a.aging_days },
};

const matchesSearch = (t, q) => {
  if (!q) return true;
  const hay = [t.shipper_name, t.origin, t.destination, t.vehicle_type, t.requested_by, t.sales_pic, `#${t.id}`]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
};

export function useTickets() {
  const [tickets, setTickets] = useState(null);
  const load = () =>
    fetch("/api/vm/requests")
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => setTickets(d.requests));
  useEffect(() => {
    load();
  }, []);
  return { tickets, reload: load };
}

export function queueStats(tickets) {
  const open = tickets.filter((t) => isOpenStatus(t.status));
  return {
    open: open.length,
    near: open.filter((t) => ageTone(t) === "warning").length,
    overdue: open.filter((t) => ageTone(t) === "danger").length,
    singleVendor: open.filter((t) => t.only_one_vendor).length,
    closed: tickets.length - open.length,
  };
}

export function StatTile({ label, value, tone, onClick, active }) {
  const color = tone === "danger" ? "text-red-600" : tone === "warning" ? "text-amber-600" : "text-ink-900";
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg px-4 py-3 border transition ${
        active ? "border-brand-600 bg-brand-50" : "border-ink-100 bg-white hover:border-ink-200"
      } ${onClick ? "" : "cursor-default"}`}
    >
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </button>
  );
}

function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="text-sm text-ink-900">{children ?? "–"}</dd>
    </div>
  );
}

function TicketPanel({ t, perms, onClose, onChanged, onResolve }) {
  const [saving, setSaving] = useState(false);
  const setStatus = async (status) => {
    setSaving(true);
    await fetch(`/api/vm/requests/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setSaving(false);
    onChanged();
  };
  const thread = t.submission_id ? `/api/submissions/${t.submission_id}/comments` : `/api/vm-requests/${t.id}/comments`;

  return (
    <div className="bg-white rounded-xl border border-ink-100 shadow-sm">
      <div className="flex items-start gap-3 p-4 border-b border-ink-100">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-ink-500">
            #{t.id} · {t.shipper_name || UNKNOWN_SHIPPER}
          </p>
          <h3 className="font-semibold text-ink-900 leading-snug">
            {t.origin} → {t.destination}
          </h3>
          <p className="text-sm text-ink-500">
            {t.vehicle_type}
            {t.only_one_vendor && isOpenStatus(t.status) && <OnlyOneVendorBadge />}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-ink-400 hover:text-ink-900 text-lg leading-none px-1">
          ×
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={t.status} />
          <AgePill t={t} />
          {t.auto_closed_sla && <span className="text-xs text-amber-700">Auto-closed by SLA</span>}
        </div>

        {perms.workTickets && (
          <div className="flex items-center gap-2">
            <select
              value={t.status}
              disabled={saving}
              onChange={(e) => setStatus(e.target.value)}
              className="text-sm border border-ink-200 rounded-md px-2 py-1.5 bg-white"
              aria-label="Status"
            >
              {Object.entries(STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            {isOpenStatus(t.status) && (
              <button
                onClick={onResolve}
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700"
              >
                Fill rate
              </button>
            )}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Target rate">{t.target_rate != null ? rp(t.target_rate) : "None given"}</Fact>
          <Fact label="Final rate">{t.current_final_rate != null ? rp(t.current_final_rate) : "No rate yet"}</Fact>
          {perms.seeVendorData && <Fact label="Target cost to beat">{t.target_cost != null ? rp(t.target_cost) : "–"}</Fact>}
          <Fact label="Min. trips / month">{t.min_trip}</Fact>
          <Fact label="Sales PIC">{t.sales_pic || t.requested_by}</Fact>
          <Fact label="Requested">{t.created_at?.slice(0, 10)}</Fact>
          <Fact label="Commodity">{t.commodity_type}</Fact>
          <Fact label="High value / fragile">{t.high_value_fragile ? "Yes" : "No"}</Fact>
          {t.add_ons?.length > 0 && (
            <div className="col-span-2">
              <Fact label="Add-ons">{t.add_ons.map((a) => (a.value ? `${a.label} (${a.value})` : a.label)).join(", ")}</Fact>
            </div>
          )}
        </dl>

        {perms.seeVendorData && (
          <div className="rounded-lg bg-ink-50 p-3">
            <p className="text-xs font-medium text-ink-500 mb-1.5">
              Vendors on this lane ({t.vendor_count ?? t.ranked_vendors.length})
            </p>
            {t.ranked_vendors.length ? (
              <ol className="text-sm space-y-0.5">
                {t.ranked_vendors.map((v, i) => (
                  <li key={v.vendor} className="flex justify-between gap-3">
                    <span className={v.vendor === t.resolved_vendor ? "font-medium" : ""}>
                      {i + 1}. {v.vendor}
                      {v.vendor === t.resolved_vendor && <span className="ml-1 text-xs text-brand-600">winner</span>}
                    </span>
                    <span className="tabular-nums text-ink-600">{rp(v.cost)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-ink-400">None on record.</p>
            )}
            {t.winner_basis && <p className="text-xs text-ink-500 mt-1.5">{t.winner_basis}</p>}
            {t.single_vendor_approved && (
              <p className="text-xs text-amber-700 mt-1.5">
                Single vendor approved by {t.override_by}: {t.override_reason}
              </p>
            )}
          </div>
        )}

        <Discussion endpoint={thread} />
      </div>
    </div>
  );
}

export function TicketQueue({ perms, focusSubmissionId, onFocusHandled, initialSearch = "" }) {
  const { tickets, reload } = useTickets();
  const [statusFilter, setStatusFilter] = useState("open"); // open | closed | all
  const [ageFilter, setAgeFilter] = useState(""); // "" | warning | danger
  const [search, setSearch] = useState(initialSearch);
  const [shipper, setShipper] = useState("");
  const [sort, setSort] = useState("oldest");
  const [selectedId, setSelectedId] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => setSearch(initialSearch), [initialSearch]);

  // Opened from a notification: show that submission's tickets and open the first.
  useEffect(() => {
    if (!focusSubmissionId || !tickets) return;
    const first = tickets.find((t) => t.submission_id === focusSubmissionId);
    if (first) {
      setStatusFilter("all");
      setShipper(first.shipper_name || "");
      setSelectedId(first.id);
    }
    onFocusHandled?.();
  }, [focusSubmissionId, tickets]);

  const shippers = useMemo(
    () => [...new Set((tickets || []).map((t) => t.shipper_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [tickets]
  );

  if (!tickets) return <p className="text-sm text-ink-400">Loading tickets…</p>;

  const stats = queueStats(tickets);
  const rows = tickets
    .filter((t) =>
      statusFilter === "open" ? isOpenStatus(t.status) : statusFilter === "closed" ? !isOpenStatus(t.status) : true
    )
    .filter((t) => !ageFilter || ageTone(t) === ageFilter)
    .filter((t) => !shipper || t.shipper_name === shipper)
    .filter((t) => matchesSearch(t, search))
    .sort(SORTS[sort].fn);
  const selected = tickets.find((t) => t.id === selectedId);
  // With the side panel open, fold vehicle into the lane cell and drop the target column
  // so rate, age and status stay visible on a laptop screen.
  const compact = !!selected;
  const shipperOpenCount = shipper ? tickets.filter((t) => t.shipper_name === shipper && isOpenStatus(t.status)).length : 0;

  const pickAge = (tone) => {
    setStatusFilter("open");
    setAgeFilter((cur) => (cur === tone ? "" : tone));
  };

  const resolveAllForShipper = async () => {
    if (!window.confirm(`Resolve every open ticket of ${shipper} that already has master-rate data?`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/vm/requests/resolve-ready?shipper_name=${encodeURIComponent(shipper)}`, { method: "POST" });
      const d = await res.json();
      window.alert(`${d.resolved_count} of ${d.checked_count} open tickets resolved with existing rates.`);
      reload();
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatTile label="Open tickets" value={stats.open} onClick={() => { setStatusFilter("open"); setAgeFilter(""); }} active={statusFilter === "open" && !ageFilter} />
        <StatTile label={`Near SLA (${SLA_DAYS - 2}–${SLA_DAYS - 1} days)`} value={stats.near} tone={stats.near ? "warning" : undefined} onClick={() => pickAge("warning")} active={ageFilter === "warning"} />
        <StatTile label={`Overdue (${SLA_DAYS}+ days)`} value={stats.overdue} tone={stats.overdue ? "danger" : undefined} onClick={() => pickAge("danger")} active={ageFilter === "danger"} />
        <StatTile label="Waiting on a single vendor" value={stats.singleVendor} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shipper, city, vehicle, #id"
            className="w-full border border-ink-200 rounded-md pl-8 pr-3 py-2 text-sm bg-white focus:outline-none focus:border-brand-600"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 text-sm" aria-hidden="true">
            ⌕
          </span>
        </div>
        <div className="flex p-1 bg-ink-100 rounded-lg">
          {[
            ["open", "Open"],
            ["closed", "Closed"],
            ["all", "All"],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => {
                setStatusFilter(k);
                if (k !== "open") setAgeFilter("");
              }}
              className={`px-3 py-1 rounded-md text-sm font-medium ${
                statusFilter === k ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <select value={shipper} onChange={(e) => setShipper(e.target.value)} className="border border-ink-200 rounded-md px-2 py-2 text-sm bg-white max-w-[220px]">
          <option value="">All shippers</option>
          {shippers.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="border border-ink-200 rounded-md px-2 py-2 text-sm bg-white">
          {Object.entries(SORTS).map(([k, s]) => (
            <option key={k} value={k}>
              {s.label}
            </option>
          ))}
        </select>
        {perms.workTickets && shipper && shipperOpenCount > 0 && (
          <button
            onClick={resolveAllForShipper}
            disabled={bulkBusy}
            className="px-3 py-2 rounded-md text-sm border border-ink-200 bg-white hover:bg-ink-50 disabled:opacity-50"
          >
            {bulkBusy ? "Resolving…" : `Resolve ${shipperOpenCount} with existing rates`}
          </button>
        )}
      </div>

      <div className="flex gap-5 items-start">
        <div className="flex-1 min-w-0 bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60">
              <tr className="text-left text-xs text-ink-500">
                <th className="px-3 py-2.5 font-medium">Shipper</th>
                <th className="px-3 py-2.5 font-medium">Lane</th>
                {!compact && <th className="px-3 py-2.5 font-medium">Vehicle</th>}
                {!compact && <th className="px-3 py-2.5 font-medium text-right">Target rate</th>}
                <th className="px-3 py-2.5 font-medium text-right">Final rate</th>
                <th className="px-3 py-2.5 font-medium">Age</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => {
                    setSelectedId(t.id === selectedId ? null : t.id);
                    setResolving(false);
                  }}
                  className={`border-t border-ink-100 cursor-pointer ${t.id === selectedId ? "bg-brand-50" : "hover:bg-ink-50"}`}
                >
                  <td className={`px-3 py-2.5 ${compact ? "max-w-[160px]" : "max-w-[200px]"}`}>
                    <p className="font-medium text-ink-900 truncate">{t.shipper_name || UNKNOWN_SHIPPER}</p>
                    <p className="text-xs text-ink-500 truncate">{t.sales_pic || t.requested_by}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-ink-900 whitespace-nowrap">{t.origin}</p>
                    <p className="text-xs text-ink-500 whitespace-nowrap">
                      → {t.destination}
                      {compact && ` · ${t.vehicle_type}`}
                    </p>
                  </td>
                  {!compact && (
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {t.vehicle_type}
                      {t.only_one_vendor && isOpenStatus(t.status) && <OnlyOneVendorBadge />}
                    </td>
                  )}
                  {!compact && (
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{t.target_rate != null ? rp(t.target_rate) : "–"}</td>
                  )}
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {t.current_final_rate != null ? rp(t.current_final_rate) : <span className="text-ink-400">No rate yet</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <AgePill t={t} />
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={t.status} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-sm text-ink-400">
                    No tickets match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-ink-400 border-t border-ink-100">
            {rows.length} of {tickets.length} tickets
          </p>
        </div>

        {selected && (
          <aside className="w-[380px] shrink-0 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
            {resolving && perms.workTickets ? (
              <ResolveRequestPanel
                request={selected}
                onDone={() => {
                  setResolving(false);
                  reload();
                }}
                onCancel={() => setResolving(false)}
              />
            ) : (
              <TicketPanel
                t={selected}
                perms={perms}
                onClose={() => setSelectedId(null)}
                onChanged={reload}
                onResolve={() => setResolving(true)}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
