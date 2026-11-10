// Local preview ONLY: a fake /api with sample data, so the UI can be worked on without
// the Python backend or a database. Enabled by `npm run dev:mock` (MOCK=1); never part of
// the production build. Mirrors the backend's permission rules (backend/permissions.py),
// including stripping vendor data for sales, so what you see per role is realistic.
//
// Switch role: the "Preview as" control in the top bar (mock mode only), or
// GET /api/__mock/role?as=sales|vm|superadmin

const USERS = [
  { email: "adila@ninjavan.co", role: "superadmin", display_name: "Adila Kestibawani" },
  { email: "michael@ninjavan.co", role: "superadmin", display_name: "Michael Quinn" },
  { email: "dewi@ninjavan.co", role: "sales", display_name: "Dewi Anggraini" },
  { email: "fajar@ninjavan.co", role: "sales", display_name: "Fajar Ramadhan" },
  { email: "siti@ninjavan.co", role: "sales", display_name: "Siti Nurhaliza" },
  { email: "baskoro@ninjavan.co", role: "vm", display_name: "Baskoro Nugroho" },
  { email: "rizky@ninjavan.co", role: "procurement", display_name: "Rizky Procurement" },
];
const AS = { sales: "dewi@ninjavan.co", vm: "baskoro@ninjavan.co", procurement: "rizky@ninjavan.co", superadmin: "michael@ninjavan.co" };
const VIEW_AS_ROLES = ["sales", "vm", "procurement"];

function perms(role) {
  const sales = role === "sales" || role === "superadmin";
  const vm = role === "vm" || role === "procurement" || role === "superadmin";
  const any = !!role;
  return {
    viewQueue: any, viewSubmissions: any, viewProfitability: any, comment: any, confirmGoLive: any,
    createRequest: sales, quickCheck: sales,
    workTickets: vm, manageRates: vm, editProfitability: vm, seeVendorData: vm,
    manageUsers: role === "superadmin",
  };
}

const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 19).replace("T", " ");
const VENDORS = ["Duta Trans", "Seryu Logistik", "Mitra Cargo", "Sinar Jaya", "Anugrah Trucking"];
const SHIPPERS = [
  ["PT Nusantara Cipta Mandiri", "dewi@ninjavan.co", "Dewi Anggraini", "FMCG"],
  ["PT Sinar Abadi Logistik", "fajar@ninjavan.co", "Fajar Ramadhan", "Electronics"],
  ["PT Jaya Makmur Retail", "siti@ninjavan.co", "Siti Nurhaliza", "Retail goods"],
  ["PT Cahaya Distribusi Utama", "dewi@ninjavan.co", "Dewi Anggraini", "Building materials"],
  ["PT Global Trans Sejahtera", "fajar@ninjavan.co", "Fajar Ramadhan", "Frozen food"],
];
const LANES = [
  ["Kab. Bekasi", "Kota Balikpapan", "CDE"], ["Kota Jakarta Timur", "Kota Palembang", "Wingbox"],
  ["Kota Bandung", "Kota Lampung", "CDD-L"], ["Kab. Tangerang", "Kab. Banyuwangi", "CDD-L"],
  ["Kab. Bekasi", "Kab. Sidoarjo", "CDD-L"], ["Kota Jakarta Utara", "Kota Balikpapan", "Wingbox"],
  ["Kab. Tangerang", "Kota Makassar", "CDE"], ["Kota Surabaya", "Kota Semarang", "Fuso"],
  ["Kab. Karawang", "Kota Medan", "Wingbox"], ["Kota Bandung", "Kota Jambi", "Wingbox"],
];
const STATUSES = ["open", "open", "in_progress", "open", "resolved", "closed_no_vendor", "open", "resolved", "closed_no_lower_rate"];

let nextId = 1;
const submissions = SHIPPERS.map(([name, email, pic, commodity], i) => ({
  id: 100 + i, uploaded_by: email, filename: `${name.split(" ")[1].toLowerCase()}.csv`, created_at: daysAgo(12 - i * 2),
  shipper_name: name, sales_pic: pic, sales_email: email, submitted_at: daysAgo(12 - i * 2),
  shipper_status: i % 2 ? "existing" : "new", potential_monthly_revenue: (i + 2) * 150_000_000,
  commodity_type: commodity, high_value_fragile: i === 1,
  add_ons: i % 2 ? [{ label: "Overnight", value: "2 nights max", service: "overnight" }] : [],
}));

