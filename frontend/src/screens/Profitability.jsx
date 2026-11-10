import { useEffect, useState } from "react";
import { FilterBar, Td, Th, fmt, salesKeyOf, useDirectoryUsers, userLabel } from "../shared.jsx";

// ---------------------------------------------------------------------------
// Profitability: pick shippers to go live, then a per-shipper tracker "spreadsheet"
// ---------------------------------------------------------------------------

export const ORDER_STATUS_OPTIONS = [
  { value: "", label: "-" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export const toNum = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};
// Actual margin over cost: (rate − cost) ÷ cost.
export const marginPct = (rate, cost) => {
  const r = toNum(rate);
  const c = toNum(cost);
  return r !== null && c ? ((r - c) / c) * 100 : null;
};
export const fmtPct = (v) => (v === null ? "-" : `${v.toFixed(1)}%`);
export const laneKeyFe = (o, d, v) =>
  [o, d, v].map((x) => String(x || "").trim().toLowerCase().replace(/\s+/g, " ")).join("|");
export const str = (v) => (v === null || v === undefined ? "" : String(v));

// Parse a pasted cell for a column type (Excel/Sheets paste → grid).
export function parsePasted(raw, type) {
  const t = raw.trim();
  if (type === "number") return t.replace(/[^0-9-]/g, "");
  if (type === "date") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return t;
}

// Editable table that behaves like a small spreadsheet: type in any cell, paste a block
// from Excel/Sheets, add or delete rows. `columns[].computed(row)` makes a read-only cell.
export function EditableGrid({ columns, rows, setRows, blankRow, onCellEdited, rowError, readOnly = false }) {
  const editable = columns.filter((c) => !c.computed);

  const setCell = (ri, key, value) =>
    setRows((rs) =>
      rs.map((r, i) => {
        if (i !== ri) return r;
        const next = { ...r, [key]: value };
        return onCellEdited ? onCellEdited(next, key) : next;
      })
    );

  const onPaste = (e, ri, key) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return; // plain single value: normal paste
    e.preventDefault();
    const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    const startCol = editable.findIndex((c) => c.key === key);
    setRows((rs) => {
      const out = rs.map((r) => ({ ...r }));
      lines.forEach((cells, li) => {
        const target = ri + li;
        while (out.length <= target) out.push(blankRow());
        let row = out[target];
        cells.forEach((cell, ci) => {
          const col = editable[startCol + ci];
          if (!col) return;
          row = { ...row, [col.key]: parsePasted(cell, col.type) };
          if (onCellEdited) row = onCellEdited(row, col.key);
        });
        out[target] = row;
      });
      return out;
    });
  };

  return (
    <div className="overflow-x-auto border border-ink-100 rounded-lg bg-white">
      <table className="w-full">
        <thead>
          <tr>
            <Th>#</Th>
            {columns.map((c) => (
              <Th key={c.key}>{c.label}</Th>
            ))}
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const err = rowError ? rowError(row) : null;
            return (
              <tr key={ri} className={err ? "bg-red-50" : ""}>
                <Td className="text-ink-400 text-xs">{ri + 1}</Td>
                {columns.map((c) => (
                  <td key={c.key} className="px-1 py-1 border-t border-ink-100">
                    {c.computed ? (
                      <span className={`block px-2 py-1 text-sm whitespace-nowrap ${c.className || "text-ink-600"}`}>
                        {c.computed(row)}
                      </span>
                    ) : readOnly ? (
                      <span className={`block px-2 py-1 text-sm whitespace-nowrap ${c.type === "number" ? "text-right tabular-nums" : ""}`}>
                        {c.type === "number" ? fmt(toNum(row[c.key])) : c.type === "select"
                          ? c.options.find((o) => o.value === str(row[c.key]))?.label || "-"
                          : str(row[c.key]) || "-"}
                      </span>
                    ) : c.type === "select" ? (
                      <select
                        className="w-full border border-transparent hover:border-ink-200 rounded px-1 py-1 text-sm bg-transparent"
                        value={str(row[c.key])}
                        onChange={(e) => setCell(ri, c.key, e.target.value)}
                      >
                        {c.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={c.type === "date" ? "date" : "text"}
                        inputMode={c.type === "number" ? "numeric" : undefined}
                        list={c.list}
                        className={`border border-transparent hover:border-ink-200 focus:border-brand-600 rounded px-2 py-1 text-sm bg-transparent ${
                          c.type === "number" ? "w-28 text-right" : c.type === "date" ? "w-36" : "w-36"
                        }`}
                        value={str(row[c.key])}
                        onChange={(e) =>
                          setCell(ri, c.key, c.type === "number" ? e.target.value.replace(/[^0-9-]/g, "") : e.target.value)
                        }
                        onPaste={(e) => onPaste(e, ri, c.key)}
                      />
                    )}
                  </td>
                ))}
                <td className="px-1 py-1 border-t border-ink-100 whitespace-nowrap">
                  {err && !readOnly && <span className="text-xs text-red-600 mr-2">{err}</span>}
                  {!readOnly && <button
                    onClick={() => setRows((rs) => rs.filter((_, i) => i !== ri))}
                    className="text-ink-400 hover:text-red-600 text-sm px-1"
                    title="Delete row"
                  >
                    ✕
                  </button>}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <Td className="text-ink-400" colSpan={columns.length + 2}>
                No rows yet.
              </Td>
            </tr>
          )}
        </tbody>
      </table>
      {!readOnly && <div className="px-3 py-2 border-t border-ink-100 flex items-center gap-4">
        <button onClick={() => setRows((rs) => [...rs, blankRow()])} className="text-sm text-brand-600 hover:underline">
          + Add row
        </button>
        <span className="text-xs text-ink-400">Tip: copy a block from Excel / Google Sheets and paste it into any cell.</span>
      </div>}
    </div>
  );
}

