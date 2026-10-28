import { useState, type FormEvent } from "react";
import { api, type User } from "../lib/api.ts";
import Modal from "./Modal.tsx";

export default function AuthDialog({ reason, onDone, onClose }: { reason?: string; onDone: (u: User) => void; onClose: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", organization: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      onDone(mode === "login" ? await api.login(form.email, form.password) : await api.signup(form));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={mode === "login" ? "Sign in" : "Create your account"} onClose={onClose}>
      {reason && <p className="muted">{reason}</p>}
      <form className="stack" onSubmit={submit}>
        {mode === "signup" && (
          <label>Name <input required minLength={2} maxLength={100} autoComplete="name" value={form.name} onChange={set("name")} /></label>
        )}
        <label>Email <input required type="email" autoComplete="email" value={form.email} onChange={set("email")} /></label>
        <label>Password
          <input required type="password" minLength={mode === "signup" ? 8 : undefined} maxLength={200}
            autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={set("password")} />
          {mode === "signup" && <span className="muted small">At least 8 characters</span>}
        </label>
        {mode === "signup" && (
          <label>Farm or organisation <span className="muted small">(optional)</span>
            <input maxLength={150} autoComplete="organization" value={form.organization} onChange={set("organization")} /></label>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary big" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
      </form>
      <p className="muted small switch">
        {mode === "login" ? "New to FieldSense? " : "Already have an account? "}
        <button type="button" className="link-inline" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>
          {mode === "login" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </Modal>
  );
}