const tickets = [];
const rows = {};
submissions.forEach((s, si) => {
  rows[s.id] = [];
  for (let k = 0; k < 5; k++) {
    const [o, d, v] = LANES[(si * 3 + k) % LANES.length];
    const cost = 3_000_000 + ((si * 7 + k * 13) % 17) * 600_000;
    const status = si === 3 ? "open" : STATUSES[(si * 5 + k) % STATUSES.length];
    const age = [9, 6, 5, 2, 1, 8, 3, 0, 4][(si + k) % 9];
    const ranked = VENDORS.slice(0, 1 + ((si + k) % 4)).map((vn, j) => ({ vendor: vn, cost: cost + j * 250_000 }));
    const target = k % 3 ? Math.round(cost * 1.05) : null;
    const final = status === "closed_no_vendor" || (k === 0 && status === "open") ? null : Math.round(cost * 1.111);
    const rowId = nextId++;
    rows[s.id].push({
      id: rowId, origin: o, destination: d, vehicle_type: v, target_rate: target, final_rate: final,
      remarks: final ? (target && final > target ? "Already bottom rate" : "Meets target") : "Sent to VM for review",
      matched_vendor: final ? ranked[Math.min(1, ranked.length - 1)].vendor : null, min_trip: 10 + k * 5,
      raised_to_vm: true, needs_vm: false,
    });
    const resolved = status === "resolved";
    tickets.push({
      id: rowId, origin: o, destination: d, vehicle_type: v, target_rate: target,
      target_cost: target ? Math.round(target / 1.111) : null, current_final_rate: final,
      requested_by: s.uploaded_by, status, resolved_vendor: resolved ? ranked[0].vendor : null,
      resolved_cost: resolved ? ranked[0].cost : null, created_at: daysAgo(age), aging_days: age,
      submission_row_id: rowId, submission_id: s.id, shipper_name: s.shipper_name, sales_pic: s.sales_pic,
      shipper_status: s.shipper_status, potential_monthly_revenue: s.potential_monthly_revenue,
      commodity_type: s.commodity_type, high_value_fragile: s.high_value_fragile,
      submission_created_at: s.created_at, add_ons: s.add_ons, sales_email: s.sales_email, min_trip: 10 + k * 5,
      auto_closed_sla: status === "closed_no_vendor" && age > 7,
      vendor_count: ranked.length, only_one_vendor: ranked.length === 1, single_vendor_approved: false,
      override_reason: null, override_by: null,
      winner_basis: resolved ? `2nd cheapest of ${ranked.length} vendors` : null, ranked_vendors: ranked,
    });
  }
});

const comments = { 100: [{ id: 1, submission_id: 100, author_email: "baskoro@ninjavan.co", message: "@Dewi checking Balikpapan with Duta Trans today.", created_at: daysAgo(1) }] };

const ticketNo = (id) => `FTL-${String(id).padStart(6, "0")}`;

function detailOf(s, P, me) {
  const ts = tickets.filter((t) => t.submission_id === s.id);
  return {
    submission: s,
    rows: rows[s.id].map((r) => (P.seeVendorData ? r : { ...r, matched_vendor: null })),
    ticket_no: ticketNo(s.id),
    editable: !!P.createRequest && s.uploaded_by === me && ts.every((t) => t.status === "open"),
  };
}

function redactTicket(t, role) {
  if (perms(role).seeVendorData) return t;
  return { ...t, resolved_vendor: null, resolved_cost: null, target_cost: null, vendor_count: null, winner_basis: null, ranked_vendors: [] };
}

const isOpen = (t) => t.status === "open" || t.status === "in_progress";

function summary() {
  const group = (list) => {
    const m = new Map();
    for (const t of list) {
      const k = `${t.origin}|${t.destination}|${t.vehicle_type}`;
      const e = m.get(k) || { origin: t.origin, destination: t.destination, vehicle_type: t.vehicle_type, request_count: 0, sum: 0, n: 0 };
      e.request_count++;
      if (t.target_rate) { e.sum += t.target_rate; e.n++; }
      m.set(k, e);
    }
    return [...m.values()].map(({ sum, n, ...e }) => ({ ...e, avg_target_rate: n ? Math.round(sum / n) : null }))
      .sort((a, b) => b.request_count - a.request_count);
  };
  return {
    seeking_lower_rate: group(tickets.filter((t) => (isOpen(t) || t.status === "closed_no_lower_rate") && t.current_final_rate != null)),
    missing_lanes: group(tickets.filter((t) => t.status === "closed_no_vendor")).map(({ avg_target_rate, ...e }) => e),
  };
}

