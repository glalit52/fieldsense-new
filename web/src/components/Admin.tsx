import { useEffect, useState } from "react";
import { api, type AdminUser, type User } from "../lib/api.ts";

/** Usage overview and user roles. Visible to admins only (role "admin" or listed in ADMIN_EMAILS on the server). */
export default function Admin({ me }: { me: User }) {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [list, setList] = useState<{ total: number; page: number; limit: number; users: AdminUser[] } | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => { api.adminStats().then(setStats).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    const t = setTimeout(() => api.adminUsers(q, page).then(setList).catch((e) => setError(e.message)), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, page]);

  const setRole = async (u: AdminUser, role: "user" | "admin") => {
    if (!confirm(`${role === "admin" ? "Make" : "Remove"} ${u.email} ${role === "admin" ? "an admin" : "as admin"}?`)) return;
    setError("");
    try {
      const updated = await api.setRole(u.id, role);
      setList((l) => l && { ...l, users: l.users.map((x) => (x.id === u.id ? { ...x, role: updated.role } : x)) });
    } catch (e: any) { setError(e.message); }
  };

  const stat = (label: string, value?: number, sub?: string) => (
    <div className="stat card"><span className="label">{label}</span><span className="value">{value ?? "–"}</span>{sub && <span className="sub">{sub}</span>}</div>
  );
  const pages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1;

  return (
    <div className="grid">
      <div className="stats">
        {stat("Users", stats?.users, stats ? `+${stats.users7d} this week · +${stats.users30d} in 30 days` : undefined)}
        {stat("Active this week", stats?.active7d, "signed in within 7 days")}
        {stat("Saved fields", stats?.fields)}
        {stat("Lab tests", stats?.tests)}
        {stat("Journal entries", stats?.activities)}
      </div>
      <div className="card wide">
        <h3>Users {list && <span className="muted small">{list.total}</span>}</h3>
        <div className="toolbar">
          <input type="search" aria-label="Search users" placeholder="Search name, email, organisation…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="table-scroll">
          <table className="ops">
            <thead><tr><th>Name</th><th>Email</th><th>Organisation</th><th>Fields</th><th>Joined</th><th>Last sign-in</th><th>Role</th></tr></thead>
            <tbody>{list?.users.map((u) => (
              <tr key={u.id}>
                <td><b>{u.name}</b></td>
                <td>{u.email}</td>
                <td>{u.organization || "–"}</td>
                <td>{u.fields}</td>
                <td className="small">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="small">{u.lastLogin ? new Date(u.lastLogin).toLocaleString() : "–"}</td>
                <td>
                  {u.role === "admin" ? <span className="tag good">admin</span> : <span className="tag">user</span>}{" "}
                  {u.id !== me.id && (u.role === "admin"
                    ? <button className="link-inline small" onClick={() => setRole(u, "user")}>remove</button>
                    : <button className="link-inline small" onClick={() => setRole(u, "admin")}>make admin</button>)}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="actions">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button>
            <span className="muted small">Page {page + 1} of {pages}</span>
            <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        )}
        <p className="muted small">Admins listed in <code>ADMIN_EMAILS</code> on the server stay admins whatever their stored role.</p>
      </div>
    </div>
  );
}
