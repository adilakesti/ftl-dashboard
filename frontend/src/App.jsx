import { Component, Fragment, useEffect, useState } from "react";

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
          <p className="font-medium text-ink-700 mb-2">Something went wrong.</p>
          <p className="text-sm text-ink-500 mb-4">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700"
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
  "L2 Origin,L2 Destinasi,Vehicle Type,Target Rate,Minimum dedicated trip,Minimum trip\n" +
  "Kab. Bekasi,Kota Surabaya,CDE,7000000,10,20\n" +
  "Kab. Bekasi,Kota Bandung,Wingbox,,,\n";
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
  closed_no_lower_rate: "No Lower Rate Found",
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
  return <th className="text-left px-3 py-2 text-xs font-semibold text-ink-500 uppercase whitespace-nowrap">{children}</th>;
}
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2 text-sm border-t border-ink-100 ${className}`}>{children}</td>;
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

const DEFAULT_SHIPPER_FORM = {
  shipper_name: "",
  sales_email: "",
  shipper_status: "new",
  potential_monthly_revenue: "",
  commodity_type: "",
  high_value_fragile: false,
};

const ADD_ON_RATES = {
  rdo: { jawa: 7000, luar_jawa: 14000 },
  overnight: 1000000,
  additional_drop: 500000,
};

const DEFAULT_ADD_ONS_STATE = {
  rdo: { checked: false, region: "jawa", qty: "" },
  overnight: { checked: false },
  additional_drop: { checked: false, qty: "" },
  custom: { checked: false, label: "", value: "" },
};

function idr(n) {
  return "Rp" + new Intl.NumberFormat("id-ID").format(n);
}

function buildAddOns(a) {
  const out = [];
  if (a.rdo.checked) {
    const qty = Number(a.rdo.qty) || 0;
    const rate = ADD_ON_RATES.rdo[a.rdo.region];
    const regionLabel = a.rdo.region === "jawa" ? "Jawa" : "Diluar Jawa";
    out.push({ label: "RDO", value: `${qty} RDO x ${idr(rate)} (${regionLabel}) = ${idr(qty * rate)}` });
  }
  if (a.overnight.checked) {
    out.push({ label: "Overnight", value: idr(ADD_ON_RATES.overnight) });
  }
  if (a.additional_drop.checked) {
    const qty = Number(a.additional_drop.qty) || 0;
    const rate = ADD_ON_RATES.additional_drop;
    out.push({
      label: "Additional Drop Point",
      value: `${qty} point x ${idr(rate)} (same city) = ${idr(qty * rate)}`,
    });
  }
  if (a.custom.checked && a.custom.label.trim()) {
    out.push({ label: a.custom.label.trim(), value: a.custom.value || null });
  }
  return out;
}

let directoryUsersPromise = null;
function fetchDirectoryUsers() {
  if (!directoryUsersPromise) {
    directoryUsersPromise = fetch("/api/users")
      .then((r) => r.json())
      .then((d) => d.users)
      .catch(() => []);
  }
  return directoryUsersPromise;
}

function resetDirectoryUsers() {
  directoryUsersPromise = null;
}

function useDirectoryUsers() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    fetchDirectoryUsers().then(setUsers);
  }, []);
  return users;
}

const userLabel = (u) => u.display_name || u.email;

// Sales identity of a lane/ticket: the linked sales user, or (legacy submissions,
// from before Sales PIC became a dropdown) the name that was typed in.
const salesKeyOf = (x) => (x.sales_email ? `e:${x.sales_email}` : x.sales_pic ? `l:${x.sales_pic}` : "");

function FilterBar({ items, shipper, setShipper, sales, setSales, hideShipper, children }) {
  const users = useDirectoryUsers();
  const shippers = [...new Set(items.map((x) => x.shipper_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const salesOptions = [];
  const seen = new Set();
  for (const x of items) {
    const key = salesKeyOf(x);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const label = key.startsWith("e:")
      ? userLabel(users.find((u) => u.email === x.sales_email) || { email: x.sales_email })
      : `${x.sales_pic} (legacy)`;
    salesOptions.push({ key, label });
  }
  salesOptions.sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="flex gap-3 mb-4">
      {children}
      {!hideShipper && (
        <select
          className="border border-ink-200 rounded px-3 py-2 text-sm bg-white"
          value={shipper}
          onChange={(e) => setShipper(e.target.value)}
        >
          <option value="">All shippers</option>
          {shippers.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
      <select
        className="border border-ink-200 rounded px-3 py-2 text-sm bg-white"
        value={sales}
        onChange={(e) => setSales(e.target.value)}
      >
        <option value="">All sales</option>
        {salesOptions.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const matchesFilters = (x, shipper, sales) =>
  (!shipper || x.shipper_name === shipper) && (!sales || salesKeyOf(x) === sales);

const MENTION_RE = /@(\w[\w.]*)/g;

function renderWithMentions(message) {
  const parts = [];
  let last = 0;
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(message))) {
    if (m.index > last) parts.push(message.slice(last, m.index));
    parts.push(
      <span key={m.index} className="text-brand-600 font-medium">
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < message.length) parts.push(message.slice(last));
  return parts;
}

function Discussion({ endpoint, id }) {
  const [comments, setComments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [users, setUsers] = useState([]);
  const [mentionOptions, setMentionOptions] = useState([]);

  useEffect(() => {
    fetchDirectoryUsers().then(setUsers);
  }, []);

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

  const onTextChange = (e) => {
    const value = e.target.value;
    setText(value);
    const m = value.match(/@(\w*)$/);
    if (m) {
      const q = m[1].toLowerCase();
      setMentionOptions(users.filter((u) => u.email.split("@")[0].toLowerCase().startsWith(q)).slice(0, 6));
    } else {
      setMentionOptions([]);
    }
  };

  const pickMention = (email) => {
    const local = email.split("@")[0];
    setText((t) => t.replace(/@(\w*)$/, `@${local} `));
    setMentionOptions([]);
  };

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
      setMentionOptions([]);
      await load();
    } finally {
      setSending(false);
    }
  };

  return (
    <div id={id} className="mt-3 border-t border-ink-100 pt-3">
      <p className="text-xs text-ink-500 uppercase font-semibold mb-2">Discussion</p>
      <div className="space-y-2 max-h-64 overflow-y-auto mb-2 bg-ink-50 rounded-lg p-2">
        {comments.map((c) => (
          <div
            key={c.id}
            className={`rounded-lg px-3 py-2 shadow-sm text-sm ${
              c.author_email === "system" ? "bg-amber-50 border border-amber-200" : "bg-white"
            }`}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-medium">
                {c.author_email === "system" ? "⚙ System" : c.author_email}
              </span>
              <span className="text-ink-400 text-xs">{c.created_at}</span>
            </div>
            <div className="text-ink-700 whitespace-pre-wrap">{renderWithMentions(c.message)}</div>
          </div>
        ))}
        {loaded && comments.length === 0 && <p className="text-xs text-ink-400 px-1">No messages yet.</p>}
      </div>
      <div className="relative">
        {mentionOptions.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1 w-64 bg-white border border-ink-200 rounded-lg shadow-lg overflow-hidden z-10">
            {mentionOptions.map((u) => (
              <button
                key={u.email}
                onClick={() => pickMention(u.email)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-ink-50 flex justify-between"
              >
                <span>{u.display_name ? `${u.display_name} · ${u.email}` : u.email}</span>
                <span className="text-ink-400 uppercase">{u.role}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            className="flex-1 border border-ink-200 rounded px-2 py-1 text-sm"
            placeholder="Write a message… (@ to mention someone)"
            value={text}
            onChange={onTextChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && mentionOptions.length === 0) send();
            }}
          />
          <button
            onClick={send}
            disabled={sending}
            className="text-xs px-3 py-1 rounded bg-brand-600 text-white hover:bg-brand-700"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

const UNKNOWN_SHIPPER_SALES = "Ad-hoc / unknown shipper";

function ShipperLaneGroup({ shipperName, lanes, kind, focusSubmissionId, onFocusHandled, onOpenDiscussion }) {
  const [expanded, setExpanded] = useState(false);
  const first = lanes[0];

  const bySubmission = {};
  for (const l of lanes) {
    const cur = bySubmission[l.submission_id];
    if (!cur || new Date(l.submitted_at) > new Date(cur)) bySubmission[l.submission_id] = l.submitted_at;
  }
  const submissions = Object.entries(bySubmission)
    .map(([id, date]) => ({ id: Number(id), date }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const primarySubmissionId = submissions[0]?.id;
  const anchorId = `shipper-group-${encodeURIComponent(shipperName)}`;

  const toggleAndOpen = () => {
    setExpanded((v) => {
      const next = !v;
      if (next && primarySubmissionId) onOpenDiscussion(`/api/submissions/${primarySubmissionId}/comments`);
      return next;
    });
  };

  useEffect(() => {
    if (!focusSubmissionId || !submissions.some((sub) => sub.id === focusSubmissionId)) return;
    setExpanded(true);
    onOpenDiscussion(`/api/submissions/${focusSubmissionId}/comments`);
    setTimeout(() => {
      document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    onFocusHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSubmissionId]);

  return (
    <div id={anchorId} className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 hover:bg-ink-50">
        <button onClick={toggleAndOpen} className="flex-1 text-left">
          <span className="text-sm">
            <span className="font-semibold">{shipperName}</span>
            {first.sales_pic && <span className="ml-2 text-xs text-ink-400">{first.sales_pic}</span>}
            <span className="ml-2 text-xs text-ink-400">
              ({lanes.length} lane{lanes.length !== 1 ? "s" : ""})
            </span>
            {first.add_ons?.length > 0 && (
              <span className="ml-2 text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded-full">
                + {first.add_ons.map((a) => a.label).join(", ")}
              </span>
            )}
          </span>
        </button>
        <button
          onClick={() => primarySubmissionId && onOpenDiscussion(`/api/submissions/${primarySubmissionId}/comments`)}
          className="text-xs px-2.5 py-1 rounded border border-ink-200 hover:bg-white mr-3"
        >
          💬 Discussion
        </button>
        <div className="flex gap-1 mr-3">
          {submissions.map((sub) => (
            <a
              key={sub.id}
              href={`/api/submissions/${sub.id}/quotation.xlsx`}
              onClick={(e) => e.stopPropagation()}
              title={`Quotation for the ${sub.date} submission`}
              className="text-xs px-2 py-1 rounded border border-ink-200 hover:bg-white whitespace-nowrap"
            >
              Quotation {sub.date.slice(0, 10)}
            </a>
          ))}
        </div>
        <button onClick={toggleAndOpen} className="text-xs text-ink-400">
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-ink-100 px-4 py-3">
          <table className="w-full mb-1">
            <thead>
              <tr>
                <Th>Submitted</Th>
                <Th>Origin</Th>
                <Th>Destination</Th>
                <Th>Vehicle</Th>
                <Th>Target Rate</Th>
                <Th>Final Rate</Th>
                <Th>Remarks</Th>
                <Th>Min Ded. Trip</Th>
                <Th>Min Trip</Th>
                {kind === "active" && <Th>Aging (days)</Th>}
              </tr>
            </thead>
            <tbody>
              {lanes.map((l) => (
                <tr key={l.id}>
                  <Td className="text-ink-500 whitespace-nowrap">{l.submitted_at}</Td>
                  <Td>{l.origin}</Td>
                  <Td>{l.destination}</Td>
                  <Td>{l.vehicle_type}</Td>
                  <Td>{fmt(l.target_rate)}</Td>
                  <Td className={l.final_rate == null ? "text-ink-400" : "font-medium"}>{fmt(l.final_rate)}</Td>
                  <Td className={(l.remarks || "").startsWith("No vendor available") ? "text-red-500" : "text-ink-500"}>
                    {l.remarks || "-"}
                    {l.auto_closed_sla && (
                      <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                        Auto-closed (SLA)
                      </span>
                    )}
                  </Td>
                  <Td>{l.min_dedicated_trip ?? "-"}</Td>
                  <Td>{l.min_trip ?? "-"}</Td>
                  {kind === "active" && <Td>{l.aging_days ?? "-"}</Td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GlobalLanesList({ lanes, emptyLabel, kind, focusSubmissionId, onFocusHandled, onOpenDiscussion }) {
  const [shipperFilter, setShipperFilter] = useState("");
  const [salesFilter, setSalesFilter] = useState("");
  const filtered = lanes.filter((l) => matchesFilters(l, shipperFilter, salesFilter));

  const groups = {};
  for (const l of filtered) {
    const key = l.shipper_name || UNKNOWN_SHIPPER_SALES;
    (groups[key] = groups[key] || []).push(l);
  }
  const shipperNames = Object.keys(groups).sort((a, b) => {
    if (a === UNKNOWN_SHIPPER_SALES) return 1;
    if (b === UNKNOWN_SHIPPER_SALES) return -1;
    return a.localeCompare(b);
  });

  return (
    <div>
      <FilterBar
        items={lanes}
        shipper={shipperFilter}
        setShipper={setShipperFilter}
        sales={salesFilter}
        setSales={setSalesFilter}
      />
      <div className="space-y-2">
        {shipperNames.map((name) => (
          <ShipperLaneGroup
            key={name}
            shipperName={name}
            lanes={groups[name]}
            kind={kind}
            focusSubmissionId={focusSubmissionId}
            onFocusHandled={onFocusHandled}
            onOpenDiscussion={onOpenDiscussion}
          />
        ))}
        {shipperNames.length === 0 && <p className="text-sm text-ink-400">{emptyLabel}</p>}
      </div>
    </div>
  );
}

const CSV_ALIASES = {
  "l2 origin": "origin",
  "origin": "origin",
  "l2 destinasi": "destination",
  "l2 destination": "destination",
  "destination": "destination",
  "vehicle type": "vehicle_type",
  "target rate": "target_rate",
  "minimum dedicated trip": "min_dedicated_trip",
  "min dedicated trip": "min_dedicated_trip",
  "minimum trip": "min_trip",
  "min trip": "min_trip",
};

function parseCsvPreview(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const colmap = {};
  header.forEach((h, i) => {
    const key = CSV_ALIASES[h.toLowerCase()];
    if (key) colmap[i] = key;
  });
  return lines
    .slice(1)
    .map((line) => {
      const cells = line.split(",");
      const row = {};
      Object.entries(colmap).forEach(([i, key]) => {
        row[key] = (cells[Number(i)] || "").trim();
      });
      return row;
    })
    .filter((r) => r.origin && r.destination && r.vehicle_type);
}

function SalesView({ focusSubmissionId, onFocusHandled }) {
  const [mainTab, setMainTab] = useState("new");
  const [submissions, setSubmissions] = useState([]);
  const [active, setActive] = useState(null); // {submission, rows} — set once "Check Result" runs
  const [lanes, setLanes] = useState([]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [requested, setRequested] = useState({});
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkRequesting, setBulkRequesting] = useState(false);
  const [discussionEndpoint, setDiscussionEndpoint] = useState(null);

  const salesUsers = useDirectoryUsers().filter((u) => u.role === "sales");
  const [shipperForm, setShipperForm] = useState(DEFAULT_SHIPPER_FORM);
  const [addOnsState, setAddOnsState] = useState(DEFAULT_ADD_ONS_STATE);
  const [file, setFile] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [uploadMode, setUploadMode] = useState("csv"); // "csv" | "manual"
  const [manualRows, setManualRows] = useState([{ origin: "", destination: "", vehicle_type: "", target_rate: "", min_dedicated_trip: "", min_trip: "" }]);

  const loadSubmissions = () => {
    fetch("/api/submissions")
      .then((r) => r.json())
      .then((d) => setSubmissions(d.submissions));
  };

  const loadLanes = () => {
    fetch("/api/lanes")
      .then((r) => r.json())
      .then((d) => setLanes(d.lanes));
  };

  useEffect(() => {
    loadSubmissions();
    loadLanes();
  }, []);

  const startNew = () => {
    setMainTab("new");
    setActive(null);
    setShipperForm(DEFAULT_SHIPPER_FORM);
    setAddOnsState(DEFAULT_ADD_ONS_STATE);
    setFile(null);
    setPreviewRows([]);
    setUploadMode("csv");
    setManualRows([{ origin: "", destination: "", vehicle_type: "", target_rate: "", min_dedicated_trip: "", min_trip: "" }]);
    setSelectedIds(new Set());
    setError(null);
  };

  const updateManualRow = (i, field, value) => {
    setActive(null);
    setManualRows((rows) => rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  };
  const addManualRow = () => {
    setManualRows((rows) => [...rows, { origin: "", destination: "", vehicle_type: "", target_rate: "", min_dedicated_trip: "", min_trip: "" }]);
  };
  const removeManualRow = (i) => {
    setActive(null);
    setManualRows((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : rows));
  };

  const manualRowsFilled = manualRows.filter((r) => r.origin.trim() && r.destination.trim() && r.vehicle_type.trim());

  const manualRowsToCsvFile = () => {
    const lines = ["L2 Origin,L2 Destinasi,Vehicle Type,Target Rate,Minimum dedicated trip,Minimum trip"];
    for (const r of manualRowsFilled) {
      lines.push(
        [r.origin, r.destination, r.vehicle_type, r.target_rate || "", r.min_dedicated_trip || "", r.min_trip || ""].join(",")
      );
    }
    return new File([lines.join("\n")], "manual_entry.csv", { type: "text/csv" });
  };

  const onFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setActive(null);
    setSelectedIds(new Set());
    setFile(f);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setPreviewRows(parseCsvPreview(String(reader.result || "")));
    reader.readAsText(f);
  };

  const checkResult = async () => {
    if (!shipperForm.shipper_name.trim() || !shipperForm.sales_email) {
      setError("Shipper Name and Sales PIC are required");
      return;
    }
    if (uploadMode === "csv" && !file) {
      setError("Upload a lanes CSV first");
      return;
    }
    if (uploadMode === "manual" && manualRowsFilled.length === 0) {
      setError("Add at least one lane (origin, destination, vehicle type)");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const selectedAddOns = buildAddOns(addOnsState);

      const form = new FormData();
      form.append("file", uploadMode === "manual" ? manualRowsToCsvFile() : file);
      form.append("shipper_name", shipperForm.shipper_name);
      const picUser = salesUsers.find((u) => u.email === shipperForm.sales_email);
      form.append("sales_pic", picUser ? userLabel(picUser) : shipperForm.sales_email);
      form.append("sales_email", shipperForm.sales_email);
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
      setRequested(Object.fromEntries(data.rows.filter((r) => r.raised_to_vm).map((r) => [r.id, true])));
      setSelectedIds(new Set());
      loadSubmissions();
      loadLanes();
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const openSubmission = (id) => {
    setMainTab("new");
    fetch(`/api/submissions/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setActive(d);
        setRequested(Object.fromEntries(d.rows.filter((r) => r.raised_to_vm).map((r) => [r.id, true])));
        setSelectedIds(new Set());
        setFile(null);
        setPreviewRows([]);
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
    loadLanes();
  };

  const toggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectableRows = active ? active.rows.filter((r) => !requested[r.id]) : [];
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selectedIds.has(r.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableRows.map((r) => r.id)));
    }
  };

  const raiseSelected = async () => {
    if (selectedIds.size === 0) return;
    setBulkRequesting(true);
    try {
      const rows = active.rows.filter((r) => selectedIds.has(r.id));
      for (const row of rows) {
        await requestVm(row);
      }
      setSelectedIds(new Set());
      loadLanes();
    } finally {
      setBulkRequesting(false);
    }
  };

  const activeLanes = lanes.filter((l) => l.vm_status === "open" || l.vm_status === "in_progress");
  const completedLanes = lanes.filter(
    (l) => !(l.vm_status === "open" || l.vm_status === "in_progress") && (l.final_rate != null || (l.remarks || "").startsWith("No vendor available"))
  );

  useEffect(() => {
    if (!focusSubmissionId) return;
    if (activeLanes.some((l) => l.submission_id === focusSubmissionId)) setMainTab("active");
    else if (completedLanes.some((l) => l.submission_id === focusSubmissionId)) setMainTab("completed");
  }, [focusSubmissionId, lanes]);

  return (
    <div>
      <div className="flex gap-2 mb-6">
        {[
          { key: "new", label: "New Request" },
          { key: "active", label: `Active Request (${activeLanes.length})` },
          { key: "completed", label: `Completed Request (${completedLanes.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setMainTab(t.key)}
            className={`px-4 py-2 rounded text-sm font-medium ${
              mainTab === t.key ? "bg-brand-600 text-white" : "bg-white border border-gray-200 text-gray-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {(mainTab === "active" || mainTab === "completed") && (
        <div className="flex gap-5 items-start">
          <div className="flex-1 min-w-0">
            {mainTab === "active" ? (
              <GlobalLanesList
                lanes={activeLanes}
                emptyLabel="No active requests."
                kind="active"
                focusSubmissionId={focusSubmissionId}
                onFocusHandled={onFocusHandled}
                onOpenDiscussion={setDiscussionEndpoint}
              />
            ) : (
              <GlobalLanesList
                lanes={completedLanes}
                emptyLabel="No completed requests yet."
                kind="completed"
                focusSubmissionId={focusSubmissionId}
                onFocusHandled={onFocusHandled}
                onOpenDiscussion={setDiscussionEndpoint}
              />
            )}
          </div>

          {discussionEndpoint && (
            <aside className="w-[440px] shrink-0 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
              <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-sm">Discussion</h3>
                  <button onClick={() => setDiscussionEndpoint(null)} className="text-xs text-ink-500 hover:underline">
                    Close
                  </button>
                </div>
                <Discussion endpoint={discussionEndpoint} />
              </div>
            </aside>
          )}
        </div>
      )}

      {mainTab === "new" && (
        <div className="flex gap-6">
          <div className="w-64 shrink-0">
            <button
              onClick={startNew}
              className="w-full mb-3 px-3 py-1.5 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700"
            >
              + New submission
            </button>
            <h3 className="text-sm font-semibold text-ink-500 uppercase mb-2">Submission history</h3>
            <ul className="space-y-1">
              {submissions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => openSubmission(s.id)}
                    className="text-sm text-left w-full px-2 py-1.5 rounded hover:bg-ink-100"
                  >
                    <div className="truncate">{s.shipper_name || s.filename || `Submission #${s.id}`}</div>
                    <div className="text-xs text-ink-400">{s.created_at}</div>
                  </button>
                </li>
              ))}
              {submissions.length === 0 && <li className="text-sm text-ink-400">No submissions yet</li>}
            </ul>
          </div>

          <div className="flex-1 min-w-0 space-y-4">
            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4 space-y-6">
              <div>
                <h2 className="font-semibold mb-3">Shipper details</h2>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-ink-500">Shipper Name *</label>
                    <input
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.shipper_name}
                      onChange={(e) => setShipperForm((f) => ({ ...f, shipper_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-500">Sales PIC *</label>
                    <select
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.sales_email}
                      onChange={(e) => setShipperForm((f) => ({ ...f, sales_email: e.target.value }))}
                    >
                      <option value="">Select sales…</option>
                      {salesUsers.map((u) => (
                        <option key={u.email} value={u.email}>
                          {userLabel(u)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-ink-500">New or Existing Shipper</label>
                    <select
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.shipper_status}
                      onChange={(e) => setShipperForm((f) => ({ ...f, shipper_status: e.target.value }))}
                    >
                      <option value="new">New</option>
                      <option value="existing">Existing</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-ink-500">Potential Monthly Revenue (IDR)</label>
                    <input
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.potential_monthly_revenue}
                      onChange={(e) => setShipperForm((f) => ({ ...f, potential_monthly_revenue: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-500">Commodity / Item Type</label>
                    <input
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
                      value={shipperForm.commodity_type}
                      onChange={(e) => setShipperForm((f) => ({ ...f, commodity_type: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-500">High-value or Fragile?</label>
                    <select
                      className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
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
                <h2 className="font-semibold mb-3">Additional services</h2>
                <p className="text-xs text-ink-400 mb-3">
                  Recorded with the submission — included in the downloaded quotation and shown on the ticket.
                  Doesn't change the computed Final Rate.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={addOnsState.rdo.checked}
                        onChange={(e) =>
                          setAddOnsState((a) => ({ ...a, rdo: { ...a.rdo, checked: e.target.checked } }))
                        }
                      />
                      RDO (Rp7,000/RDO Jawa, Rp14,000/RDO Diluar Jawa)
                    </label>
                    {addOnsState.rdo.checked && (
                      <div className="flex gap-3 pl-6 mt-1">
                        <select
                          className="border border-ink-200 rounded px-2 py-1 text-sm"
                          value={addOnsState.rdo.region}
                          onChange={(e) =>
                            setAddOnsState((a) => ({ ...a, rdo: { ...a.rdo, region: e.target.value } }))
                          }
                        >
                          <option value="jawa">Jawa</option>
                          <option value="luar_jawa">Diluar Jawa</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          placeholder="Qty RDO"
                          className="w-32 border border-ink-200 rounded px-2 py-1 text-sm"
                          value={addOnsState.rdo.qty}
                          onChange={(e) => setAddOnsState((a) => ({ ...a, rdo: { ...a.rdo, qty: e.target.value } }))}
                        />
                        {addOnsState.rdo.qty && (
                          <span className="text-xs text-ink-400 self-center">
                            = {idr((Number(addOnsState.rdo.qty) || 0) * ADD_ON_RATES.rdo[addOnsState.rdo.region])}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={addOnsState.overnight.checked}
                        onChange={(e) =>
                          setAddOnsState((a) => ({ ...a, overnight: { checked: e.target.checked } }))
                        }
                      />
                      Overnight ({idr(ADD_ON_RATES.overnight)})
                    </label>
                  </div>

                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={addOnsState.additional_drop.checked}
                        onChange={(e) =>
                          setAddOnsState((a) => ({
                            ...a,
                            additional_drop: { ...a.additional_drop, checked: e.target.checked },
                          }))
                        }
                      />
                      Additional Drop Point (Rp500,000 per point, same city)
                    </label>
                    {addOnsState.additional_drop.checked && (
                      <div className="flex gap-3 pl-6 mt-1">
                        <input
                          type="number"
                          min="0"
                          placeholder="Qty drop point"
                          className="w-36 border border-ink-200 rounded px-2 py-1 text-sm"
                          value={addOnsState.additional_drop.qty}
                          onChange={(e) =>
                            setAddOnsState((a) => ({
                              ...a,
                              additional_drop: { ...a.additional_drop, qty: e.target.value },
                            }))
                          }
                        />
                        {addOnsState.additional_drop.qty && (
                          <span className="text-xs text-ink-400 self-center">
                            ={" "}
                            {idr(
                              (Number(addOnsState.additional_drop.qty) || 0) * ADD_ON_RATES.additional_drop
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={addOnsState.custom.checked}
                        onChange={(e) =>
                          setAddOnsState((a) => ({ ...a, custom: { ...a.custom, checked: e.target.checked } }))
                        }
                      />
                      Custom
                    </label>
                    {addOnsState.custom.checked && (
                      <div className="flex gap-3 pl-6 mt-1">
                        <input
                          placeholder="Label"
                          className="border border-ink-200 rounded px-2 py-1 text-sm"
                          value={addOnsState.custom.label}
                          onChange={(e) =>
                            setAddOnsState((a) => ({ ...a, custom: { ...a.custom, label: e.target.value } }))
                          }
                        />
                        <input
                          placeholder="Value / notes (optional)"
                          className="border border-ink-200 rounded px-2 py-1 text-sm"
                          value={addOnsState.custom.value}
                          onChange={(e) =>
                            setAddOnsState((a) => ({ ...a, custom: { ...a.custom, value: e.target.value } }))
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold">Lanes</h2>
                  <div className="flex gap-1">
                    {[
                      { key: "csv", label: "Upload CSV" },
                      { key: "manual", label: "Enter manually" },
                    ].map((m) => (
                      <button
                        key={m.key}
                        onClick={() => {
                          setUploadMode(m.key);
                          setActive(null);
                        }}
                        className={`px-3 py-1 rounded text-xs font-medium ${
                          uploadMode === m.key ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-500"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {uploadMode === "csv" ? (
                  <div>
                    <p className="text-sm text-ink-500 mb-3">
                      Columns: L2 Origin | L2 Destinasi | Vehicle Type | Target Rate, Minimum dedicated trip, Minimum trip (all optional; trips are per month).{" "}
                      <a
                        href={RATE_REQUEST_TEMPLATE_URL}
                        download="ftl_rate_request_template.csv"
                        className="text-brand-600 hover:underline"
                      >
                        Download template
                      </a>
                    </p>
                    <input type="file" accept=".csv" onChange={onFileChange} />
                    {file && !active && <p className="text-xs text-ink-400 mt-2">{previewRows.length} lane(s) parsed from {file.name}.</p>}
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-ink-500 mb-3">
                      Good for a quick 1-2 lane request — add rows below instead of preparing a CSV.
                    </p>
                    <div className="space-y-2">
                      {manualRows.map((row, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <input
                            placeholder="L2 Origin"
                            className="flex-1 border border-ink-200 rounded px-2 py-1.5 text-sm"
                            value={row.origin}
                            onChange={(e) => updateManualRow(i, "origin", e.target.value)}
                          />
                          <input
                            placeholder="L2 Destinasi"
                            className="flex-1 border border-ink-200 rounded px-2 py-1.5 text-sm"
                            value={row.destination}
                            onChange={(e) => updateManualRow(i, "destination", e.target.value)}
                          />
                          <input
                            placeholder="Vehicle Type"
                            className="w-32 border border-ink-200 rounded px-2 py-1.5 text-sm"
                            value={row.vehicle_type}
                            onChange={(e) => updateManualRow(i, "vehicle_type", e.target.value)}
                          />
                          <input
                            placeholder="Target Rate (optional)"
                            className="w-40 border border-ink-200 rounded px-2 py-1.5 text-sm"
                            value={row.target_rate}
                            onChange={(e) => updateManualRow(i, "target_rate", e.target.value)}
                          />
                          <input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="Min dedicated trip /mo"
                            className="w-44 border border-ink-200 rounded px-2 py-1.5 text-sm"
                            value={row.min_dedicated_trip}
                            onChange={(e) => updateManualRow(i, "min_dedicated_trip", e.target.value)}
                          />
                          <input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="Min trip /mo"
                            className="w-32 border border-ink-200 rounded px-2 py-1.5 text-sm"
                            value={row.min_trip}
                            onChange={(e) => updateManualRow(i, "min_trip", e.target.value)}
                          />
                          {manualRows.length > 1 && (
                            <button onClick={() => removeManualRow(i)} className="text-ink-400 hover:text-red-600 text-sm px-1">
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button onClick={addManualRow} className="mt-2 text-sm text-brand-600 hover:underline">
                      + Add lane
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={checkResult}
                disabled={checking || (uploadMode === "csv" ? !file : manualRowsFilled.length === 0)}
                className="px-4 py-2 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {checking ? "Checking…" : "Check Result"}
              </button>
            </div>

            {!active && uploadMode === "csv" && previewRows.length > 0 && (
              <div className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <Th>Origin</Th>
                      <Th>Destination</Th>
                      <Th>Vehicle Type</Th>
                      <Th>Target Rate</Th>
                      <Th>Min Ded. Trip</Th>
                      <Th>Min Trip</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i}>
                        <Td>{row.origin}</Td>
                        <Td>{row.destination}</Td>
                        <Td>{row.vehicle_type}</Td>
                        <Td>{row.target_rate || "-"}</Td>
                        <Td>{row.min_dedicated_trip || "-"}</Td>
                        <Td>{row.min_trip || "-"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-ink-400 px-3 py-2 border-t border-ink-100">
                  Preview only — click "Check Result" to compute Final Rates.
                </p>
              </div>
            )}

            {active && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {selectedIds.size > 0 && (
                      <button
                        onClick={raiseSelected}
                        disabled={bulkRequesting}
                        className="text-sm px-3 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        {bulkRequesting ? "Raising…" : `Raise ${selectedIds.size} selected to VM`}
                      </button>
                    )}
                  </div>
                  <a
                    href={`/api/submissions/${active.submission.id}/quotation.xlsx`}
                    className="text-sm px-3 py-1.5 rounded border border-ink-200 hover:bg-ink-50"
                  >
                    Download quotation (Excel)
                  </a>
                </div>

                <div className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <Th>
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleSelectAll}
                            disabled={selectableRows.length === 0}
                          />
                        </Th>
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
                          <Td>
                            {!requested[row.id] && (
                              <input
                                type="checkbox"
                                checked={selectedIds.has(row.id)}
                                onChange={() => toggleRow(row.id)}
                              />
                            )}
                          </Td>
                          <Td>{row.origin}</Td>
                          <Td>{row.destination}</Td>
                          <Td>{row.vehicle_type}</Td>
                          <Td>{fmt(row.target_rate)}</Td>
                          <Td className={row.final_rate == null ? "text-ink-400" : "font-medium"}>
                            {fmt(row.final_rate)}
                          </Td>
                          <Td className="text-ink-500">{row.remarks}</Td>
                          <Td>
                            {requested[row.id] ? (
                              <span className="text-xs text-green-600">Requested</span>
                            ) : (
                              <button
                                onClick={() => requestVm(row)}
                                className="text-xs px-2 py-1 rounded border border-ink-200 hover:bg-ink-50 whitespace-nowrap"
                              >
                                {row.final_rate == null ? "Ask VM for rates" : "Ask VM for a lower rate"}
                              </button>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!active && uploadMode === "csv" && previewRows.length === 0 && (
              <div className="text-sm text-ink-400">Fill in shipper details and upload a CSV to see a preview here.</div>
            )}
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

  const laneKey = (r) => [r.origin, r.destination, r.vehicle_type].map((x) => x.trim().toLowerCase()).join("|");
  const laneVendorCount = {};
  for (const r of rates) laneVendorCount[laneKey(r)] = (laneVendorCount[laneKey(r)] || 0) + 1;

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
    <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4 mb-6">
      <h2 className="font-semibold mb-2">Master vendor rates</h2>
      <p className="text-sm text-ink-500 mb-3">
        Columns: Origin L2 | Destinasi L2 | Vehicle Type | Cost/Rate | Vendor Name.{" "}
        <a href={MASTER_RATE_TEMPLATE_URL} download="master_vendor_rate_template.csv" className="text-brand-600 hover:underline">
          Download template
        </a>
        . Uploads add/update rows — existing lanes not in the file are kept.
      </p>
      <input type="file" accept=".csv" onChange={onUpload} disabled={uploading} />
      {uploading && <p className="text-sm text-ink-500 mt-2">Processing…</p>}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      {ok && <p className="text-sm text-green-600 mt-2">{ok}</p>}
      {meta?.created_at ? (
        <p className="text-xs text-ink-400 mt-3">
          Last upload {meta.created_at} by {meta.uploaded_by} — {meta.row_count} row(s)
          {meta.filename ? ` (${meta.filename})` : ""}.
        </p>
      ) : (
        <p className="text-xs text-ink-400 mt-3">No master rates loaded yet.</p>
      )}

      <div className="mt-4 pt-4 border-t border-ink-100">
        <div className="flex items-center justify-between">
          <button onClick={() => setShowExisting((v) => !v)} className="text-sm text-brand-600 hover:underline">
            {showExisting ? "Hide" : "View"} existing vendor rates
          </button>
          {showExisting && (
            <a href="/api/master-rates/export" className="text-sm px-3 py-1.5 rounded border border-ink-200 hover:bg-ink-50">
              Download CSV
            </a>
          )}
        </div>
        {showExisting && (
          <div className="mt-3 max-h-96 overflow-y-auto border border-ink-100 rounded">
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
                    <Td>
                      {r.vehicle_type}
                      {laneVendorCount[laneKey(r)] === 1 && <OnlyOneVendorBadge />}
                    </Td>
                    <Td>{r.vendor_name}</Td>
                    <Td>{fmt(r.cost)}</Td>
                    <Td className="text-ink-400 text-xs">{r.updated_by}</Td>
                  </tr>
                ))}
                {rates.length === 0 && (
                  <tr>
                    <Td className="text-ink-400" colSpan={6}>No vendor rates yet</Td>
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

function LaneFilterTable({ lanes, onClose, showAvgTarget, hideCollapse }) {
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

function PrioritizationSection({ title, lanes, showAvgTarget, onViewMore, lanesKey }) {
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

function PrioritizationFullPage({ lanesKey, title, showAvgTarget, onBack }) {
  const [lanes, setLanes] = useState(null);

  useEffect(() => {
    fetch("/api/vm/summary?limit=500")
      .then((r) => r.json())
      .then((d) => setLanes(d[lanesKey]));
  }, [lanesKey]);

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

function ResolveRequestPanel({ request, onDone, onCancel }) {
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

      <p className="mt-3 text-xs text-ink-400">
        Click "💬 Discussion" on this shipper's row to switch this panel to their discussion thread.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VM: requests grouped by shipper
// ---------------------------------------------------------------------------

const UNKNOWN_SHIPPER = "Ad-hoc / unknown shipper";

function OnlyOneVendorBadge() {
  return (
    <span className="ml-2 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
      Only 1 Vendor
    </span>
  );
}

// Expanded view of a ticket: trip commitments, who won and why, and the full ranked vendor list.
function TicketDetail({ r }) {
  const winnerShown = r.resolved_vendor != null && r.resolved_cost != null;
  const margin =
    winnerShown && r.current_final_rate != null && r.resolved_cost > 0
      ? ((r.current_final_rate / r.resolved_cost - 1) * 100).toFixed(1)
      : null;
  return (
    <div className="grid grid-cols-3 gap-6 text-sm">
      <div>
        <p className="text-xs text-ink-500 uppercase font-semibold mb-1">Trip commitment (per month)</p>
        <p>Minimum dedicated trip: <span className="font-medium">{r.min_dedicated_trip ?? "-"}</span></p>
        <p>Minimum trip: <span className="font-medium">{r.min_trip ?? "-"}</span></p>
        {r.auto_closed_sla && (
          <p className="mt-2 text-xs text-amber-700">Auto-closed by SLA after 7 days with no VM action.</p>
        )}
      </div>
      <div>
        <p className="text-xs text-ink-500 uppercase font-semibold mb-1">Winning vendor</p>
        {winnerShown ? (
          <>
            <p>
              <span className="font-medium">{r.resolved_vendor}</span> at {fmt(r.resolved_cost)}
            </p>
            {r.winner_basis && <p className="text-ink-500">{r.winner_basis}</p>}
            <p className="text-ink-500">
              Final rate {fmt(r.current_final_rate)}
              {margin != null && ` (+${margin}% over cost)`}
            </p>
            {r.single_vendor_approved && (
              <p className="mt-1 text-xs text-amber-700">
                Single vendor approved by {r.override_by}: {r.override_reason}
              </p>
            )}
          </>
        ) : (
          <p className="text-ink-400">No vendor applied yet.</p>
        )}
      </div>
      <div>
        <p className="text-xs text-ink-500 uppercase font-semibold mb-1">
          Vendors on this lane ({r.vendor_count ?? r.ranked_vendors.length})
        </p>
        {r.ranked_vendors.length > 0 ? (
          <ol className="list-decimal pl-5">
            {r.ranked_vendors.map((v) => (
              <li key={v.vendor} className={v.vendor === r.resolved_vendor ? "font-medium" : ""}>
                {v.vendor} — {fmt(v.cost)}
                {v.vendor === r.resolved_vendor && <span className="ml-1 text-xs text-brand-600">winner</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-ink-400">None on record.</p>
        )}
      </div>
    </div>
  );
}

function RequestsByShipper({ requests, selectedId, setSelectedId, updateStatus, onRefresh, views, onViewed, focusSubmissionId, onFocusHandled, onOpenDiscussion }) {
  const [collapsed, setCollapsed] = useState({});
  const [resolving, setResolving] = useState(null);
  const [detailId, setDetailId] = useState(null);

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

  useEffect(() => {
    if (!focusSubmissionId) return;
    const name = Object.keys(groups).find((k) => groups[k].some((r) => r.submission_id === focusSubmissionId));
    if (!name) return;
    setCollapsed((c) => ({ ...c, [name]: false }));
    onViewed(focusSubmissionId);
    onOpenDiscussion(`/api/submissions/${focusSubmissionId}/comments`);
    setTimeout(() => {
      document.getElementById(`shipper-group-${focusSubmissionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    onFocusHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSubmissionId, requests]);

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
        const withSubmission = rows.filter((r) => r.submission_id);
        const primary = withSubmission.length
          ? withSubmission.reduce((a, b) => (new Date(b.submission_created_at) > new Date(a.submission_created_at) ? b : a))
          : null;
        const lastViewed = primary ? views[primary.submission_id] : null;
        const isNew = primary && (!lastViewed || new Date(primary.submission_created_at) > new Date(lastViewed));
        const toggleAndMark = (n) => {
          const wasCollapsed = collapsed[n] ?? true;
          toggle(n);
          if (wasCollapsed) {
            if (primary) {
              onViewed(primary.submission_id);
              onOpenDiscussion(`/api/submissions/${primary.submission_id}/comments`);
            } else if (rows[0]) {
              onOpenDiscussion(`/api/vm-requests/${rows[0].id}/comments`);
            }
          }
        };
        return (
          <div
            key={name}
            id={primary ? `shipper-group-${primary.submission_id}` : undefined}
            className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-50">
              <button onClick={() => toggleAndMark(name)} className="w-24 shrink-0 text-left text-xs text-ink-400">
                {primary ? primary.submission_created_at?.slice(0, 10) : "-"}
              </button>
              <button onClick={() => toggleAndMark(name)} className="flex-1 text-left">
                <span className="font-semibold text-sm">{name}</span>
                <span className="ml-2 text-xs text-ink-400">{salesPic}</span>
                <span className="ml-2 text-xs text-ink-400">
                  ({rows.length} lane{rows.length !== 1 ? "s" : ""}, {openCount} open)
                </span>
                {openCount === 0 && <span className="ml-2 text-xs text-green-600 font-medium">✓ Complete</span>}
                {primary?.add_ons?.length > 0 && (
                  <span className="ml-2 text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded-full">
                    + {primary.add_ons.map((a) => a.label).join(", ")}
                  </span>
                )}
                {isNew && (
                  <span className="ml-2 text-xs bg-brand-600 text-white px-1.5 py-0.5 rounded-full font-medium">
                    New
                  </span>
                )}
              </button>
              <button
                onClick={() =>
                  onOpenDiscussion(
                    primary
                      ? `/api/submissions/${primary.submission_id}/comments`
                      : `/api/vm-requests/${rows[0].id}/comments`
                  )
                }
                className="text-xs px-2 py-1 rounded border border-ink-200 hover:bg-white"
              >
                💬 Discussion
              </button>
              {openCount > 0 && (
                <button
                  onClick={() => resolveReady(name)}
                  disabled={resolving === name}
                  className="text-xs px-2 py-1 rounded border border-ink-200 hover:bg-white"
                >
                  {resolving === name ? "Resolving…" : "Resolve all with existing rate"}
                </button>
              )}
              <button onClick={() => toggleAndMark(name)} className="text-xs text-ink-400">
                {isCollapsed ? "Expand" : "Collapse"}
              </button>
            </div>
            {!isCollapsed && (
              <div className="overflow-x-auto border-t border-ink-100">
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
                      <Fragment key={r.id}>
                      <tr className={selectedId === r.id ? "bg-ink-50" : ""}>
                        <Td>{r.origin}</Td>
                        <Td>{r.destination}</Td>
                        <Td>
                          {r.vehicle_type}
                          {r.only_one_vendor && (r.status === "open" || r.status === "in_progress") && <OnlyOneVendorBadge />}
                        </Td>
                        <Td className="text-ink-500">{r.requested_by}</Td>
                        <Td>{r.target_cost != null ? fmt(r.target_cost) : "-"}</Td>
                        <Td>{r.current_final_rate != null ? fmt(r.current_final_rate) : "No rate yet"}</Td>
                        <Td>{r.aging_days}</Td>
                        <Td>
                          <select
                            value={r.status}
                            onChange={(e) => updateStatus(r.id, e.target.value)}
                            className="text-xs border border-ink-200 rounded px-1 py-0.5"
                          >
                            {Object.entries(STATUS_LABEL).map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                          {r.auto_closed_sla && (
                            <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                              Auto-closed (SLA)
                            </span>
                          )}
                        </Td>
                        <Td>
                          <div className="flex gap-2">
                            {(r.status === "open" || r.status === "in_progress") && (
                              <button
                                onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                                className="text-xs px-2 py-1 rounded border border-ink-200 hover:bg-ink-50 whitespace-nowrap"
                              >
                                {selectedId === r.id ? "Cancel" : "Fill rate"}
                              </button>
                            )}
                            <button
                              onClick={() => setDetailId(detailId === r.id ? null : r.id)}
                              className="text-xs px-2 py-1 rounded border border-ink-200 hover:bg-ink-50 whitespace-nowrap"
                            >
                              {detailId === r.id ? "Hide details" : "Details"}
                            </button>
                          </div>
                        </Td>
                      </tr>
                      {detailId === r.id && (
                        <tr>
                          <td colSpan={9} className="px-4 py-3 bg-ink-50 border-t border-ink-100">
                            <TicketDetail r={r} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      {shipperNames.length === 0 && <p className="text-sm text-ink-400">No requests yet</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VM: view
// ---------------------------------------------------------------------------

function VmView({ focusSubmissionId, onFocusHandled }) {
  const [tab, setTab] = useState("summary");
  const [summary, setSummary] = useState(null);
  const [requests, setRequests] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [views, setViews] = useState({});
  const [prioritizationView, setPrioritizationView] = useState(null); // null | { key, title }
  const [discussionEndpoint, setDiscussionEndpoint] = useState(null);
  const [shipperFilter, setShipperFilter] = useState("");
  const [salesFilter, setSalesFilter] = useState("");

  const selectRow = (id) => {
    setSelectedId(id);
    setDiscussionEndpoint(null);
  };
  const openDiscussion = (endpoint) => {
    setDiscussionEndpoint(endpoint);
    setSelectedId(null);
  };

  const loadSummary = () => fetch("/api/vm/summary").then((r) => r.json()).then(setSummary);
  const loadRequests = () => fetch("/api/vm/requests").then((r) => r.json()).then((d) => setRequests(d.requests));
  const loadViews = () =>
    fetch("/api/ticket-views")
      .then((r) => r.json())
      .then((d) => setViews(Object.fromEntries(d.views.map((v) => [v.submission_id, v.last_viewed_at]))));

  useEffect(() => {
    loadSummary();
    loadRequests();
    loadViews();
  }, []);

  useEffect(() => {
    if (!focusSubmissionId) return;
    const isCompleted = requests.some(
      (r) => r.submission_id === focusSubmissionId && r.status !== "open" && r.status !== "in_progress"
    );
    setTab(isCompleted ? "completed" : "active");
  }, [focusSubmissionId]);

  const onViewed = (submissionId) => {
    setViews((v) => ({ ...v, [submissionId]: new Date().toISOString() }));
    fetch(`/api/submissions/${submissionId}/view`, { method: "POST" });
  };

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
        {[
          { key: "summary", label: "Prioritization" },
          { key: "active", label: "Active Request" },
          { key: "completed", label: "Completed Request" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              tab === t.key ? "bg-brand-600 text-white" : "bg-white border border-gray-200 text-gray-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "summary" && summary && (
        prioritizationView ? (
          <PrioritizationFullPage
            lanesKey={prioritizationView.key}
            title={prioritizationView.title}
            showAvgTarget={prioritizationView.key === "seeking_lower_rate"}
            onBack={() => setPrioritizationView(null)}
          />
        ) : (
          <div>
            <p className="text-sm text-ink-500 mb-4">
              Helps decide what to work on first — two different priorities: open lanes sales are still waiting
              on (left), and lanes that keep coming back as unservable so they may deserve another push for a
              vendor (right).
            </p>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <PrioritizationSection
                  title="Seeking a lower rate"
                  lanes={summary.seeking_lower_rate}
                  showAvgTarget
                  lanesKey="seeking_lower_rate"
                  onViewMore={(key, title) => setPrioritizationView({ key, title })}
                />
                <p className="text-xs text-ink-400 mt-2">
                  Lanes that already have a Final Rate where sales asked for a lower one — still-open requests,
                  plus ones VM already closed as "no lower rate found" (the existing rate stands, but it's worth
                  tracking which lanes keep getting asked for a better price). "Avg Target Rate" averages the
                  target across every sales request on that lane.
                </p>
              </div>
              <div>
                <PrioritizationSection
                  title="Confirmed no vendor available"
                  lanes={summary.missing_lanes}
                  lanesKey="missing_lanes"
                  onViewMore={(key, title) => setPrioritizationView({ key, title })}
                />
                <p className="text-xs text-ink-400 mt-2">
                  Lanes VM has already closed as "no vendor available" — accumulated by how many times that's
                  happened. A lane showing up here repeatedly is worth another vendor push or a rate re-check.
                </p>
              </div>
            </div>
          </div>
        )
      )}

      {(tab === "active" || tab === "completed") && (
        <div className="flex gap-5 items-start">
          <div className="flex-1 min-w-0">
            <FilterBar
              items={requests}
              shipper={shipperFilter}
              setShipper={setShipperFilter}
              sales={salesFilter}
              setSales={setSalesFilter}
            />
            <RequestsByShipper
              requests={requests.filter(
                (r) =>
                  matchesFilters(r, shipperFilter, salesFilter) &&
                  (tab === "active"
                    ? r.status === "open" || r.status === "in_progress"
                    : r.status !== "open" && r.status !== "in_progress")
              )}
              selectedId={selectedId}
              setSelectedId={selectRow}
              updateStatus={updateStatus}
              onRefresh={() => {
                loadRequests();
                loadSummary();
              }}
              views={views}
              onViewed={onViewed}
              focusSubmissionId={focusSubmissionId}
              onFocusHandled={onFocusHandled}
              onOpenDiscussion={openDiscussion}
            />
          </div>

          {(selected || discussionEndpoint) && (
            <aside className="w-[440px] shrink-0 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
              {selected ? (
                <ResolveRequestPanel request={selected} onDone={onResolveDone} onCancel={() => selectRow(null)} />
              ) : (
                <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-sm">Discussion</h3>
                    <button onClick={() => setDiscussionEndpoint(null)} className="text-xs text-ink-500 hover:underline">
                      Close
                    </button>
                  </div>
                  <Discussion endpoint={discussionEndpoint} />
                </div>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profitability: pick shippers to go live, then a per-shipper tracker "spreadsheet"
// ---------------------------------------------------------------------------

const PPN_FACTOR = 1.1;
const ORDER_STATUS_OPTIONS = [
  { value: "", label: "-" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const toNum = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};
const marginPct = (rate, cost) => {
  const r = toNum(rate);
  const c = toNum(cost);
  return r && c !== null ? ((r - c) / r) * 100 : null;
};
const fmtPct = (v) => (v === null ? "-" : `${v.toFixed(1)}%`);
const laneKeyFe = (o, d, v) =>
  [o, d, v].map((x) => String(x || "").trim().toLowerCase().replace(/\s+/g, " ")).join("|");
const str = (v) => (v === null || v === undefined ? "" : String(v));

// Parse a pasted cell for a column type (Excel/Sheets paste → grid).
function parsePasted(raw, type) {
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
function EditableGrid({ columns, rows, setRows, blankRow, onCellEdited, rowError }) {
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
                  {err && <span className="text-xs text-red-600 mr-2">{err}</span>}
                  <button
                    onClick={() => setRows((rs) => rs.filter((_, i) => i !== ri))}
                    className="text-ink-400 hover:text-red-600 text-sm px-1"
                    title="Delete row"
                  >
                    ✕
                  </button>
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
      <div className="px-3 py-2 border-t border-ink-100 flex items-center gap-4">
        <button onClick={() => setRows((rs) => [...rs, blankRow()])} className="text-sm text-brand-600 hover:underline">
          + Add row
        </button>
        <span className="text-xs text-ink-400">Tip: copy a block from Excel / Google Sheets and paste it into any cell.</span>
      </div>
    </div>
  );
}

const blankQuotationRow = () => ({ origin: "", destination: "", vehicle_type: "", vendor: "", cost: "", rate: "" });
const blankOrderRow = () => ({
  order_no: "", order_date: "", origin: "", destination: "", vehicle_type: "", status: "",
  planned_vendor: "", est_cost: "", rate: "", actual_vendor: "", actual_invoice_cost: "",
  revenue_uang_jalan: "", revenue_overnight: "",
});

const NUMERIC_QUOTATION = ["cost", "rate"];
const NUMERIC_ORDER = ["est_cost", "rate", "actual_invoice_cost", "revenue_uang_jalan", "revenue_overnight"];

function TrackerSheetView({ shipperName, canUndo, onBack, onUndone }) {
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

  const quotationColumns = [
    { key: "origin", label: "Origin", type: "text", list: "dl-q-origin" },
    { key: "destination", label: "Destination", type: "text", list: "dl-q-destination" },
    { key: "vehicle_type", label: "Vehicle", type: "text", list: "dl-q-vehicle" },
    { key: "vendor", label: "Vendor", type: "text" },
    { key: "cost", label: "Cost", type: "number" },
    { key: "rate", label: "Rate", type: "number" },
    { key: "margin", label: "Margin %", computed: (r) => fmtPct(marginPct(r.rate, r.cost)) },
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
      label: "Total Revenue (incl. PPN)",
      computed: (r) =>
        toNum(r.rate) === null
          ? "-"
          : fmt(Math.round((toNum(r.rate) + (toNum(r.revenue_uang_jalan) || 0) + (toNum(r.revenue_overnight) || 0)) * PPN_FACTOR)),
    },
    { key: "est_margin", label: "Est. Margin %", computed: (r) => fmtPct(marginPct(r.rate, r.est_cost)) },
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
        {canUndo && (
          <button onClick={undo} className="text-xs px-2 py-1 rounded border border-ink-200 hover:bg-ink-50">
            Move back to Pilih Go Live
          </button>
        )}
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="px-4 py-1.5 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
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
          <EditableGrid columns={quotationColumns} rows={quotation} setRows={updateQuotation} blankRow={blankQuotationRow} />
        </div>
      ) : (
        <div>
          <p className="text-xs text-ink-500 mb-2">
            Type origin, destination and vehicle: when the lane is in Quotation Cost, vendor, estimated cost and rate fill in
            automatically. Margin % = (rate − cost) ÷ rate. Total revenue = (rate + uang jalan + overnight) × 1.1 (PPN).
          </p>
          <EditableGrid
            columns={orderColumns}
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

function ProfitabilityView({ me }) {
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
  const canUndo = me.role === "vm" || me.role === "superadmin";

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
// Superadmin
// ---------------------------------------------------------------------------

function AdminPanel() {
  const [users, setUsers] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
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
        body: JSON.stringify({ email: newEmail.trim(), role: newRole, display_name: newName.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to add user");
      }
      setNewEmail("");
      setNewName("");
      setNewRole("sales");
      resetDirectoryUsers();
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
    resetDirectoryUsers();
    loadUsers();
  };

  const renameUser = async (u, name) => {
    if (name.trim() === (u.display_name || "") || !name.trim()) return;
    await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: u.email, role: u.role, display_name: name.trim() }),
    });
    resetDirectoryUsers();
    loadUsers();
  };

  const removeUser = async (email) => {
    await fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: "DELETE" });
    resetDirectoryUsers();
    loadUsers();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-ink-100 shadow-sm p-4">
        <h2 className="font-semibold mb-3">Add user</h2>
        <form onSubmit={addUser} className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-ink-500">Email</label>
            <input
              type="email"
              required
              className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@ninjavan.co"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-ink-500">Display name</label>
            <input
              required
              className="mt-1 w-full border border-ink-200 rounded px-2 py-1.5 text-sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Adila Kestibawani"
            />
          </div>
          <div>
            <label className="text-xs text-ink-500">Role</label>
            <select
              className="mt-1 border border-ink-200 rounded px-2 py-1.5 text-sm"
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
            className="px-4 py-1.5 rounded text-sm font-medium bg-brand-600 text-white hover:bg-brand-700"
          >
            Add
          </button>
        </form>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      <div className="bg-white rounded-xl border border-ink-100 shadow-sm overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email}>
                <Td>
                  <input
                    key={u.display_name || ""}
                    defaultValue={u.display_name || ""}
                    placeholder="Add a name"
                    onBlur={(e) => renameUser(u, e.target.value)}
                    className="text-sm border border-transparent hover:border-ink-200 rounded px-1 py-0.5 w-48"
                  />
                </Td>
                <Td>{u.email}</Td>
                <Td>
                  <select
                    value={u.role}
                    onChange={(e) => changeRole(u.email, e.target.value)}
                    className="text-xs border border-ink-200 rounded px-1 py-0.5"
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
                <Td className="text-ink-400" colSpan={4}>No users yet</Td>
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

function BrandedMessage({ title, children }) {
  return (
    <div className="min-h-screen hero-gradient flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <img src="/assets/ryo-standing.png" alt="Ryo" className="h-28 mx-auto mb-3" />
        <p className="font-bold text-lg text-ink-900 mb-1">{title}</p>
        <div className="text-sm text-ink-500">{children}</div>
      </div>
    </div>
  );
}

const VIEW_LABEL = { sales: "Sales", vm: "Vendor Mgmt", admin: "Admin", profitability: "Profitability" };

function NotificationBell({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);

  const load = () =>
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => {
        setItems(d.notifications);
        setUnread(d.unread_count);
      })
      .catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const openItem = async (n) => {
    if (!n.read_at) {
      await fetch(`/api/notifications/${n.id}/read`, { method: "POST" });
      load();
    }
    setOpen(false);
    onNavigate(n.submission_id);
  };

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST" });
    load();
  };

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {open && (
        <div className="mb-2 w-80 max-h-96 overflow-y-auto bg-white rounded-xl border border-ink-100 shadow-2xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-ink-100 sticky top-0 bg-white">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-brand-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 && <p className="text-xs text-ink-400 p-3">No notifications yet.</p>}
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => openItem(n)}
              className={`w-full text-left px-3 py-2 border-b border-ink-50 hover:bg-ink-50 ${
                n.read_at ? "" : "bg-brand-50"
              }`}
            >
              <div className="text-xs font-medium">{n.shipper_name || `Submission #${n.submission_id}`}</div>
              <div className="text-xs text-ink-500 line-clamp-2">{n.message}</div>
              <div className="text-[10px] text-ink-400 mt-0.5">{n.created_at}</div>
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative h-12 w-12 rounded-full bg-brand-600 text-white shadow-lg flex items-center justify-center hover:bg-brand-700"
        title="Notifications"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-white text-brand-700 text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center border-2 border-brand-600">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}

function AppInner() {
  const { me, loading } = useMe();
  const [view, setView] = useState("sales");
  const [focusSubmissionId, setFocusSubmissionId] = useState(null);

  if (loading) return <BrandedMessage title="Loading…">Warming up the trucks.</BrandedMessage>;

  if (!me?.email) {
    return <BrandedMessage title="Sign in required">Please sign in with your company Google account.</BrandedMessage>;
  }

  if (!me.role) {
    return (
      <BrandedMessage title="Not provisioned">
        {me.email} isn't set up as sales or vendor management yet. Ask an admin to add you.
      </BrandedMessage>
    );
  }

  const isSuperadmin = me.role === "superadmin";
  const activeView = view === "profitability" ? "profitability" : isSuperadmin ? view : me.role;

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="bg-ink-900 text-white text-center text-[11px] font-bold uppercase tracking-[0.2em] py-1.5">
        <span className="text-brand-400">●</span> FTL On-Call Only
      </div>

      <header className="hero-gradient relative overflow-hidden text-white">
        <div className="max-w-6xl mx-auto px-6 pt-5 pb-9 flex items-end justify-between gap-6 relative z-10">
          <div className="flex items-center gap-4">
            <img src="/assets/ryo-standing.png" alt="Ryo" className="h-24 shrink-0 drop-shadow-[0_6px_10px_rgba(0,0,0,0.35)]" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">Ninja Xpress</p>
              <h1 className="text-2xl font-extrabold leading-tight">FTL Pricing Dashboard</h1>
              <p className="text-sm text-white/80">Full-truckload rate requests, from quote to vendor.</p>
            </div>
          </div>
          <div className="hidden md:flex items-end gap-2 shrink-0">
            <img src="/assets/ryo-jump.png" alt="" className="h-20 -mb-1 drop-shadow-[0_6px_10px_rgba(0,0,0,0.35)]" />
            <img src="/assets/truck-side.png" alt="" className="h-24 drop-shadow-[0_6px_10px_rgba(0,0,0,0.35)]" />
          </div>
        </div>

        <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10" />
        <div className="absolute right-40 -bottom-16 h-40 w-40 rounded-full bg-black/10" />

        <div className="bg-black/25 backdrop-blur-sm relative z-10">
          <div className="max-w-6xl mx-auto px-6 py-2 flex items-center justify-between">
            <div className="flex gap-1">
              {(isSuperadmin ? ["sales", "vm", "admin", "profitability"] : [me.role, "profitability"]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide transition ${
                    activeView === v ? "bg-white text-brand-700 shadow" : "text-white/85 hover:bg-white/15"
                  }`}
                >
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </div>
            <div className="text-xs text-white/85">
              {me.email}
              <span className="ml-2 px-2 py-0.5 rounded-full bg-white/20 text-[10px] font-bold uppercase">{me.role}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-[1400px] mx-auto">
        {activeView === "sales" && (
          <SalesView focusSubmissionId={focusSubmissionId} onFocusHandled={() => setFocusSubmissionId(null)} />
        )}
        {activeView === "vm" && (
          <VmView focusSubmissionId={focusSubmissionId} onFocusHandled={() => setFocusSubmissionId(null)} />
        )}
        {activeView === "admin" && <AdminPanel />}
        {activeView === "profitability" && <ProfitabilityView me={me} />}
      </main>

      <footer className="max-w-[1400px] mx-auto px-6 pb-8 flex items-center justify-between text-[11px] text-ink-400">
        <span>PRIVATE AND CONFIDENTIAL</span>
        <img src="/assets/truck-side.png" alt="" className="h-9 opacity-80" />
      </footer>

      <NotificationBell onNavigate={(submissionId) => setFocusSubmissionId(submissionId)} />
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