const serviceRequests = submissions.filter((s) => s.add_ons.length).map((s, i) => ({
  submission_id: s.id, shipper_name: s.shipper_name, sales_pic: s.sales_pic, sales_email: s.sales_email,
  requested_by: s.uploaded_by, created_at: s.created_at, aging_days: 3 + i, status: i ? "done" : "open",
  items: [{ id: 50 + i, service: "overnight", label: "Overnight", unit: "per malam", note: s.add_ons[0].value,
    unit_price: i ? 1_000_000 : null, unavailable: false, auto_closed_sla: false,
    answered_by: i ? "baskoro@ninjavan.co" : null, answered_at: i ? daysAgo(1) : null }],
  lanes: rows[s.id].slice(0, 2).map((r) => ({ origin: r.origin, destination: r.destination, vehicle_type: r.vehicle_type, vendor: r.matched_vendor })),
}));

const live = ["PT Sinar Abadi Logistik"];
const sheet = {
  quotation: rows[101].filter((r) => r.final_rate).map((r) => ({ origin: r.origin, destination: r.destination, vehicle_type: r.vehicle_type, vendor: r.matched_vendor, cost: Math.round(r.final_rate / 1.111), rate: r.final_rate, margin_pct: 11.1 })),
  orders: [{ order_no: "FTL-0001", order_date: daysAgo(3).slice(0, 10), origin: rows[101][0].origin, destination: rows[101][0].destination, vehicle_type: rows[101][0].vehicle_type, status: "completed", planned_vendor: "Duta Trans", est_cost: 6_000_000, rate: 6_666_000, actual_vendor: "Seryu Logistik", actual_invoice_cost: 6_100_000, revenue_uang_jalan: 6_666_000, revenue_overnight: 0 }],
};

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(body === undefined ? "" : JSON.stringify(body));
}

const readBody = (req) =>
  new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } });
  });

