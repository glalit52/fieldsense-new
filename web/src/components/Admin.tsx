import { useEffect, useState } from "react";
import { api, type AdminUser, type User } from "../lib/api.ts";
import { useDateFormat, useT } from "../lib/i18n.tsx";

/** Usage overview and user roles. Visible to admins only (role "admin" or listed in ADMIN_EMAILS on the server). */
export default function Admin({ me }: { me: User }) {
  const t = useT(), fmt = useDateFormat();
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [list, setList] = useState<{ total: number; page: number; limit: number; users: AdminUser[] } | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => { api.adminStats().then(setStats).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    const timer = setTimeout(() => api.adminUsers(q, page).then(setList).catch((e) => setError(e.message)), q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [q, page]);

  const setRole = async (u: AdminUser, role: "user" | "admin") => {
    if (!confirm(t(role === "admin" ? "Make {email} an admin?" : "Remove {email} as admin?", { email: u.email }))) return;
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
        {stat(t("Users"), stats?.users, stats ? t("+{week} this week · +{month} in 30 days", { week: stats.users7d, month: stats.users30d }) : undefined)}
        {stat(t("Active this week"), stats?.active7d, t("signed in within 7 days"))}
        {stat(t("Saved fields"), stats?.fields)}
        {stat(t("Lab tests"), stats?.tests)}
        {stat(t("Journal entries"), stats?.activities)}
      </div>
      <div className="card wide">
        <h3>{t("Users")} {list && <span className="muted small">{list.total}</span>}</h3>
        <div className="toolbar">
          <input type="search" aria-label={t("Search users")} placeholder={t("Search name, email, organisation…")} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="table-scroll">
          <table className="ops">
            <thead><tr><th>{t("Name")}</th><th>{t("Email")}</th><th>{t("Organisation")}</th><th>{t("Fields")}</th><th>{t("Joined")}</th><th>{t("Last sign-in")}</th><th>{t("Role")}</th></tr></thead>
            <tbody>{list?.users.map((u) => (
              <tr key={u.id}>
                <td><b>{u.name}</b></td>
                <td>{u.email}</td>
                <td>{u.organization || "–"}</td>
                <td>{u.fields}</td>
                <td className="small">{fmt(u.createdAt, {})}</td>
                <td className="small">{u.lastLogin ? new Date(u.lastLogin).toLocaleString() : "–"}</td>
                <td>
                  {u.role === "admin" ? <span className="tag good">{t("admin")}</span> : <span className="tag">{t("user")}</span>}{" "}
                  {u.id !== me.id && (u.role === "admin"
                    ? <button className="link-inline small" onClick={() => setRole(u, "user")}>{t("remove")}</button>
                    : <button className="link-inline small" onClick={() => setRole(u, "admin")}>{t("make admin")}</button>)}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="actions">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>← {t("Previous")}</button>
            <span className="muted small">{t("Page {n} of {total}", { n: page + 1, total: pages })}</span>
            <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t("Next")} →</button>
          </div>
        )}
        <p className="muted small">{(() => { const [pre, post] = t("Admins listed in {var} on the server stay admins whatever their stored role.").split("{var}"); return <>{pre}<code>ADMIN_EMAILS</code>{post}</>; })()}</p>
      </div>
    </div>
  );
}
