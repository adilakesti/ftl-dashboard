import { useEffect, useState } from "react";
import { Discussion } from "../shared.jsx";
import { rp } from "./Queue.jsx";

// Every submitted rate request, from every salesperson — read-only, for all roles.
// Vendor names never reach sales: the backend leaves them out of the response.
export function Submissions({ perms }) {
  const [list, setList] = useState(null);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    fetch("/api/submissions?scope=all")
      .then((r) => (r.ok ? r.json() : { submissions: [] }))
      .then((d) => setList(d.submissions));
  }, []);

  useEffect(() => {
    setDetail(null);
    if (!openId) return;
    fetch(`/api/submissions/${openId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetail);
  }, [openId]);

  if (!list) return <p className="text-sm text-ink-400">Loading…</p>;
  const q = search.trim().toLowerCase();
  const rows = list.filter(
    (s) => !q || [s.shipper_name, s.sales_pic, s.commodity_type].filter(Boolean).join(" ").toLowerCase().includes(q)
  );

  return (
    <div className="flex gap-5 items-start">
      <div className="flex-1 min-w-0">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search shipper, sales PIC, commodity"
          className="w-full max-w-md mb-3 border border-ink-200 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:border-brand-600"
        />
        <div className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60">
              <tr className="text-left text-xs text-ink-500">
                <th className="px-3 py-2.5 font-medium">Submitted</th>
                <th className="px-3 py-2.5 font-medium">Shipper</th>
                <th className="px-3 py-2.5 font-medium">Sales PIC</th>
                <th className="px-3 py-2.5 font-medium">Commodity</th>
                <th className="px-3 py-2.5 font-medium text-right">Potential / month</th>
                <th className="px-3 py-2.5 font-medium">Add-ons</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setOpenId(s.id === openId ? null : s.id)}
                  className={`border-t border-ink-100 cursor-pointer ${s.id === openId ? "bg-brand-50" : "hover:bg-ink-50"}`}
                >
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-500">{(s.submitted_at || s.created_at).slice(0, 10)}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-ink-900">{s.shipper_name || "–"}</span>
                    {s.shipper_status && <span className="ml-2 text-xs text-ink-500 capitalize">{s.shipper_status}</span>}
                  </td>
                  <td className="px-3 py-2.5">{s.sales_pic || s.uploaded_by}</td>
                  <td className="px-3 py-2.5">
                    {s.commodity_type || "–"}
                    {s.high_value_fragile && <span className="ml-1 text-xs text-amber-700">· fragile</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{rp(s.potential_monthly_revenue)}</td>
                  <td className="px-3 py-2.5 text-xs text-ink-500">{s.add_ons.map((a) => a.label).join(", ") || "–"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-ink-400">
                    No submissions match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openId && (
        <aside className="w-[460px] shrink-0 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto bg-white rounded-xl border border-ink-100 shadow-sm">
          {!detail ? (
            <p className="p-4 text-sm text-ink-400">Loading…</p>
          ) : (
            <div>
              <div className="flex items-start gap-3 p-4 border-b border-ink-100">
                <div className="flex-1">
                  <p className="text-xs text-ink-500">Submission #{detail.submission.id}</p>
                  <h3 className="font-semibold">{detail.submission.shipper_name}</h3>
                  <p className="text-sm text-ink-500">
                    {detail.submission.sales_pic} · {detail.rows.length} lane{detail.rows.length === 1 ? "" : "s"}
                  </p>
                </div>
                <button onClick={() => setOpenId(null)} aria-label="Close" className="text-ink-400 hover:text-ink-900 text-lg leading-none px-1">
                  ×
                </button>
              </div>
              <ul className="divide-y divide-ink-100">
                {detail.rows.map((r) => (
                  <li key={r.id} className="px-4 py-2.5">
                    <div className="flex justify-between gap-3">
                      <span className="text-sm">
                        {r.origin} → {r.destination} <span className="text-ink-500">· {r.vehicle_type}</span>
                      </span>
                      <span className="text-sm tabular-nums whitespace-nowrap font-medium">
                        {r.final_rate != null ? rp(r.final_rate) : "–"}
                      </span>
                    </div>
                    <p className="text-xs text-ink-500">
                      Target {r.target_rate != null ? rp(r.target_rate) : "none"} · {r.remarks || "–"}
                      {perms.seeVendorData && r.matched_vendor && ` · ${r.matched_vendor}`}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="p-4 border-t border-ink-100">
                <Discussion endpoint={`/api/submissions/${detail.submission.id}/comments`} />
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
