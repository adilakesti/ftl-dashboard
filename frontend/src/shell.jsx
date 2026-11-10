import { useEffect, useRef, useState } from "react";
import { AdminPanel } from "./screens/Admin.jsx";
import { Overview } from "./screens/Overview.jsx";
import { ProfitabilityView } from "./screens/Profitability.jsx";
import { SalesView } from "./screens/Sales.jsx";
import { AvailableRoutes, TicketBoard, TicketDetail } from "./screens/Tickets.jsx";
import { MasterRatesPanel, PrioritizationScreen, ServicesScreen } from "./screens/Vm.jsx";
import { useDirectoryUsers, useMe, userLabel } from "./shared.jsx";
import { getViewAs, setViewAs } from "./viewAs.js";

// ---------------------------------------------------------------------------
// One app for every role. Everyone gets the same shell and the same screens; each
// menu entry's `when` reads the permission map the backend sends (/api/me), so the
// menu and the API agree on who may do what — there is no second rule set here.
// ---------------------------------------------------------------------------

const ICONS = {
  home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
  plus: "M12 5v14M5 12h14",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v7H2v-7z",
  ticket: "M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4zM13 7v12",
  flag: "M4 21V4h12l-1.5 4L16 12H4",
  tool: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z",
  database: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  chart: "M3 3v18h18M7 15l4-4 3 3 6-6",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  menu: "M3 6h18M3 12h18M3 18h18",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8",
  queue: "M4 6h16M4 10h16M4 14h10M4 18h7M17 15l2 2 4-4",
};

