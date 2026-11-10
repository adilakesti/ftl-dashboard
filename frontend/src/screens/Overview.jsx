import { useEffect, useState } from "react";
import { AgePill, StatTile, StatusBadge, isOpenStatus, queueStats, rp, useTickets } from "./Queue.jsx";
import { UNKNOWN_SHIPPER } from "./Vm.jsx";

// Home screen, the same for everyone: where the queue stands and what needs a look first.
export function Overview({ me, onNavigate }) {
  const perms = me.permissions || {};
  const { tickets } = useTickets();
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    fetch("/api/vm/summary?limit=5")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary);
  }, []);

  if (!tickets) return <p className="text-sm text-ink-400">Loading…</p>;
  const stats = queueStats(tickets);
  const oldest = tickets
    .filter((t) => isOpenStatus(t.status))
    .sort((a, b) => b.aging_days - a.aging_days)
    .slice(0, 6);

  const actions = [
    perms.createRequest && { label: "New rate request", screen: "new-request", primary: true },
    perms.quickCheck && { label: "Quick check a lane", screen: "quick-check" },
    perms.workTickets && { label: "Work the ticket queue", screen: "queue", primary: !perms.createRequest },
    perms.manageRates && { label: "Upload vendor rates", screen: "rates" },
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a.screen}
              onClick={() => onNavigate(a.screen)}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                a.primary ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-white border border-ink-200 text-ink-700 hover:bg-ink-50"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Open tickets" value={stats.open} onClick={() => onNavigate("queue")} />
        <StatTile label="Near SLA" value={stats.near} tone={stats.near ? "warning" : undefined} onClick={() => onNavigate("queue")} />
        <StatTile label="Overdue" value={stats.overdue} tone={stats.overdue ? "danger" : undefined} onClick={() => onNavigate("queue")} />
        <StatTile label="Closed tickets" value={stats.closed} onClick={() => onNavigate("queue")} />
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <section className="lg:col-span-3 bg-white rounded-xl border border-ink-100 shadow-sm">
          <header className="flex items-center justify-between px-4 py-3 border-b border-ink-100">
            <h2 className="font-semibold text-sm">Waiting longest</h2>
            <button onClick={() => onNavigate("queue")} className="text-xs text-brand-600 hover:underline">
              Open queue
            </button>
          </header>
          <ul>
            {oldest.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => onNavigate("queue", { search: `#${t.id}` })}
                  className="w-full flex items-center gap-3 px-4 py-2.5 border-t first:border-t-0 border-ink-100 hover:bg-ink-50 text-left"
                >
                  <AgePill t={t} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink-900 truncate">
                      {t.origin} → {t.destination} · {t.vehicle_type}
                    </span>
                    <span className="block text-xs text-ink-500 truncate">{t.shipper_name || UNKNOWN_SHIPPER}</span>
                  </span>
                  <StatusBadge status={t.status} />
                </button>
              </li>
            ))}
            {oldest.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-400">Nothing open. Nice.</li>}
          </ul>
        </section>

        <section className="lg:col-span-2 bg-white rounded-xl border border-ink-100 shadow-sm">
          <header className="flex items-center justify-between px-4 py-3 border-b border-ink-100">
            <h2 className="font-semibold text-sm">Most-requested lower rates</h2>
            <button onClick={() => onNavigate("prioritization")} className="text-xs text-brand-600 hover:underline">
              Prioritization
            </button>
          </header>
          <ul>
            {(summary?.seeking_lower_rate || []).slice(0, 5).map((l) => (
              <li key={`${l.origin}|${l.destination}|${l.vehicle_type}`} className="flex items-center gap-3 px-4 py-2.5 border-t first:border-t-0 border-ink-100">
                <span className="flex-1 min-w-0 text-sm truncate">
                  {l.origin} → {l.destination}
                  <span className="text-ink-500"> · {l.vehicle_type}</span>
                </span>
                <span className="text-xs text-ink-500 tabular-nums whitespace-nowrap">
                  {l.request_count}× · avg {rp(l.avg_target_rate)}
                </span>
              </li>
            ))}
            {summary && summary.seeking_lower_rate.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-ink-400">No lanes waiting on a lower rate.</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