export default function mockApi() {
  let role = "superadmin";
  return {
    name: "ftl-mock-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith("/api/")) return next();
        const url = new URL(req.url, "http://x");
        const p = url.pathname;
        const m = req.method;
        // Same rule as the backend: X-View-As is honoured only for a real superadmin.
        const viewAs = String(req.headers["x-view-as"] || "").toLowerCase();
        const realRole = role;
        const effRole = realRole === "superadmin" && VIEW_AS_ROLES.includes(viewAs) ? viewAs : realRole;
        const P = perms(effRole);
        const me = AS[realRole];
        const deny = () => json(res, 403, { detail: "Not allowed" });

        if (p === "/api/__mock/role") { role = url.searchParams.get("as") || role; return json(res, 200, { role }); }
        if (p === "/api/me") return json(res, 200, { email: me, role: effRole, permissions: P, real_role: realRole, view_as_options: realRole === "superadmin" ? VIEW_AS_ROLES : [], mock: true });
        if (p === "/api/users") return json(res, 200, { users: USERS });
        if (p === "/api/notifications") return json(res, 200, { notifications: [{ id: 1, submission_id: 100, shipper_name: "PT Nusantara Cipta Mandiri", message: "Baskoro mentioned you: checking Balikpapan with Duta Trans today.", created_at: daysAgo(1), read_at: null }], unread_count: 1 });
        if (p.startsWith("/api/notifications/")) return json(res, 204);
        if (p === "/api/ticket-views") return json(res, 200, { views: [] });
        if (/^\/api\/submissions\/\d+\/view$/.test(p)) return json(res, 204);

        if (p === "/api/vm/requests" && m === "GET") {
          const sid = Number(url.searchParams.get("submission_id")) || null;
          return json(res, 200, { requests: tickets.filter((t) => !sid || t.submission_id === sid).map((t) => redactTicket(t, effRole)) });
        }
        if (p === "/api/ticket-board") {
          const vmOnly = url.searchParams.get("vm_only") === "true";
          if (vmOnly && !P.workTickets) return deny();
          const board = submissions
            .map((s) => {
              const rs = rows[s.id];
              const ts = tickets.filter((t) => t.submission_id === s.id);
              const open = ts.filter((t) => t.status === "open" || t.status === "in_progress");
              return {
                id: s.id, ticket_no: ticketNo(s.id), raised_at: s.submitted_at, shipper_name: s.shipper_name,
                sales_pic: s.sales_pic, sales_email: s.sales_email, raised_by: s.uploaded_by,
                commodity_type: s.commodity_type, add_ons: s.add_ons, lane_count: rs.length,
                vehicles: [...new Set(rs.map((r) => r.vehicle_type))].sort(),
                has_target_rate: rs.some((r) => r.target_rate != null), priced_count: rs.filter((r) => r.final_rate != null).length,
                vm_open_count: open.length, vm_working_count: open.filter((t) => t.status === "in_progress").length,
                oldest_open_days: open.length ? Math.max(...open.map((t) => t.aging_days)) : null,
                editable: P.createRequest && s.uploaded_by === me && ts.every((t) => t.status === "open"),
              };
            })
            .filter((t) => !vmOnly || t.vm_open_count > 0)
            .sort((a, b) => String(b.raised_at).localeCompare(String(a.raised_at)));
          return json(res, 200, { tickets: board });
        }
        if (p === "/api/available-routes") {
          if (!P.quickCheck) return deny();
          const seen = new Map();
          for (const t of tickets) {
            const k = `${t.origin}|${t.destination}|${t.vehicle_type}`;
            if (seen.has(k)) continue;
            const c = t.ranked_vendors.map((v) => v.cost).sort((a, b) => a - b);
            seen.set(k, { origin: t.origin, destination: t.destination, vehicle_type: t.vehicle_type,
              status: c.length >= 2 ? "ready" : "single", final_rate: c.length >= 2 ? Math.round(c[1] * 1.111) : null });
          }
          return json(res, 200, { routes: [...seen.values()] });
        }
        if (p === "/api/vm/summary") return json(res, 200, summary());
        if (p === "/api/vm/service-requests") return json(res, 200, { requests: serviceRequests.map((s) => (P.seeVendorData ? s : { ...s, lanes: s.lanes.map((l) => ({ ...l, vendor: null })) })) });
        if (p === "/api/service-requests") return json(res, 200, { requests: serviceRequests.filter((s) => s.requested_by === me) });
        if (p.startsWith("/api/vm/")) {
          if (!P.workTickets) return deny();
          const id = Number(p.split("/")[4]);
          const t = tickets.find((x) => x.id === id);
          if (p.endsWith("/close-no-vendor") && t) t.status = "closed_no_vendor";
          if (m === "PATCH" && t) Object.assign(t, await readBody(req));
          if (p.includes("resolve-ready")) return json(res, 200, { checked_count: 3, resolved_count: 1 });
          return json(res, 200, t || {});
        }

        if (p === "/api/submissions") {
          if (url.searchParams.get("scope") === "all") return json(res, 200, { submissions: submissions.slice().reverse() });
          if (!P.createRequest) return deny();
          return json(res, 200, { submissions: submissions.filter((s) => s.uploaded_by === me).reverse() });
        }
        let mm;
        if ((mm = p.match(/^\/api\/submissions\/(\d+)$/)) && m === "GET") {
          const s = submissions.find((x) => x.id === Number(mm[1]));
          if (!s) return json(res, 404, { detail: "Submission not found" });
          return json(res, 200, detailOf(s, P, me));
        }
        if ((mm = p.match(/^\/api\/submissions\/(\d+)\/rows\/(\d+)$/)) && m === "PUT") {
          const s = submissions.find((x) => x.id === Number(mm[1]));
          const ts = tickets.filter((t) => t.submission_id === s?.id);
          if (!s || !P.createRequest || s.uploaded_by !== me || !ts.every((t) => t.status === "open")) {
            return json(res, 403, { detail: "Only the person who raised this ticket can edit it, until VM starts on it" });
          }
          const b = await readBody(req);
          const r = rows[s.id].find((x) => x.id === Number(mm[2]));
          Object.assign(r, { origin: b.origin, destination: b.destination, vehicle_type: b.vehicle_type, target_rate: b.target_rate, min_trip: b.min_trip });
          const t = ts.find((x) => x.submission_row_id === r.id);
          if (t) Object.assign(t, { origin: b.origin, destination: b.destination, vehicle_type: b.vehicle_type, target_rate: b.target_rate });
          return json(res, 200, detailOf(s, P, me));
        }
        if ((mm = p.match(/^\/api\/submissions\/(\d+)\/comments$/))) {
          const sid = Number(mm[1]);
          if (m === "POST") {
            const b = await readBody(req);
            const c = { id: Date.now(), submission_id: sid, author_email: me, message: b.message, created_at: daysAgo(0) };
            (comments[sid] = comments[sid] || []).push(c);
            return json(res, 201, c);
          }
          return json(res, 200, { comments: comments[sid] || [] });
        }
        if ((mm = p.match(/^\/api\/vm-requests\/(\d+)\/comments$/))) return json(res, 200, { comments: [] });
        if (p === "/api/lanes") {
          const mine = submissions.filter((s) => s.uploaded_by === me);
          return json(res, 200, { lanes: mine.flatMap((s) => rows[s.id].map((r) => {
            const t = tickets.find((x) => x.submission_row_id === r.id);
            return { id: r.id, submission_id: s.id, submitted_at: s.submitted_at, shipper_name: s.shipper_name, sales_pic: s.sales_pic,
              origin: r.origin, destination: r.destination, vehicle_type: r.vehicle_type, target_rate: r.target_rate,
              final_rate: t?.current_final_rate ?? r.final_rate, remarks: r.remarks, matched_vendor: null, vm_status: t?.status ?? null,
              vm_request_id: t?.id ?? null, aging_days: t?.aging_days ?? null, add_ons: s.add_ons, sales_email: s.sales_email,
              min_trip: r.min_trip, auto_closed_sla: !!t?.auto_closed_sla };
          })) });
        }
        if (p === "/api/tickets") return json(res, 200, { requests: tickets.filter((t) => t.requested_by === me).map((t) => redactTicket(t, effRole)) });
        if (p === "/api/quick-check") {
          const o = url.searchParams.get("origin"), d = url.searchParams.get("destination"), v = url.searchParams.get("vehicle_type");
          const t = tickets.find((x) => x.origin === o && x.destination === d && x.vehicle_type === v && x.ranked_vendors.length > 1);
          return json(res, 200, { origin: o, destination: d, vehicle_type: v, vendor_count: t ? t.ranked_vendors.length : 0, available: !!t,
            final_rate: t ? Math.round(t.ranked_vendors[1].cost * 1.111) : null,
            winners: t ? t.ranked_vendors.slice(0, 3).map((x, i) => ({ rank: i + 1, price: Math.round(x.cost * 1.111) })) : [] });
        }

        if (p.startsWith("/api/master-rates")) {
          if (!P.manageRates) return deny();
          if (p.endsWith("/meta")) return json(res, 200, { uploaded_by: "baskoro@ninjavan.co", filename: "vendor_rates_nov.csv", row_count: 412, created_at: daysAgo(4) });
          if (p.endsWith("/vendors")) return json(res, 200, { vendors: VENDORS });
          return json(res, 200, { rates: tickets.flatMap((t) => t.ranked_vendors.map((r) => ({ origin: t.origin, destination: t.destination, vehicle_type: t.vehicle_type, vendor_name: r.vendor, cost: r.cost, updated_by: "baskoro@ninjavan.co", updated_at: daysAgo(4) }))) });
        }

        if (p === "/api/profitability/candidates") return json(res, 200, { shippers: submissions.filter((s) => !live.includes(s.shipper_name)).slice(0, 2).map((s) => ({ shipper_name: s.shipper_name, sales_email: s.sales_email, sales_pic: s.sales_pic, lane_count: 5, priced_lane_count: 3, last_submitted_at: s.submitted_at })) });
        if (p === "/api/profitability/tracker") return json(res, 200, { shippers: live.map((n) => ({ shipper_name: n, sales_email: "fajar@ninjavan.co", sales_pic: "Fajar Ramadhan", confirmed_by: "fajar@ninjavan.co", confirmed_at: daysAgo(2), quotation_count: sheet.quotation.length, order_count: sheet.orders.length })) });
        if (p === "/api/profitability/sheet") {
          if (P.seeVendorData) return json(res, 200, { shipper_name: url.searchParams.get("shipper_name"), ...sheet });
          return json(res, 200, { shipper_name: url.searchParams.get("shipper_name"),
            quotation: sheet.quotation.map((q) => ({ ...q, vendor: null, cost: null, margin_pct: null })),
            orders: sheet.orders.map((o) => ({ ...o, planned_vendor: null, est_cost: null, actual_vendor: null, actual_invoice_cost: null })) });
        }
        if (p === "/api/profitability/quotation" || p === "/api/profitability/orders") return P.editProfitability ? json(res, 204) : deny();
        if (p.startsWith("/api/profitability/")) return json(res, 204);

        if (p.startsWith("/api/admin/")) return P.manageUsers ? json(res, 200, { users: USERS }) : deny();
        return json(res, 404, { detail: `mock: no handler for ${m} ${p}` });
      });
    },
  };
}
