// Superadmin "View as": preview the app as another role. The chosen role is kept for
// this browser tab and sent as `X-View-As` on every /api call; the backend honours it
// only for a real superadmin and then answers exactly as it would for that role
// (permissions and vendor-data stripping included). Ignored for everyone else.

const KEY = "ftl.viewAs";

export function getViewAs() {
  try {
    return sessionStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function setViewAs(role) {
  try {
    if (role) sessionStorage.setItem(KEY, role);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the switch simply won't persist */
  }
  window.location.reload();
}

export function installViewAs() {
  const original = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const role = getViewAs();
    const url = typeof input === "string" ? input : input?.url || "";
    if (!role || !url.startsWith("/api/")) return original(input, init);
    const headers = new Headers(init.headers || (typeof input === "string" ? undefined : input.headers));
    headers.set("X-View-As", role);
    return original(input, { ...init, headers });
  };
}
