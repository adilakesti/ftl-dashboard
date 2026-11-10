import { useEffect, useState } from "react";
import { Td, Th, resetDirectoryUsers } from "../shared.jsx";

// Superadmin
// ---------------------------------------------------------------------------

export function AdminPanel() {
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
              <option value="procurement">Procurement</option>
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
                    <option value="procurement">Procurement</option>
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
