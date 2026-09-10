import { useEffect, useState } from "react";

const RATE_REQUEST_TEMPLATE_CSV =
  "L2 Origin,L2 Destinasi,Vehicle Type,Target Rate\n" +
  "Kab. Bekasi,Kota Surabaya,CDE,7000000\n" +
  "Kab. Bekasi,Kota Bandung,Wingbox,\n";

const RATE_REQUEST_TEMPLATE_URL =
  "data:text/csv;charset=utf-8," + encodeURIComponent(RATE_REQUEST_TEMPLATE_CSV);

function fmt(n) {
  if (n === null || n === undefined) return "-";
  return new Intl.NumberFormat("id-ID").format(n);
}

function useMe() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then(setMe)
      .finally(() => setLoading(false));
  }, []);
  return { me, loading };
}

function Th({ children }) {
  return <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">{children}</th>;
}
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2 text-sm border-t border-gray-100 ${className}`}>{children}</td>;
}

function SalesView() {
  const [submissions, setSubmissions] = useState([]);
  const [active, setActive] = useState(null); // {submission, rows}
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [requested, setRequested] = useState({});

  const loadSubmissions = () => {
    fetch("/api/submissions")
      .then((r) => r.json())
      .then((d) => setSubmissions(d.submissions));
  };

  useEffect(loadSubmissions, []);

  const onUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/submissions/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Upload failed");
      }
      const data = await res.json();
      setActive(data);
      setRequested({});
      loadSubmissions();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const openSubmission = (id) => {
    fetch(`/api/submissions/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setActive(d);
        setRequested({});
      });
  };

  const requestVm = async (row) => {
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
    setRequested((r) => ({ ...r, [row.id]: true }));
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-2">Upload rate request CSV</h2>
        <p className="text-sm text-gray-500 mb-3">
          Columns: L2 Origin | L2 Destinasi | Vehicle Type | Target Rate (optional).{" "}
          <a
            href={RATE_REQUEST_TEMPLATE_URL}
            download="ftl_rate_request_template.csv"
            className="text-blue-600 hover:underline"
          >
            Download template
          </a>
        </p>
        <input type="file" accept=".csv" onChange={onUpload} disabled={uploading} />
        {uploading && <p className="text-sm text-gray-500 mt-2">Processing…</p>}
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      <div className="flex gap-6">
        <div className="w-64 shrink-0">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">Submission history</h3>
          <ul className="space-y-1">
            {submissions.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => openSubmission(s.id)}
                  className="text-sm text-left w-full px-2 py-1.5 rounded hover:bg-gray-100"
                >
                  <div className="truncate">{s.filename || `Submission #${s.id}`}</div>
                  <div className="text-xs text-gray-400">{s.created_at}</div>
                </button>
              </li>
            ))}
            {submissions.length === 0 && <li className="text-sm text-gray-400">No submissions yet</li>}
          </ul>
        </div>

        <div className="flex-1 min-w-0">
          {active ? (
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>L2 Origin</Th>
                    <Th>L2 Destinasi</Th>
                    <Th>Vehicle Type</Th>
                    <Th>Target Rate</Th>
                    <Th>Final Rate</Th>
                    <Th>Remarks</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {active.rows.map((row) => (
                    <tr key={row.id}>
                      <Td>{row.origin}</Td>
                      <Td>{row.destination}</Td>
                      <Td>{row.vehicle_type}</Td>
                      <Td>{fmt(row.target_rate)}</Td>
                      <Td className={row.final_rate == null ? "text-gray-400" : "font-medium"}>
                        {fmt(row.final_rate)}
                      </Td>
                      <Td className="text-gray-500">{row.remarks}</Td>
                      <Td>
                        {requested[row.id] ? (
                          <span className="text-xs text-green-600">Requested</span>
                        ) : (
                          <button
                            onClick={() => requestVm(row)}
                            className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                          >
                            Request to VM
                          </button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-gray-400 mt-8">Upload a CSV, or pick a past submission, to see results.</div>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL = { open: "Open", in_progress: "In progress", resolved: "Resolved" };

function MasterRatesPanel() {
  const [meta, setMeta] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  const loadMeta = () => fetch("/api/master-rates/meta").then((r) => r.json()).then(setMeta);
  useEffect(loadMeta, []);

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
      setOk(`Loaded ${data.row_count} lanes.`);
      loadMeta();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
      <h2 className="font-semibold mb-2">Master vendor rates</h2>
      <p className="text-sm text-gray-500 mb-3">
        Upload a CSV export of the "Database Rate" tab (File → Download → CSV in Google Sheets)
        whenever the master sheet changes. This replaces the previous data entirely.
      </p>
      <input type="file" accept=".csv" onChange={onUpload} disabled={uploading} />
      {uploading && <p className="text-sm text-gray-500 mt-2">Processing…</p>}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      {ok && <p className="text-sm text-green-600 mt-2">{ok}</p>}
      {meta?.created_at && (
        <p className="text-xs text-gray-400 mt-3">
          Last loaded {meta.created_at} by {meta.uploaded_by} — {meta.row_count} lanes
          {meta.filename ? ` (${meta.filename})` : ""}.
        </p>
      )}
      {!meta?.created_at && <p className="text-xs text-gray-400 mt-3">No master rates loaded yet.</p>}
    </div>
  );
}

function VmView() {
  const [tab, setTab] = useState("summary");
  const [summary, setSummary] = useState(null);
  const [requests, setRequests] = useState([]);

  const loadSummary = () => fetch("/api/vm/summary").then((r) => r.json()).then(setSummary);
  const loadRequests = () => fetch("/api/vm/requests").then((r) => r.json()).then((d) => setRequests(d.requests));

  useEffect(() => {
    loadSummary();
    loadRequests();
  }, []);

  const updateRequest = async (id, patch) => {
    await fetch(`/api/vm/requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    loadRequests();
    loadSummary();
  };

  return (
    <div>
      <MasterRatesPanel />

      <div className="flex gap-2 mb-4">
        {["summary", "requests"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              tab === t ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600"
            }`}
          >
            {t === "summary" ? "Prioritization" : "Requests"}
          </button>
        ))}
      </div>

      {tab === "summary" && summary && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold mb-3">Seeking a lower rate</h3>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Lane</Th>
                  <Th>Vehicle</Th>
                  <Th>Requests</Th>
                </tr>
              </thead>
              <tbody>
                {summary.seeking_lower_rate.map((l, i) => (
                  <tr key={i}>
                    <Td>{l.origin} → {l.destination}</Td>
                    <Td>{l.vehicle_type}</Td>
                    <Td>{l.request_count}</Td>
                  </tr>
                ))}
                {summary.seeking_lower_rate.length === 0 && (
                  <tr><Td className="text-gray-400" colSpan={3}>None</Td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold mb-3">Missing lanes (no rate at all)</h3>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Lane</Th>
                  <Th>Vehicle</Th>
                  <Th>Requests</Th>
                </tr>
              </thead>
              <tbody>
                {summary.missing_lanes.map((l, i) => (
                  <tr key={i}>
                    <Td>{l.origin} → {l.destination}</Td>
                    <Td>{l.vehicle_type}</Td>
                    <Td>{l.request_count}</Td>
                  </tr>
                ))}
                {summary.missing_lanes.length === 0 && (
                  <tr><Td className="text-gray-400" colSpan={3}>None</Td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "requests" && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <Th>Lane</Th>
                <Th>Vehicle</Th>
                <Th>Requested by</Th>
                <Th>Target Cost</Th>
                <Th>Current Final Rate</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <Td>{r.origin} → {r.destination}</Td>
                  <Td>{r.vehicle_type}</Td>
                  <Td className="text-gray-500">{r.requested_by}</Td>
                  <Td>{r.target_cost != null ? fmt(r.target_cost) : "-"}</Td>
                  <Td>{r.current_final_rate != null ? fmt(r.current_final_rate) : "No rate yet"}</Td>
                  <Td>
                    <select
                      value={r.status}
                      onChange={(e) => updateRequest(r.id, { status: e.target.value })}
                      className="text-xs border border-gray-300 rounded px-1 py-0.5"
                    >
                      {Object.entries(STATUS_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </Td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr><Td className="text-gray-400" colSpan={6}>No requests yet</Td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { me, loading } = useMe();
  const [view, setView] = useState("sales");

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  if (!me?.email) {
    return <div className="p-8 text-gray-500">Sign in required.</div>;
  }

  if (!me.role) {
    return (
      <div className="p-8 text-gray-500">
        <p className="font-medium text-gray-700">Not provisioned</p>
        <p className="text-sm mt-1">
          {me.email} isn't set up as sales or vendor management yet. Ask an admin to add you.
        </p>
      </div>
    );
  }

  const isSuperadmin = me.role === "superadmin";
  const activeView = isSuperadmin ? view : me.role;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="font-semibold">FTL Pricing Dashboard</h1>
          {isSuperadmin && (
            <div className="flex gap-1">
              {["sales", "vm"].map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-2.5 py-1 rounded text-xs font-medium uppercase ${
                    activeView === v ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="text-sm text-gray-500">
          {me.email} <span className="ml-2 px-2 py-0.5 rounded bg-gray-100 text-xs uppercase">{me.role}</span>
        </div>
      </header>
      <main className="p-6 max-w-6xl mx-auto">{activeView === "sales" ? <SalesView /> : <VmView />}</main>
    </div>
  );
}
