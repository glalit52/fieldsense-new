import { useState, type FormEvent, type ReactNode } from "react";
import { api, type User } from "../lib/api.ts";
import { useDateFormat, useT } from "../lib/i18n.tsx";

/** Runs a form action with busy and result state. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<string>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (err: any) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  };
  const note: ReactNode = msg && <p className={msg.ok ? "ok-text small" : "form-error"} role="status">{msg.text}</p>;
  return { busy, run, note };
}

export default function Account({ user, onUser, onSignedOut }: { user: User; onUser: (u: User) => void; onSignedOut: () => void }) {
  const t = useT(), fmt = useDateFormat();
  const [profile, setProfile] = useState({ name: user.name, organization: user.organization });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [delPw, setDelPw] = useState("");
  const p = useAction(), c = useAction(), d = useAction();

  return (
    <div className="grid">
      <div className="card">
        <h2>{t("Profile")}</h2>
        <p className="muted small">{user.email} · {t("member since {date}", { date: fmt(user.createdAt, {}) })}</p>
        <form className="stack" onSubmit={p.run(async () => { onUser(await api.updateProfile(profile)); return t("Saved"); })}>
          <label>{t("Name")} <input required minLength={2} maxLength={100} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label>
          <label>{t("Farm or organisation")} <input maxLength={150} value={profile.organization} onChange={(e) => setProfile({ ...profile, organization: e.target.value })} /></label>
          {p.note}
          <button className="primary" disabled={p.busy}>{t("Save profile")}</button>
        </form>
      </div>

      <div className="card">
        <h2>{t("Change password")}</h2>
        <p className="muted small">{t("Other devices are signed out when you change it.")}</p>
        <form className="stack" onSubmit={c.run(async () => { await api.changePassword(pw.current, pw.next); setPw({ current: "", next: "" }); return t("Password changed"); })}>
          <label>{t("Current password")} <input required type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label>{t("New password")} <input required type="password" minLength={8} maxLength={200} autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
          {c.note}
          <button className="primary" disabled={c.busy}>{t("Change password")}</button>
        </form>
      </div>

      <div className="card">
        <h2>{t("Sign out")}</h2>
        <p className="muted small">{t("Your saved fields stay in your account.")}</p>
        <button onClick={async () => { await api.logout().catch(() => {}); onSignedOut(); }}>{t("Sign out")}</button>
      </div>

      <div className="card danger-zone">
        <h2>{t("Delete account")}</h2>
        <p className="muted small">{t("Permanently deletes your account, all saved fields and lab tests.")} {t("This cannot be undone.")}</p>
        <form className="stack" onSubmit={d.run(async () => {
          if (!confirm(`${t("Delete your account and every saved field?")} ${t("This cannot be undone.")}`)) return t("Cancelled");
          await api.deleteAccount(delPw);
          onSignedOut();
          return t("Account deleted");
        })}>
          <label>{t("Confirm with your password")} <input required type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} /></label>
          {d.note}
          <button className="danger" disabled={d.busy}>{t("Delete my account")}</button>
        </form>
      </div>
    </div>
  );
}
