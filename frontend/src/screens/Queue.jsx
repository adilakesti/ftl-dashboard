import { useEffect, useState } from "react";
import { STATUS_LABEL, fmt } from "../shared.jsx";

// Shared lane-level helpers: SLA age, status badges, rupiah formatting, stat tiles.

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
