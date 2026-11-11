import { Component, useEffect, useState } from "react";

export class ErrorBoundary extends Component {
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

export const RATE_REQUEST_TEMPLATE_CSV =
  "L2 Origin,L2 Destinasi,Vehicle Type,Target Rate,Minimum trip\n" +
  "Kab. Bekasi,Kota Surabaya,CDE,7000000,20\n" +
  "Kab. Bekasi,Kota Bandung,Wingbox,,\n";
export const RATE_REQUEST_TEMPLATE_URL = "data:text/csv;charset=utf-8," + encodeURIComponent(RATE_REQUEST_TEMPLATE_CSV);

export const MASTER_RATE_TEMPLATE_CSV =
  "Origin L2,Destinasi L2,Vehicle Type,Cost/Rate,Vendor Name,Valid Until\n" +
  "Kab. Bekasi,Kota Surabaya,CDE,6500000,Duta Trans,31-12-2026\n" +
  "Kab. Bekasi,Kota Surabaya,CDE,6800000,Seryu,\n";
export const MASTER_RATE_TEMPLATE_URL = "data:text/csv;charset=utf-8," + encodeURIComponent(MASTER_RATE_TEMPLATE_CSV);

export const STATUS_LABEL = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed_no_vendor: "No Vendor Available",
  closed_no_lower_rate: "No Lower Rate Found",
};

export function fmt(n) {
  if (n === null || n === undefined) return "-";
  return new Intl.NumberFormat("id-ID").format(n);
}

export function useMe() {
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

export function Th({ children }) {
  return <th className="text-left px-3 py-2.5 text-xs font-medium text-ink-500 whitespace-nowrap bg-ink-50/60">{children}</th>;
}
export function Td({ children, className = "" }) {
  return <td className={`px-3 py-2.5 text-sm border-t border-ink-100 ${className}`}>{children}</td>;
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export const DEFAULT_SHIPPER_FORM = {
  shipper_name: "",
  sales_email: "",
  shipper_status: "new",
  potential_monthly_revenue: "",
  commodity_type: "",
  high_value_fragile: false,
  od_region: "",
  salescrm_id: "",
};

// OD Region sales pick when raising a ticket: Java regions, or the island outside Java.
export const OD_REGIONS = [
  { value: "GJ", label: "GJ (Greater Jakarta)" },
  { value: "WJ", label: "WJ (West Java)" },
  { value: "CJ", label: "CJ (Central Java)" },
  { value: "EJ", label: "EJ (East Java)" },
  { value: "Sumatra", label: "Sumatra" },
  { value: "Kalimantan", label: "Kalimantan" },
  { value: "Sulawesi", label: "Sulawesi" },
  { value: "Bali-Nusa", label: "Bali-Nusa" },
  { value: "Papua-Maluku", label: "Papua-Maluku" },
];

// Additional services sales can ask VM to price (sent as one request on Submit).
export const SERVICES = [
  { key: "overnight", label: "Overnight", unit: "per malam" },
  { key: "tkbm", label: "TKBM", unit: "per orang" },
  { key: "additional_drop", label: "Additional Drop Point", unit: "per titik" },
];

export const DEFAULT_ADD_ONS_STATE = Object.fromEntries(SERVICES.map((sv) => [sv.key, { checked: false, note: "" }]));

export function idr(n) {
  return "Rp" + new Intl.NumberFormat("id-ID").format(n);
}

export function buildAddOns(a) {
  return SERVICES.filter((sv) => a[sv.key].checked).map((sv) => ({
    label: sv.label,
    value: a[sv.key].note.trim() || null,
    service: sv.key,
  }));
}

export let directoryUsersPromise = null;
export function fetchDirectoryUsers() {
  if (!directoryUsersPromise) {
    directoryUsersPromise = fetch("/api/users")
      .then((r) => r.json())
      .then((d) => d.users)
      .catch(() => []);
  }
  return directoryUsersPromise;
}

export function resetDirectoryUsers() {
  directoryUsersPromise = null;
}

export function useDirectoryUsers() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    fetchDirectoryUsers().then(setUsers);
  }, []);
  return users;
}

export const userLabel = (u) => u.display_name || u.email;

// Sales identity of a lane/ticket: the linked sales user, or (legacy submissions,
// from before Sales PIC became a dropdown) the name that was typed in.
export const salesKeyOf = (x) => (x.sales_email ? `e:${x.sales_email}` : x.sales_pic ? `l:${x.sales_pic}` : "");

export function FilterBar({ items, shipper, setShipper, sales, setSales, hideShipper, children }) {
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

export const matchesFilters = (x, shipper, sales) =>
  (!shipper || x.shipper_name === shipper) && (!sales || salesKeyOf(x) === sales);

export const MENTION_RE = /@(\w[\w.]*)/g;

export function renderWithMentions(message) {
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

export function Discussion({ endpoint, id }) {
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

// Pricing tiers — mirrors backend/pricing.py. Margin ON PRICE, rounded up to Rp 100
// (Excel ROUNDUP(x, -2)), before PPN and before overnight / TKBM / extra drops.
export const MARGIN_TIERS = [
  { pct: 5, approval: "Approval Alex", category: null },
  { pct: 10, approval: "Approval Head", category: 2 },
  { pct: 15, approval: "Approval Manager", category: 1 },
];
export const roundup100 = (x) => Math.ceil(Math.round(x * 1e6) / 1e6 / 100) * 100;
export const tierPrice = (cost, pct) => roundup100(cost / (1 - pct / 100));
export const marginOnPrice = (price, cost) => (price ? Math.round(((price - cost) / price) * 10000) / 100 : null);
export const categoryFor = (m) => (m == null ? null : m >= 15 ? 1 : m >= 10 ? 2 : 3);