export const blankQuotationRow = () => ({ origin: "", destination: "", vehicle_type: "", vendor: "", cost: "", rate: "", margin_pct: "" });
export const blankOrderRow = () => ({
  order_no: "", order_date: "", origin: "", destination: "", vehicle_type: "", status: "",
  planned_vendor: "", est_cost: "", rate: "", actual_vendor: "", actual_invoice_cost: "",
  revenue_uang_jalan: "", revenue_overnight: "",
});

export const NUMERIC_QUOTATION = ["cost", "rate", "margin_pct"];
export const NUMERIC_ORDER = ["est_cost", "rate", "actual_invoice_cost", "revenue_uang_jalan", "revenue_overnight"];

export function TrackerSheetView({ shipperName, canUndo, canEdit = true, seeVendorData = true, onBack, onUndone }) {
  const [sheet, setSheet] = useState("quotation"); // "quotation" | "orders"
  const [quotation, setQuotation] = useState(null);
  const [orders, setOrders] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetch(`/api/profitability/sheet?shipper_name=${encodeURIComponent(shipperName)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load this shipper's sheet"))))
      .then((d) => {
        setQuotation(d.quotation.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, str(v)]))));
        setOrders(d.orders.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, str(v)]))));
      })
      .catch((e) => setMessage({ error: e.message }));
  }, [shipperName]);

  if (!quotation || !orders) {
    return <p className="text-sm text-ink-400">{message?.error || "Loading…"}</p>;
  }

  const quotationMap = {};
  for (const q of quotation) quotationMap[laneKeyFe(q.origin, q.destination, q.vehicle_type)] = q;
  const uniq = (key) => [...new Set(quotation.map((q) => q[key].trim()).filter(Boolean))].sort();

  const updateQuotation = (fn) => {
    setDirty(true);
    setMessage(null);
    setQuotation(fn);
  };
  const updateOrders = (fn) => {
    setDirty(true);
    setMessage(null);
    setOrders(fn);
  };

  // Typing an OD + vehicle that exists in Sheet 1 fills in vendor, cost and rate.
  const autofill = (row, key) => {
    if (!["origin", "destination", "vehicle_type"].includes(key)) return row;
    const q = quotationMap[laneKeyFe(row.origin, row.destination, row.vehicle_type)];
    return q ? { ...row, planned_vendor: q.vendor, est_cost: q.cost, rate: q.rate } : row;
  };

  const orderError = (row) => {
    if (!row.origin.trim() || !row.destination.trim() || !row.vehicle_type.trim()) return null;
    return quotationMap[laneKeyFe(row.origin, row.destination, row.vehicle_type)] ? null : "Tidak ada di quotation";
  };

  // Vendor names, costs and margins are VM-only (the backend sends them blank to sales).
  const VENDOR_KEYS = ["vendor", "cost", "margin_pct", "planned_vendor", "est_cost", "actual_vendor",
    "actual_invoice_cost", "est_margin", "actual_margin"];
  const visible = (cols) => (seeVendorData ? cols : cols.filter((c) => !VENDOR_KEYS.includes(c.key)));
  const quotationColumns = [
    { key: "origin", label: "Origin", type: "text", list: "dl-q-origin" },
    { key: "destination", label: "Destination", type: "text", list: "dl-q-destination" },
    { key: "vehicle_type", label: "Vehicle", type: "text", list: "dl-q-vehicle" },
    { key: "vendor", label: "Vendor", type: "text" },
    { key: "cost", label: "Cost", type: "number" },
    { key: "rate", label: "Rate", type: "number" },
    { key: "margin_pct", label: "Margin % (policy)", type: "number" },
  ];
  const orderColumns = [
    { key: "order_no", label: "Order No.", type: "text" },
    { key: "order_date", label: "Order Date", type: "date" },
    { key: "origin", label: "Origin", type: "text", list: "dl-q-origin" },
    { key: "destination", label: "Destination", type: "text", list: "dl-q-destination" },
    { key: "vehicle_type", label: "Vehicle", type: "text", list: "dl-q-vehicle" },
    { key: "status", label: "Status", type: "select", options: ORDER_STATUS_OPTIONS },
    { key: "planned_vendor", label: "Planned Vendor", type: "text" },
    { key: "est_cost", label: "Estimated Cost", type: "number" },
    { key: "rate", label: "Rate", type: "number" },
    { key: "actual_vendor", label: "Actual Vendor", type: "text" },
    { key: "actual_invoice_cost", label: "Actual Invoice Cost", type: "number" },
    { key: "revenue_uang_jalan", label: "Revenue (Uang Jalan)", type: "number" },
    { key: "revenue_overnight", label: "Revenue (Overnight)", type: "number" },
    {
      key: "total_revenue",
      label: "Total Revenue",
      computed: (r) =>
        toNum(r.rate) === null
          ? "-"
          : fmt(Math.round(toNum(r.rate) + (toNum(r.revenue_uang_jalan) || 0) + (toNum(r.revenue_overnight) || 0))),
    },
    {
      key: "est_margin",
      label: "Est. Margin %",
      computed: (r) => fmtPct(toNum(quotationMap[laneKeyFe(r.origin, r.destination, r.vehicle_type)]?.margin_pct)),
    },
    { key: "actual_margin", label: "Actual Margin %", computed: (r) => fmtPct(marginPct(r.rate, r.actual_invoice_cost)) },
  ];

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const toBody = (rows, numeric) =>
      rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, numeric.includes(k) ? toNum(v) : v === "" ? null : v])));
    const put = (path, rows) =>
      fetch(`/api/profitability/${path}?shipper_name=${encodeURIComponent(shipperName)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
    try {
      const qBody = toBody(quotation, NUMERIC_QUOTATION).map((r) => ({ ...r, origin: r.origin || "", destination: r.destination || "", vehicle_type: r.vehicle_type || "" }));
      const [qr, or] = [await put("quotation", qBody), await put("orders", toBody(orders, NUMERIC_ORDER))];
      if (!qr.ok || !or.ok) throw new Error("Save failed");
      setDirty(false);
      setMessage({ ok: "Saved." });
    } catch (e) {
      setMessage({ error: e.message });
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    if (!confirm(`Move ${shipperName} back to "Pilih Go Live"? Its sheets are kept.`)) return;
    await fetch("/api/profitability/undo-go-live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipper_names: [shipperName] }),
    });
    onUndone();
  };

  return (
    <div>
      <datalist id="dl-q-origin">{uniq("origin").map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="dl-q-destination">{uniq("destination").map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="dl-q-vehicle">{uniq("vehicle_type").map((v) => <option key={v} value={v} />)}</datalist>

      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-sm text-brand-600 hover:underline">
          ← Tracker
        </button>
        <h2 className="font-semibold text-lg">{shipperName}</h2>
        <span className="flex-1" />
        {message?.error && <span className="text-sm text-red-600">{message.error}</span>}
        {message?.ok && <span className="text-sm text-green-600">{message.ok}</span>}
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        {!canEdit && <span className="text-xs text-ink-500">View only</span>}
        {canUndo && (
          <button onClick={undo} className="text-xs px-2 py-1 rounded border border-ink-200 hover:bg-ink-50">
            Move back to Pilih Go Live
          </button>
        )}
        {canEdit && (
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-4 py-1.5 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-3">
        {[
          { key: "quotation", label: `Quotation Cost (${quotation.length})` },
          { key: "orders", label: `Orders (${orders.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setSheet(t.key)}
            className={`px-3 py-1.5 rounded-t text-sm font-medium ${
              sheet === t.key ? "bg-white border border-b-0 border-ink-200 text-brand-700" : "bg-ink-100 text-ink-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sheet === "quotation" ? (
        <div>
          <p className="text-xs text-ink-500 mb-2">
            Frozen from this shipper's priced lanes when it went live (cost, not the quoted price list). Edit freely —
            Sheet "Orders" looks lanes up here.
          </p>
          <EditableGrid columns={visible(quotationColumns)} rows={quotation} setRows={updateQuotation} blankRow={blankQuotationRow} readOnly={!canEdit} />
        </div>
      ) : (
        <div>
          <p className="text-xs text-ink-500 mb-2">
            Type origin, destination and vehicle: when the lane is in Quotation Cost, vendor, estimated cost and rate fill in
            automatically. Est. margin = the lane's policy margin in Quotation Cost (11.1% or 6.1%, incl. PPN). Actual margin =
            (rate − actual invoice cost) ÷ actual invoice cost. Total revenue = rate + uang jalan + overnight (no PPN added).
          </p>
          <EditableGrid
            readOnly={!canEdit}
            columns={visible(orderColumns)}
            rows={orders}
            setRows={updateOrders}
            blankRow={blankOrderRow}
            onCellEdited={autofill}
            rowError={orderError}
          />
        </div>
      )}
    </div>
  );
}

export function ProfitabilityView({ me }) {
  const users = useDirectoryUsers();
  const [tab, setTab] = useState("select"); // "select" | "tracker"
  const [candidates, setCandidates] = useState([]);
  const [tracker, setTracker] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [search, setSearch] = useState("");
  const [salesFilter, setSalesFilter] = useState("");
  const [openShipper, setOpenShipper] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const perms = me.permissions || {};
  const canUndo = !!perms.editProfitability;

  const load = () => {
    fetch("/api/profitability/candidates").then((r) => r.json()).then((d) => setCandidates(d.shippers || []));
    fetch("/api/profitability/tracker").then((r) => r.json()).then((d) => setTracker(d.shippers || []));
  };
  useEffect(load, []);

  const salesLabel = (x) =>
    x.sales_email ? userLabel(users.find((u) => u.email === x.sales_email) || { email: x.sales_email }) : x.sales_pic || "-";

  const s = search.trim().toLowerCase();
  const filtered = candidates.filter(
    (c) => (!s || c.shipper_name.toLowerCase().includes(s)) && (!salesFilter || salesKeyOf(c) === salesFilter)
  );
  const allPicked = filtered.length > 0 && filtered.every((c) => picked.has(c.shipper_name));

  const toggle = (name) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const confirmGoLive = async () => {
    const names = [...picked];
    if (names.length === 0) return;
    if (!confirm(`Confirm go live for ${names.length} shipper(s)?\n\n${names.join("\n")}`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profitability/go-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipper_names: names }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Could not confirm go live");
      }
      setPicked(new Set());
      load();
      setTab("tracker");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (openShipper) {
    return (
      <TrackerSheetView
        shipperName={openShipper}
        canUndo={canUndo}
        canEdit={!!perms.editProfitability}
        seeVendorData={!!perms.seeVendorData}
        onBack={() => {
          setOpenShipper(null);
          load();
        }}
        onUndone={() => {
          setOpenShipper(null);
          setTab("select");
          load();
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex gap-2 mb-6">
        {[
          { key: "select", label: `Pilih Go Live (${candidates.length})` },
          { key: "tracker", label: `Tracker (${tracker.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded text-sm font-medium ${
              tab === t.key ? "bg-brand-600 text-white" : "bg-white border border-gray-200 text-gray-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "select" ? (
        <div>
          <p className="text-sm text-ink-500 mb-3">
            Shippers whose requests are all closed. Tick the ones that are going live and confirm — they move to Tracker.
          </p>
          <FilterBar items={candidates} sales={salesFilter} setSales={setSalesFilter} hideShipper>
            <input
              className="flex-1 border border-ink-200 rounded px-3 py-2 text-sm"
              placeholder="Search shipper name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </FilterBar>
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
          <div className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>
                    <input
                      type="checkbox"
                      checked={allPicked}
                      disabled={filtered.length === 0}
                      onChange={() =>
                        setPicked((p) => {
                          const n = new Set(p);
                          filtered.forEach((c) => (allPicked ? n.delete(c.shipper_name) : n.add(c.shipper_name)));
                          return n;
                        })
                      }
                    />
                  </Th>
                  <Th>Shipper</Th>
                  <Th>Sales</Th>
                  <Th>Priced lanes</Th>
                  <Th>Last submitted</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.shipper_name}>
                    <Td>
                      <input type="checkbox" checked={picked.has(c.shipper_name)} onChange={() => toggle(c.shipper_name)} />
                    </Td>
                    <Td className="font-medium">{c.shipper_name}</Td>
                    <Td className="text-ink-500">{salesLabel(c)}</Td>
                    <Td>
                      {c.priced_lane_count} / {c.lane_count}
                    </Td>
                    <Td className="text-ink-500">{c.last_submitted_at.slice(0, 10)}</Td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <Td className="text-ink-400" colSpan={5}>
                      No shippers ready to go live.
                    </Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <button
            onClick={confirmGoLive}
            disabled={busy || picked.size === 0}
            className="mt-4 px-4 py-2 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Confirming…" : `Confirm go live (${picked.size})`}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {tracker.map((t) => (
            <button
              key={t.shipper_name}
              onClick={() => setOpenShipper(t.shipper_name)}
              className="w-full text-left bg-white rounded-xl border border-ink-100 shadow-sm px-4 py-3 hover:bg-ink-50"
            >
              <span className="font-semibold text-sm">{t.shipper_name}</span>
              <span className="ml-2 text-xs text-ink-400">{salesLabel(t)}</span>
              <span className="ml-3 text-xs text-ink-400">
                {t.quotation_count} lane(s) in quotation · {t.order_count} order(s) · live since {t.confirmed_at.slice(0, 10)}
              </span>
            </button>
          ))}
          {tracker.length === 0 && <p className="text-sm text-ink-400">No shippers are live yet.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