function Icon({ name, className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const NAV = [
  [
    null,
    [
      { id: "overview", label: "Overview", icon: "home", when: (p) => p.viewQueue },
      { id: "dashboard", label: "Dashboard Ticket", icon: "ticket", when: (p) => p.viewQueue },
    ],
  ],
  [
    "Requests",
    [
      { id: "new-request", label: "New request", icon: "plus", when: (p) => p.createRequest },
      { id: "my-requests", label: "My requests", icon: "inbox", when: (p) => p.createRequest },
      { id: "quick-check", label: "Quick check", icon: "search", when: (p) => p.quickCheck },
      { id: "available-routes", label: "Available Route", icon: "route", when: (p) => p.quickCheck },
    ],
  ],
  [
    "Vendor Management",
    [
      { id: "vm-queue", label: "VM queue", icon: "queue", when: (p) => p.workTickets, count: true },
      { id: "prioritization", label: "Prioritization", icon: "flag", when: (p) => p.viewQueue },
      { id: "services", label: "Extra services", icon: "tool", when: (p) => p.viewQueue },
      { id: "rates", label: "Master vendor rates", icon: "database", when: (p) => p.manageRates },
    ],
  ],
  ["After go-live", [{ id: "profitability", label: "Profitability", icon: "chart", when: (p) => p.viewProfitability }]],
  ["Admin", [{ id: "users", label: "Users and roles", icon: "users", when: (p) => p.manageUsers }]],
];

const PAGE = {
  overview: ["Overview", "Where the queue stands and what needs a look first."],
  "new-request": ["New rate request", "Shipper details, then the lanes. Rates come back instantly where vendors exist."],
  "my-requests": ["My requests", "Your lanes and extra-service requests, and where each one stands."],
  "quick-check": ["Quick check", "Look up a lane's price without saving anything."],
  "available-routes": ["Available Route", "Routes and trucks we have vendors for. Filter to see what you can sell."],
  dashboard: ["Dashboard Ticket", "Every raised ticket, newest first. Open one to see each OD pair and its status."],
  "vm-queue": ["VM queue", "Tickets with lanes waiting on vendor management or being worked on. SLA is 7 days per lane."],
  prioritization: ["Prioritization", "Lanes that keep coming back: worth a vendor push."],
  services: ["Extra services", "Overnight, TKBM and extra drop-point prices sales asked for."],
  rates: ["Master vendor rates", "Upload or check the vendor cost list every price is computed from."],
  profitability: ["Profitability", "Shippers that went live: quoted vs. actual, per order."],
  users: ["Users and roles", "Who can sign in, and as what."],
};

// Fallback for a backend that does not send `permissions` yet (mirrors backend/permissions.py).
function permissionsFromRole(role) {
  const sales = role === "sales" || role === "superadmin";
  const vm = role === "vm" || role === "procurement" || role === "superadmin";
  const any = !!role;
  return {
    viewQueue: any, viewSubmissions: any, viewProfitability: any, comment: any, confirmGoLive: any,
    createRequest: sales, quickCheck: sales, workTickets: vm, manageRates: vm, editProfitability: vm,
    seeVendorData: vm, manageUsers: role === "superadmin",
  };
}

const visibleNav = (perms) =>
  NAV.map(([group, items]) => [group, items.filter((i) => i.when(perms))]).filter(([, items]) => items.length);

const SCREEN_ALIASES = { queue: "dashboard", submissions: "dashboard" }; // old links keep working

function screenFromUrl(allowed) {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("screen");
  const s = SCREEN_ALIASES[raw] || raw;
  return allowed.includes(s) ? s : allowed[0];
}

function ticketFromUrl() {
  const t = Number(new URLSearchParams(window.location.search).get("ticket"));
  return Number.isInteger(t) && t > 0 ? t : null;
}

export function BrandedMessage({ title, children }) {
  return (
    <div className="min-h-screen bg-ink-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-8 max-w-md w-full text-center">
        <img src="/assets/ryo-standing.png" alt="" className="h-24 mx-auto mb-3" />
        <p className="font-semibold text-lg text-ink-900 mb-1">{title}</p>
        <div className="text-sm text-ink-500">{children}</div>
      </div>
    </div>
  );
}

function useOutsideClose(open, setOpen) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return ref;
}

export function NotificationBell({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useOutsideClose(open, setOpen);

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
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative h-9 w-9 rounded-md flex items-center justify-center text-ink-500 hover:bg-ink-100 hover:text-ink-900"
        aria-label="Notifications"
      >
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-brand-600 text-white text-[10px] font-semibold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-xl border border-ink-100 shadow-xl z-50">
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
              className={`w-full text-left px-3 py-2 border-b border-ink-50 hover:bg-ink-50 ${n.read_at ? "" : "bg-brand-50"}`}
            >
              <div className="text-xs font-medium">{n.shipper_name || `Submission #${n.submission_id}`}</div>
              <div className="text-xs text-ink-500 line-clamp-2">{n.message}</div>
              <div className="text-[11px] text-ink-400 mt-0.5">{n.created_at}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ROLE_LABEL = { sales: "Sales", vm: "Vendor mgmt", procurement: "Procurement", superadmin: "Superadmin" };

// Superadmin only: preview the whole app as another role (see viewAs.js).
function ViewAsSwitch({ me }) {
  const current = getViewAs();
  return (
    <label className="hidden md:flex items-center gap-1.5 text-xs text-ink-500 border border-ink-200 rounded-md pl-2 pr-1 py-1">
      View as
      <select
        value={current}
        onChange={(e) => setViewAs(e.target.value)}
        className="bg-transparent font-medium text-ink-900 focus:outline-none"
        aria-label="View the app as role"
      >
        <option value="">Superadmin</option>
        {me.view_as_options.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r] || r}
          </option>
        ))}
      </select>
    </label>
  );
}

// Local preview only (npm run dev:mock): switch which signed-in user the mock API is.
function MockRoleSwitch({ role }) {
  const change = async (as) => {
    await fetch(`/api/__mock/role?as=${as}`);
    setViewAs("");
  };
  return (
    <label className="hidden md:flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 ring-1 ring-amber-200 rounded-md px-2 py-1">
      Mock user
      <select value={role} onChange={(e) => change(e.target.value)} className="bg-transparent font-medium focus:outline-none">
        <option value="sales">Sales</option>
        <option value="vm">Vendor mgmt</option>
        <option value="procurement">Procurement</option>
        <option value="superadmin">Superadmin</option>
      </select>
    </label>
  );
}

