import { Component, useEffect, useState } from "react";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("FTL Pricing Dashboard crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8">
          <p className="font-medium text-gray-700 mb-2">Something went wrong.</p>
          <p className="text-sm text-gray-500 mb-4">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const RATE_REQUEST_TEMPLATE_CSV =
  "L2 Origin,L2 Destinasi,Vehicle Type,Target Rate\n" +
  "Kab. Bekasi,Kota Surabaya,CDE,7000000\n" +
  "Kab. Bekasi,Kota Bandung,Wingbox,\n";
const RATE_REQUEST_TEMPLATE_URL = "data:text/csv;charset=utf-8," + encodeURIComponent(RATE_REQUEST_TEMPLATE_CSV);

const MASTER_RATE_TEMPLATE_CSV =
  "Origin L2,Destinasi L2,Vehicle Type,Cost/Rate,Vendor Name\n" +
  "Kab. Bekasi,Kota Surabaya,CDE,6500000,Duta Trans\n" +
  "Kab. Bekasi,Kota Surabaya,CDE,6800000,Seryu\n";
const MASTER_RATE_TEMPLATE_URL = "data:text/csv;charset=utf-8," + encodeURIComponent(MASTER_RATE_TEMPLATE_CSV);

const STATUS_LABEL = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed_no_vendor: "No Vendor Available",
};

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
  return <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{children}</th>;
}
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2 text-sm border-t border-gray-100 ${className}`}>{children}</td>;
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

const DEFAULT_SHIPPER_FORM = {
  shipper_name: "",
  sales_pic: "",
  shipper_status: "new",
  potential_monthly_revenue: "",
  commodity_type: "",
  high_value_fragile: false,
};

const PREDEFINED_ADD_ONS = ["Multi-drop (extra stop)", "Waiting time charge", "Insurance"];

const WIZARD_STEPS = [
  { key: "details", label: "Shipper details" },
  { key: "lanes", label: "Upload lanes" },
  { key: "result", label: "Result" },
];

function WizardSteps({ step }) {
  const idx = WIZARD_STEPS.findIndex((s) => s.key === step);
  return (
    <div className="flex gap-1 mb-6">
      {WIZARD_STEPS.map((s, i) => (
        <div
          key={s.key}
          className={`flex-1 text-center text-xs font-medium uppercase py-2 rounded ${
            i === idx ? "bg-gray-900 text-white" : i < idx ? "bg-gray-200 text-gray-500" : "bg-gray-100 text-gray-400"
          }`}
        >
          {i + 1}. {s.label}
        </div>
      ))}
    </div>
  );
}

function Discussion({ endpoint }) {
  const [comments, setComments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const load = () =>
    fetch(endpoint)
      .then((r) => r.json())
      .then((d) => {
        setComments(d.comments);
        setLoaded(true);
      })
      .catch(() => {});

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setComments(d.comments);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim() }),
      });
      setText("");
      await load();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Discussion</p>
      <div className="space-y-2 max-h-48 overflow-y-auto mb-2">
        {comments.map((c) => (
          <div key={c.id} className="text-sm">
            <span className="font-medium">{c.author_email}</span>{" "}
            <span className="text-gray-400 text-xs">{c.created_at}</span>
            <div className="text-gray-700">{c.message}</div>
          </div>
        ))}
        {loaded && comments.length === 0 && <p className="text-xs text-gray-400">No messages yet.</p>}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
          placeholder="Write a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button
          onClick={send}
          disabled={sending}
          className="text-xs px-3 py-1 rounded bg-gray-900 text-white hover:bg-gray-800"
        >
          Send
        </button>
      </div>
    </div>
  );
}

const UNKNOWN_SHIPPER_SALES = "Ad-hoc / unknown shipper";

function ShipperTicketGroup({ shipperName, tickets }) {
  const [expanded, setExpanded] = useState(false);
  const first = tickets[0];
  const submissionId = first.submission_id;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50"
      >
        <span className="text-sm">
          <span className="font-semibold">{shipperName}</span>
          {first.sales_pic && <span className="ml-2 text-xs text-gray-400">{first.sales_pic}</span>}
          <span className="ml-2 text-xs text-gray-400">
            ({tickets.length} lane{tickets.length !== 1 ? "s" : ""})
          </span>
        </span>
        <span className="text-xs text-gray-400">{expanded ? "Collapse" : "Expand"}</span>
      </button>
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3">
          {shipperName !== UNKNOWN_SHIPPER_SALES && (
            <div className="grid grid-cols-3 gap-3 text-sm mb-4 pb-4 border-b border-gray-100">
              <div>
                <span className="text-xs text-gray-400 block">Shipper</span>
                {first.shipper_name || "-"}
              </div>
              <div>
                <span className="text-xs text-gray-400 block">Sales PIC</span>
                {first.sales_pic || "-"}
              </div>
              <div>
                <span className="text-xs text-gray-400 block">Shipper Status</span>
                {first.shipper_status || "-"}
              </div>
              <div>
                <span className="text-xs text-gray-400 block">Potential Monthly Revenue</span>
                {fmt(first.potential_monthly_revenue)}
              </div>
              <div>
                <span className="text-xs text-gray-400 block">Commodity</span>
                {first.commodity_type || "-"}
              </div>
              <div>
                <span className="text-xs text-gray-400 block">High-value / Fragile</span>
                {first.high_value_fragile ? "Yes" : "No"}
              </div>
            </div>
          )}

          <table className="w-full mb-1">
            <thead>
              <tr>
                <Th>Origin</Th>
                <Th>Destination</Th>
                <Th>Vehicle</Th>
                <Th>Status</Th>
                <Th>Aging (days)</Th>
                <Th>Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <Td>{t.origin}</Td>
                  <Td>{t.destination}</Td>
                  <Td>{t.vehicle_type}</Td>
                  <Td>{STATUS_LABEL[t.status] || t.status}</Td>
                  <Td>{t.aging_days}</Td>
                  <Td className={t.status === "closed_no_vendor" ? "text-red-500" : "font-medium"}>
                    {t.status === "resolved"
                      ? `${t.resolved_vendor || ""} — ${fmt(t.current_final_rate)}`
                      : t.status === "closed_no_vendor"
                      ? "No vendor available"
                      : "-"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>

          <Discussion
            endpoint={
              submissionId ? `/api/submissions/${submissionId}/comments` : `/api/vm-requests/${first.id}/comments`
            }
          />
        </div>
      )}
    </div>
  );
}

function GlobalTicketsList({ tickets, emptyLabel }) {
  const [q, setQ] = useState("");
  const s = q.toLowerCase();
  const filteredTickets = tickets.filter(
    (t) =>
      !s ||
      (t.shipper_name || "").toLowerCase().includes(s) ||
      (t.sales_pic || "").toLowerCase().includes(s)
  );

  const groups = {};
  for (const t of filteredTickets) {
    const key = t.shipper_name || UNKNOWN_SHIPPER_SALES;
    (groups[key] = groups[key] || []).push(t);
  }
  const shipperNames = Object.keys(groups).sort((a, b) => {
    if (a === UNKNOWN_SHIPPER_SALES) return 1;
    if (b === UNKNOWN_SHIPPER_SALES) return -1;
    return a.localeCompare(b);
  });

  return (
    <div>
      <input
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-4"
        placeholder="Search by shipper name or sales PIC…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="space-y-2">
        {shipperNames.map((name) => (
          <ShipperTicketGroup key={name} shipperName={name} tickets={groups[name]} />
        ))}
        {shipperNames.length === 0 && <p className="text-sm text-gray-400">{emptyLabel}</p>}
      </div>
    </div>
  );
}

function SalesView() {
  const [mainTab, setMainTab] = useState("new");
  const [submissions, setSubmissions] = useState([]);
  const [active, setActive] = useState(null); // {submission, rows}
  const [globalTickets, setGlobalTickets] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [requested, setRequested] = useState({});

  const [step, setStep] = useState("details");
  const [shipperForm, setShipperForm] = useState(DEFAULT_SHIPPER_FORM);
  const [addOns, setAddOns] = useState(PREDEFINED_ADD_ONS.map((label) => ({ label, checked: false })));
  const [customAddOn, setCustomAddOn] = useState({ checked: false, label: "", value: "" });

  const loadSubmissions = () => {
    fetch("/api/submissions")
      .then((r) => r.json())
      .then((d) => setSubmissions(d.submissions));
  };

  const loadGlobalTickets = () => {
    fetch("/api/tickets")
      .then((r) => r.json())
      .then((d) => setGlobalTickets(d.requests));
  };

  useEffect(() => {
    loadSubmissions();
    loadGlobalTickets();
  }, []);

  const startNew = () => {
    setMainTab("new");
    setActive(null);
    setShipperForm(DEFAULT_SHIPPER_FORM);
    setAddOns(PREDEFINED_ADD_ONS.map((label) => ({ label, checked: false })));
    setCustomAddOn({ checked: false, label: "", value: "" });
    setError(null);
    setStep("details");
  };

  const goToLanes = () => {
    if (!shipperForm.shipper_name.trim() || !shipperForm.sales_pic.trim()) {
      setError("Shipper Name and Sales PIC are required");
      return;
    }
    setError(null);
    setStep("lanes");
  };

  const onUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const selectedAddOns = [
        ...addOns.filter((a) => a.checked).map((a) => ({ label: a.label })),
        ...(customAddOn.checked && customAddOn.label.trim()
          ? [{ label: customAddOn.label.trim(), value: customAddOn.value || null }]
          : []),
      ];

      const form = new FormData();
      form.append("file", file);
      form.append("shipper_name", shipperForm.shipper_name);
      form.append("sales_pic", shipperForm.sales_pic);
      form.append("shipper_status", shipperForm.shipper_status);
      form.append("potential_monthly_revenue", shipperForm.potential_monthly_revenue);
      form.append("commodity_type", shipperForm.commodity_type);
      form.append("high_value_fragile", shipperForm.high_value_fragile ? "true" : "false");
      form.append("add_ons_json", JSON.stringify(selectedAddOns));

      const res = await fetch("/api/submissions/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Upload failed");
      }
      const data = await res.json();
      setActive(data);
      setRequested({});
      setStep("result");
      loadSubmissions();
      loadGlobalTickets();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const openSubmission = (id) => {
    setMainTab("new");
    fetch(`/api/submissions/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setActive(d);
        setRequested({});
        setStep("result");
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
    loadGlobalTickets();
  };

  const activeTickets = globalTickets.filter((t) => t.status === "open" || t.status === "in_progress");
  const completedTickets = globalTickets.filter((t) => t.status === "resolved" || t.status === "closed_no_vendor");

  return (
    <div>
      <div className="flex gap-2 mb-6">
        {[
          { key: "new", label: "New Request" },
          { key: "active", label: `Active Request (${activeTickets.length})` },
          { key: "completed", label: `Completed Request (${completedTickets.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setMainTab(t.key)}
            className={`px-4 py-2 rounded text-sm font-medium ${
              mainTab === t.key ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mainTab === "active" && (
        <GlobalTicketsList tickets={activeTickets} emptyLabel="No active requests." />
      )}
      {mainTab === "completed" && (
        <GlobalTicketsList tickets={completedTickets} emptyLabel="No completed requests yet." />
      )}

      {mainTab === "new" && (
    <div className="flex gap-6">
      <div className="w-64 shrink-0">
        <button
          onClick={startNew}
          className="w-full mb-3 px-3 py-1.5 rounded text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"
        >
          + New submission
        </button>
        <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">Submission history</h3>
        <ul className="space-y-1">
          {submissions.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => openSubmission(s.id)}
                className="text-sm text-left w-full px-2 py-1.5 rounded hover:bg-gray-100"
              >
                <div className="truncate">{s.shipper_name || s.filename || `Submission #${s.id}`}</div>
                <div className="text-xs text-gray-400">{s.created_at}</div>
              </button>
            </li>
          ))}
          {submissions.length === 0 && <li className="text-sm text-gray-400">No submissions yet</li>}
        </ul>
      </div>

      <div className="flex-1 min-w-0">
        <WizardSteps step={step} />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {step === "details" && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-6">
            <div>
              <h2 className="font-semibold mb-3">Shipper details</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-500">Shipper Name *</label>
                  <input
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={shipperForm.shipper_name}
                    onChange={(e) => setShipperForm((f) => ({ ...f, shipper_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Sales PIC *</label>
                  <input
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={shipperForm.sales_pic}
                    onChange={(e) => setShipperForm((f) => ({ ...f, sales_pic: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">New or Existing Shipper</label>
                  <select
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={shipperForm.shipper_status}
                    onChange={(e) => setShipperForm((f) => ({ ...f, shipper_status: e.target.value }))}
                  >
                    <option value="new">New</option>
                    <option value="existing">Existing</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Potential Monthly Revenue (IDR)</label>
                  <input
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={shipperForm.potential_monthly_revenue}
                    onChange={(e) => setShipperForm((f) => ({ ...f, potential_monthly_revenue: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Commodity / Item Type</label>
                  <input
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={shipperForm.commodity_type}
                    onChange={(e) => setShipperForm((f) => ({ ...f, commodity_type: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">High-value or Fragile?</label>
                  <select
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
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
              <h2 className="font-semibold mb-3">Add-ons</h2>
              <p className="text-xs text-gray-400 mb-3">Recorded with the submission; doesn't change the computed Final Rate.</p>
              <div className="space-y-2">
                {addOns.map((a, i) => (
                  <label key={a.label} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={a.checked}
                      onChange={(e) =>
                        setAddOns((prev) => prev.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))
                      }
                    />
                    {a.label}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={customAddOn.checked}
                    onChange={(e) => setCustomAddOn((c) => ({ ...c, checked: e.target.checked }))}
                  />
                  Custom
                </label>
                {customAddOn.checked && (
                  <div className="flex gap-3 pl-6">
                    <input
                      placeholder="Label"
                      className="border border-gray-300 rounded px-2 py-1 text-sm"
                      value={customAddOn.label}
                      onChange={(e) => setCustomAddOn((c) => ({ ...c, label: e.target.value }))}
                    />
                    <input
                      placeholder="Value / notes (optional)"
                      className="border border-gray-300 rounded px-2 py-1 text-sm"
                      value={customAddOn.value}
                      onChange={(e) => setCustomAddOn((c) => ({ ...c, value: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={goToLanes}
              className="px-4 py-2 rounded text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"
            >
              Continue to upload lanes
            </button>
          </div>
        )}

        {step === "lanes" && (
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
            <button onClick={() => setStep("details")} className="block mt-4 text-sm text-gray-500 hover:underline">
              ← Back to shipper details
            </button>
          </div>
        )}

        {step === "result" &&
          (active ? (
            <div>
              <div className="flex items-center justify-end mb-3">
                <a
                  href={`/api/submissions/${active.submission.id}/quotation.xlsx`}
                  className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
                >
                  Download quotation (Excel)
                </a>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
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
            </div>
          ) : (
            <div className="text-sm text-gray-400 mt-8">Upload a CSV, or pick a past submission, to see results.</div>
          ))}
      </div>
    </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VM: master rates panel
// ---------------------------------------------------------------------------

function MasterRatesPanel() {
  const [meta, setMeta] = useState(null);
  const [rates, setRates] = useState([]);
  const [showExisting, setShowExisting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  const loadMeta = () => fetch("/api/master-rates/meta").then((r) => r.json()).then(setMeta);
  const loadRates = () => fetch("/api/master-rates").then((r) => r.json()).then((d) => setRates(d.rates));

  useEffect(() => {
    loadMeta();
  }, []);

  useEffect(() => {
    if (showExisting) loadRates();
  }, [showExisting]);

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
      if (showExisting) loadRates();
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
        Columns: Origin L2 | Destinasi L2 | Vehicle Type | Cost/Rate | Vendor Name.{" "}
        <a href={MASTER_RATE_TEMPLATE_URL} download="master_vendor_rate_template.csv" className="text-blue-600 hover:underline">
          Download template
        </a>
        . Uploads add/update rows — existing lanes not in the file are kept.
      </p>
      <input type="file" accept=".csv" onChange={onUpload} disabled={uploading} />
      {uploading && <p className="text-sm text-gray-500 mt-2">Processing…</p>}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      {ok && <p className="text-sm text-green-600 mt-2">{ok}</p>}
      {meta?.created_at ? (
        <p className="text-xs text-gray-400 mt-3">
          Last upload {meta.created_at} by {meta.uploaded_by} — {meta.row_count} row(s)
          {meta.filename ? ` (${meta.filename})` : ""}.
        </p>
      ) : (
        <p className="text-xs text-gray-400 mt-3">No master rates loaded yet.</p>
      )}

      <div className="mt-4 pt-4 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <button onClick={() => setShowExisting((v) => !v)} className="text-sm text-blue-600 hover:underline">
            {showExisting ? "Hide" : "View"} existing vendor rates
          </button>
          {showExisting && (
            <a href="/api/master-rates/export" className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50">
              Download CSV
            </a>
          )}
        </div>
        {showExisting && (
          <div className="mt-3 max-h-96 overflow-y-auto border border-gray-100 rounded">
            <table className="w-full">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <Th>Origin</Th>
                  <Th>Destination</Th>
                  <Th>Vehicle Type</Th>
                  <Th>Vendor</Th>
                  <Th>Cost</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r, i) => (
                  <tr key={i}>
                    <Td>{r.origin}</Td>
                    <Td>{r.destination}</Td>
                    <Td>{r.vehicle_type}</Td>
                    <Td>{r.vendor_name}</Td>
                    <Td>{fmt(r.cost)}</Td>
                    <Td className="text-gray-400 text-xs">{r.updated_by}</Td>
                  </tr>
                ))}
                {rates.length === 0 && (
                  <tr>
                    <Td className="text-gray-400" colSpan={6}>No vendor rates yet</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VM: prioritization (with view-more + per-column filters)
// ---------------------------------------------------------------------------

function LaneFilterTable({ lanes, onClose, showAvgTarget }) {
  const [filters, setFilters] = useState({ origin: "", destination: "", vehicle_type: "" });
  const filtered = lanes.filter(
    (l) =>
      l.origin.toLowerCase().includes(filters.origin.toLowerCase()) &&
      l.destination.toLowerCase().includes(filters.destination.toLowerCase()) &&
      l.vehicle_type.toLowerCase().includes(filters.vehicle_type.toLowerCase())
  );
  return (
    <div className="mt-3 border border-gray-200 rounded">
      <div className="flex justify-end p-2 border-b border-gray-100">
        <button onClick={onClose} className="text-xs text-gray-500 hover:underline">
          Collapse
        </button>
      </div>
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
                  className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs"
                  placeholder="Filter…"
                  value={filters.origin}
                  onChange={(e) => setFilters((f) => ({ ...f, origin: e.target.value }))}
                />
              </Td>
              <Td>
                <input
                  className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs"
                  placeholder="Filter…"
                  value={filters.destination}
                  onChange={(e) => setFilters((f) => ({ ...f, destination: e.target.value }))}
                />
              </Td>
              <Td>
                <input
                  className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs"
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
                <Td className="text-gray-400" colSpan={showAvgTarget ? 5 : 4}>No matches</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PrioritizationSection({ title, lanes, showAvgTarget }) {
  const [expanded, setExpanded] = useState(false);
  const [fullLanes, setFullLanes] = useState(null);

  const viewMore = async () => {
    if (!fullLanes) {
      const key = title === "Seeking a lower rate" ? "seeking_lower_rate" : "missing_lanes";
      const d = await fetch("/api/vm/summary?limit=500").then((r) => r.json());
      setFullLanes(d[key]);
    }
    setExpanded(true);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      {!expanded && (
        <>
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
                  <Td className="text-gray-400" colSpan={showAvgTarget ? 5 : 4}>None</Td>
                </tr>
              )}
            </tbody>
          </table>
          {lanes.length >= 10 && (
            <button onClick={viewMore} className="mt-2 text-sm text-blue-600 hover:underline">
              View more
            </button>
          )}
        </>
      )}
      {expanded && fullLanes && (
        <LaneFilterTable lanes={fullLanes} onClose={() => setExpanded(false)} showAvgTarget={showAvgTarget} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VM: per-request resolve panel
// ---------------------------------------------------------------------------

function ResolveRequestPanel({ request, onDone, onCancel }) {
  const [vendorRows, setVendorRows] = useState([{ vendor_name: "", cost: "" }]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const updateRow = (i, field, value) => {
    setVendorRows((rows) => rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  };
  const addRow = () => setVendorRows((rows) => [...rows, { vendor_name: "", cost: "" }]);
  const removeRow = (i) => setVendorRows((rows) => rows.filter((_, j) => j !== i));

  const submitManual = async () => {
    setBusy(true);
    setError(null);
    try {
      const vendor_costs = vendorRows
        .filter((r) => r.vendor_name.trim() && Number(r.cost) > 0)
        .map((r) => ({ vendor_name: r.vendor_name.trim(), cost: Number(r.cost) }));
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

  const closeNoVendor = async () => {
    if (!confirm("Close this ticket as 'no vendor available'? This cannot supply a rate for this OD.")) return;
    setBusy(true);
    try {
      await fetch(`/api/vm/requests/${request.id}/close-no-vendor`, { method: "POST" });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-gray-300 rounded-lg p-4 mt-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">
          {request.origin} → {request.destination} · {request.vehicle_type}
        </h3>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:underline">Close</button>
      </div>
      {request.target_cost != null && (
        <p className="text-sm text-gray-500 mb-3">Target cost to beat: <span className="font-medium">{fmt(request.target_cost)}</span></p>
      )}

      <div className="space-y-2 mb-3">
        <p className="text-xs text-gray-500 uppercase font-semibold">Enter vendor cost(s)</p>
        {vendorRows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input
              placeholder="Vendor name"
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
              value={r.vendor_name}
              onChange={(e) => updateRow(i, "vendor_name", e.target.value)}
            />
            <input
              placeholder="Cost"
              type="number"
              className="w-40 border border-gray-300 rounded px-2 py-1 text-sm"
              value={r.cost}
              onChange={(e) => updateRow(i, "cost", e.target.value)}
            />
            {vendorRows.length > 1 && (
              <button onClick={() => removeRow(i)} className="text-xs text-red-500">✕</button>
            )}
          </div>
        ))}
        <button onClick={addRow} className="text-xs text-blue-600 hover:underline">+ Add vendor</button>
      </div>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={submitManual}
          disabled={busy}
          className="px-3 py-1.5 rounded text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"
        >
          Save & Resolve
        </button>
        <span className="text-xs text-gray-400">or</span>
        <label className="text-sm text-blue-600 hover:underline cursor-pointer">
          Upload CSV for this lane
          <input type="file" accept=".csv" className="hidden" onChange={submitCsv} disabled={busy} />
        </label>
        <span className="flex-1" />
        <button onClick={closeNoVendor} disabled={busy} className="text-sm text-red-600 hover:underline">
          Close — no vendor available
        </button>
      </div>

      <Discussion
        endpoint={
          request.submission_id
            ? `/api/submissions/${request.submission_id}/comments`
            : `/api/vm-requests/${request.id}/comments`
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// VM: requests grouped by shipper
// ---------------------------------------------------------------------------

const UNKNOWN_SHIPPER = "Ad-hoc / unknown shipper";

function RequestsByShipper({ requests, selectedId, setSelectedId, updateStatus, onRefresh }) {
  const [collapsed, setCollapsed] = useState({});
  const [resolving, setResolving] = useState(null);

  const groups = {};
  for (const r of requests) {
    const key = r.shipper_name || UNKNOWN_SHIPPER;
    (groups[key] = groups[key] || []).push(r);
  }
  const shipperNames = Object.keys(groups).sort((a, b) => {
    if (a === UNKNOWN_SHIPPER) return 1;
    if (b === UNKNOWN_SHIPPER) return -1;
    return a.localeCompare(b);
  });

  const toggle = (name) => setCollapsed((c) => ({ ...c, [name]: !(c[name] ?? true) }));

  const resolveReady = async (name) => {
    setResolving(name);
    try {
      const key = name === UNKNOWN_SHIPPER ? "__unknown__" : name;
      const res = await fetch(`/api/vm/requests/resolve-ready?shipper_name=${encodeURIComponent(key)}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.resolved_count === 0) {
        alert("None of this shipper's open lanes have master-rate data yet.");
      }
      onRefresh();
    } finally {
      setResolving(null);
    }
  };

  return (
    <div className="space-y-4">
      {shipperNames.map((name) => {
        const rows = groups[name];
        const isCollapsed = collapsed[name] ?? true;
        const salesPic = rows[0].sales_pic || rows[0].requested_by;
        const openCount = rows.filter((r) => r.status === "open" || r.status === "in_progress").length;
        return (
          <div key={name} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
              <button onClick={() => toggle(name)} className="flex-1 text-left">
                <span className="font-semibold text-sm">{name}</span>
                <span className="ml-2 text-xs text-gray-400">{salesPic}</span>
                <span className="ml-2 text-xs text-gray-400">
                  ({rows.length} lane{rows.length !== 1 ? "s" : ""}, {openCount} open)
                </span>
                {openCount === 0 && <span className="ml-2 text-xs text-green-600 font-medium">✓ Complete</span>}
              </button>
              {openCount > 0 && (
                <button
                  onClick={() => resolveReady(name)}
                  disabled={resolving === name}
                  className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 mr-3"
                >
                  {resolving === name ? "Resolving…" : "Resolve all with existing rate"}
                </button>
              )}
              <button onClick={() => toggle(name)} className="text-xs text-gray-400">
                {isCollapsed ? "Expand" : "Collapse"}
              </button>
            </div>
            {!isCollapsed && (
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="w-full">
                  <thead>
                    <tr>
                      <Th>Origin</Th>
                      <Th>Destination</Th>
                      <Th>Vehicle</Th>
                      <Th>Requested by</Th>
                      <Th>Target Cost</Th>
                      <Th>Current Final Rate</Th>
                      <Th>Aging (days)</Th>
                      <Th>Status</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={selectedId === r.id ? "bg-gray-50" : ""}>
                        <Td>{r.origin}</Td>
                        <Td>{r.destination}</Td>
                        <Td>{r.vehicle_type}</Td>
                        <Td className="text-gray-500">{r.requested_by}</Td>
                        <Td>{r.target_cost != null ? fmt(r.target_cost) : "-"}</Td>
                        <Td>{r.current_final_rate != null ? fmt(r.current_final_rate) : "No rate yet"}</Td>
                        <Td>{r.aging_days}</Td>
                        <Td>
                          <select
                            value={r.status}
                            onChange={(e) => updateStatus(r.id, e.target.value)}
                            className="text-xs border border-gray-300 rounded px-1 py-0.5"
                          >
                            {Object.entries(STATUS_LABEL).map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                        </Td>
                        <Td>
                          {r.status === "open" || r.status === "in_progress" ? (
                            <button
                              onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                              className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                            >
                              {selectedId === r.id ? "Cancel" : "Fill rate"}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      {shipperNames.length === 0 && <p className="text-sm text-gray-400">No requests yet</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VM: view
// ---------------------------------------------------------------------------

function VmView() {
  const [tab, setTab] = useState("summary");
  const [summary, setSummary] = useState(null);
  const [requests, setRequests] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const loadSummary = () => fetch("/api/vm/summary").then((r) => r.json()).then(setSummary);
  const loadRequests = () => fetch("/api/vm/requests").then((r) => r.json()).then((d) => setRequests(d.requests));

  useEffect(() => {
    loadSummary();
    loadRequests();
  }, []);

  const updateStatus = async (id, status) => {
    await fetch(`/api/vm/requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    loadRequests();
    loadSummary();
  };

  const onResolveDone = () => {
    setSelectedId(null);
    loadRequests();
    loadSummary();
  };

  const selected = requests.find((r) => r.id === selectedId);

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
            {t === "summary" ? "Prioritization" : "By Sales Request"}
          </button>
        ))}
      </div>

      {tab === "summary" && summary && (
        <div className="grid grid-cols-2 gap-6">
          <PrioritizationSection title="Seeking a lower rate" lanes={summary.seeking_lower_rate} showAvgTarget />
          <PrioritizationSection title="Missing lanes (no rate at all)" lanes={summary.missing_lanes} />
        </div>
      )}

      {tab === "requests" && (
        <div>
          <RequestsByShipper
            requests={requests}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            updateStatus={updateStatus}
            onRefresh={() => {
              loadRequests();
              loadSummary();
            }}
          />

          {selected && (
            <ResolveRequestPanel request={selected} onDone={onResolveDone} onCancel={() => setSelectedId(null)} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Superadmin
// ---------------------------------------------------------------------------

function AdminPanel() {
  const [users, setUsers] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("sales");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadUsers = () => fetch("/api/admin/users").then((r) => r.json()).then((d) => setUsers(d.users));
  useEffect(() => {
    loadUsers();
  }, []);

  const addUser = async (e) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to add user");
      }
      setNewEmail("");
      setNewRole("sales");
      loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (email, role) => {
    await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    loadUsers();
  };

  const removeUser = async (email) => {
    await fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: "DELETE" });
    loadUsers();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Add user</h2>
        <form onSubmit={addUser} className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-gray-500">Email</label>
            <input
              type="email"
              required
              className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@ninjavan.co"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Role</label>
            <select
              className="mt-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              <option value="sales">Sales</option>
              <option value="vm">VM</option>
              <option value="superadmin">Superadmin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 rounded text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"
          >
            Add
          </button>
        </form>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email}>
                <Td>{u.email}</Td>
                <Td>
                  <select
                    value={u.role}
                    onChange={(e) => changeRole(u.email, e.target.value)}
                    className="text-xs border border-gray-300 rounded px-1 py-0.5"
                  >
                    <option value="sales">Sales</option>
                    <option value="vm">VM</option>
                    <option value="superadmin">Superadmin</option>
                  </select>
                </Td>
                <Td>
                  <button onClick={() => removeUser(u.email)} className="text-xs text-red-600 hover:underline">
                    Remove
                  </button>
                </Td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <Td className="text-gray-400" colSpan={3}>No users yet</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

function AppInner() {
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
      <div className="bg-amber-500 text-white text-center text-xs font-semibold uppercase tracking-wide py-1.5">
        FTL On-Call Only
      </div>
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="font-semibold">FTL Pricing Dashboard</h1>
          {isSuperadmin && (
            <div className="flex gap-1">
              {["sales", "vm", "admin"].map((v) => (
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
      <main className="p-6 max-w-6xl mx-auto">
        {activeView === "sales" && <SalesView />}
        {activeView === "vm" && <VmView />}
        {activeView === "admin" && <AdminPanel />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