export function AppInner() {
  const { me, loading } = useMe();
  const users = useDirectoryUsers();
  const [screen, setScreen] = useState(null);
  const [screenArgs, setScreenArgs] = useState({});
  const [focusSubmissionId, setFocusSubmissionId] = useState(null);
  const [openCount, setOpenCount] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");

  const perms = me?.role ? me.permissions && Object.keys(me.permissions).length ? me.permissions : permissionsFromRole(me.role) : null;
  const nav = perms ? visibleNav(perms) : [];
  const allowed = nav.flatMap(([, items]) => items.map((i) => i.id));

  useEffect(() => {
    if (perms && !screen) {
      setScreen(screenFromUrl(allowed));
      setScreenArgs({ ticket: ticketFromUrl() });
    }
  }, [perms, screen]);

  // VM queue badge: how many tickets are waiting on VM.
  useEffect(() => {
    if (!perms?.workTickets) return;
    const load = () =>
      fetch("/api/ticket-board?vm_only=true")
        .then((r) => (r.ok ? r.json() : { tickets: [] }))
        .then((d) => setOpenCount(d.tickets.length))
        .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [perms?.workTickets]);

  useEffect(() => {
    const onPop = () => {
      if (!perms) return;
      setScreen(screenFromUrl(allowed));
      setScreenArgs({ ticket: ticketFromUrl() });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });

  if (loading) return <BrandedMessage title="Loading…">Warming up the trucks.</BrandedMessage>;
  if (!me?.email) {
    return <BrandedMessage title="Sign in required">Sign in with your company Google account.</BrandedMessage>;
  }
  if (!me.role) {
    return (
      <BrandedMessage title="Not provisioned">
        {me.email} isn't set up yet. Ask an admin to add you as sales or vendor management.
      </BrandedMessage>
    );
  }
  if (!screen) return null;

  const navigate = (id, args = {}) => {
    if (!allowed.includes(id)) return;
    setScreen(id);
    setScreenArgs(args);
    setNavOpen(false);
    const url =
      `${window.location.pathname}?screen=${encodeURIComponent(id)}` + (args.ticket ? `&ticket=${args.ticket}` : "");
    if (url !== window.location.pathname + window.location.search) window.history.pushState(null, "", url);
    window.scrollTo(0, 0);
  };

  // Sales sub-screens are tabs inside SalesView; the sidebar drives them.
  const salesTab = { "new-request": "new", "quick-check": "quick", "my-requests": screenArgs.salesTab || "active" }[screen];
  const onSalesTab = (t) =>
    t === "new" ? navigate("new-request") : t === "quick" ? navigate("quick-check") : navigate("my-requests", { salesTab: t });

  // Notifications are about a ticket: open it.
  const onNotification = (submissionId) => navigate("dashboard", { ticket: submissionId });
  const openTicket = (from) => (id) => navigate(from, { ticket: id });

  const runGlobalSearch = (e) => {
    e.preventDefault();
    const q = globalSearch.trim();
    if (!q) return;
    navigate("dashboard", { search: q });
    setGlobalSearch("");
  };

  const displayName = userLabel(users.find((u) => u.email === me.email) || { email: me.email });
  const [title, subtitle] = PAGE[screen] || ["", ""];

  const sidebar = (
    <nav className="flex flex-col gap-4 p-3">
      {nav.map(([group, items]) => (
        <div key={group || "top"}>
          {group && <p className="px-2 mb-1 text-[11px] font-medium text-ink-400 uppercase tracking-wide">{group}</p>}
          <ul className="space-y-0.5">
            {items.map((i) => (
              <li key={i.id}>
                <button
                  onClick={() => navigate(i.id)}
                  className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition ${
                    screen === i.id ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700 hover:bg-ink-100"
                  }`}
                >
                  <Icon name={i.icon} />
                  <span className="flex-1 text-left">{i.label}</span>
                  {i.count && openCount != null && (
                    <span className={`text-xs tabular-nums ${screen === i.id ? "text-brand-700" : "text-ink-400"}`}>{openCount}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-30 h-14 bg-white border-b border-ink-100 flex items-center gap-3 px-3 lg:px-4">
        <button onClick={() => setNavOpen((v) => !v)} className="lg:hidden h-9 w-9 flex items-center justify-center rounded-md hover:bg-ink-100" aria-label="Menu">
          <Icon name="menu" className="h-5 w-5" />
        </button>
        <button onClick={() => navigate(allowed[0])} className="flex items-center gap-2.5 shrink-0">
          <img src="/assets/truck-side.png" alt="" className="h-7" />
          <span className="text-left leading-tight">
            <span className="block text-sm font-bold text-ink-900">FTL Pricing</span>
            <span className="block text-[11px] text-ink-500">Ninja Xpress · on-call only</span>
          </span>
        </button>

        {perms.viewQueue && (
          <form onSubmit={runGlobalSearch} className="hidden md:block flex-1 max-w-md mx-4">
            <div className="relative">
              <Icon name="search" className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search tickets: FTL no., shipper, sales"
                className="w-full bg-ink-50 border border-ink-100 rounded-md pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:bg-white focus:border-brand-600"
              />
            </div>
          </form>
        )}
        <span className="flex-1" />

        {me.mock && <MockRoleSwitch role={me.real_role || me.role} />}
        {me.view_as_options?.length > 0 && <ViewAsSwitch me={me} />}
        <NotificationBell onNavigate={onNotification} />
        <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-ink-100">
          <span className="h-8 w-8 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold flex items-center justify-center">
            {displayName.split(/[\s@.]/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("")}
          </span>
          <span className="leading-tight">
            <span className="block text-sm text-ink-900 max-w-[160px] truncate">{displayName}</span>
            <span className="block text-[11px] text-ink-500">{ROLE_LABEL[me.real_role || me.role] || me.role}</span>
          </span>
        </div>
      </header>

      {me.real_role === "superadmin" && me.role !== "superadmin" && (
        <div className="sticky top-14 z-20 bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-sm text-amber-900 flex items-center justify-center gap-3">
          <span>
            Viewing as <b>{ROLE_LABEL[me.role] || me.role}</b>: you see exactly what they see. Actions still run as you.
          </span>
          <button onClick={() => setViewAs("")} className="underline font-medium">
            Back to superadmin
          </button>
        </div>
      )}

      <div className="flex">
        <aside className="hidden lg:block w-56 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-ink-100 bg-white">
          {sidebar}
        </aside>
        {navOpen && (
          <div className="lg:hidden fixed inset-0 top-14 z-20 bg-black/30" onClick={() => setNavOpen(false)}>
            <aside className="w-64 h-full bg-white border-r border-ink-100 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              {sidebar}
            </aside>
          </div>
        )}

        <main className="flex-1 min-w-0 px-4 lg:px-8 py-6">
          <div className="max-w-[1400px] mx-auto">
            <div className="mb-5">
              <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
              {subtitle && <p className="text-sm text-ink-500 mt-0.5">{subtitle}</p>}
            </div>

            {screen === "overview" && <Overview me={{ ...me, permissions: perms }} onNavigate={navigate} />}
            {salesTab && (
              <SalesView
                tab={salesTab}
                onTabChange={onSalesTab}
                focusSubmissionId={focusSubmissionId}
                onFocusHandled={() => setFocusSubmissionId(null)}
              />
            )}
            {(screen === "dashboard" || screen === "vm-queue") &&
              (screenArgs.ticket ? (
                <TicketDetail ticketId={screenArgs.ticket} perms={perms} onBack={() => navigate(screen)} />
              ) : (
                <TicketBoard
                  key={screen}
                  mode={screen === "vm-queue" ? "vm" : "all"}
                  initialSearch={screenArgs.search || ""}
                  onOpen={openTicket(screen)}
                />
              ))}
            {screen === "available-routes" && <AvailableRoutes />}
            {screen === "prioritization" && <PrioritizationScreen />}
            {screen === "services" && <ServicesScreen canEdit={!!perms.workTickets} />}
            {screen === "rates" && <MasterRatesPanel />}
            {screen === "profitability" && <ProfitabilityView me={{ ...me, permissions: perms }} />}
            {screen === "users" && <AdminPanel />}
          </div>
        </main>
      </div>
    </div>
  );
}
