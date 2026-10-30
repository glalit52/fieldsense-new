import { useState, type FormEvent } from "react";
import { api, type User } from "../lib/api.ts";
import { useT } from "../lib/i18n.tsx";

interface AuthPageProps {
  initialMode?: "login" | "signup";
  contact?: string;
  /** Shown above the form, e.g. why the user was signed out. */
  notice?: string;
  onSuccess: (user: User) => void;
}

/** Must match PASSWORD_MIN on the server (server/src/models/User.ts). */
const PASSWORD_MIN = 8;
const DEV = Boolean((import.meta as any).env?.DEV);

export default function AuthPage({ initialMode = "login", contact = "lalit@sensegrass.com", notice, onSuccess }: AuthPageProps) {
  const t = useT();
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    organization: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [key]: e.target.value });
    if (error) setError("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);

    try {
      if (mode === "login") {
        if (!form.email || !form.password) {
          setError(t("Please provide both email and password"));
          setBusy(false);
          return;
        }
        const user = await api.login(form.email, form.password);
        onSuccess(user);
      } else {
        if (!form.name.trim() || form.name.trim().length < 2) {
          setError(t("Please enter your full name (at least 2 characters)"));
          setBusy(false);
          return;
        }
        if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
          setError(t("Please enter a valid email address"));
          setBusy(false);
          return;
        }
        if (!form.password || form.password.length < PASSWORD_MIN) {
          setError(t("Password must be at least {n} characters long", { n: PASSWORD_MIN }));
          setBusy(false);
          return;
        }
        const user = await api.signup(form);
        onSuccess(user);
      }
    } catch (err: any) {
      setError(err.message || `${t("Authentication failed.")} ${t("Please check your details.")}`);
    } finally {
      setBusy(false);
    }
  };

  const prefillDemo = () => {
    setForm({
      name: "Senior Agronomist",
      email: "agronomist@sensegrass.com",
      password: "password123",
      organization: "SenseGrass Enterprise",
    });
    setError("");
  };

  return (
    <div className="auth-page-wrapper">
      <div className="auth-ambient-glow" />
      <div className="auth-card-container">
        {/* Brand Header */}
        <div className="auth-brand-header">
          <div className="auth-logo-icon">
            <span>◆</span>
          </div>
          <h1 className="auth-brand-title">FieldSense</h1>
          <p className="auth-brand-tagline">
            {t("Precision soil intelligence, 35-yr agro-climate & satellite monitoring")}
          </p>
        </div>

        {/* Auth Card */}
        <div className="auth-card">
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={`auth-tab-btn ${mode === "login" ? "active" : ""}`}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              {t("Sign In")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={`auth-tab-btn ${mode === "signup" ? "active" : ""}`}
              onClick={() => {
                setMode("signup");
                setError("");
              }}
            >
              {t("Create Account")}
            </button>
          </div>

          {notice && !error && <p className="muted small" role="status">{notice}</p>}

          {error && (
            <div className="auth-error-banner" role="alert">
              <span className="auth-error-icon">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === "signup" && (
              <div className="auth-field">
                <label htmlFor="auth-name">{t("Full Name")}</label>
                <div className="auth-input-group">
                  <span className="auth-input-icon">👤</span>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={100}
                    autoComplete="name"
                    placeholder={t("e.g. {name}", { name: "Lalit Gautam" })}
                    value={form.name}
                    onChange={update("name")}
                  />
                </div>
              </div>
            )}

            <div className="auth-field">
              <label htmlFor="auth-email">{t("Email Address")}</label>
              <div className="auth-input-group">
                <span className="auth-input-icon">✉️</span>
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@sensegrass.com"
                  value={form.email}
                  onChange={update("email")}
                />
              </div>
            </div>

            <div className="auth-field">
              <div className="auth-field-header">
                <label htmlFor="auth-password">{t("Password")}</label>
                {mode === "signup" && <span className="auth-hint">{t("Min {n} characters", { n: PASSWORD_MIN })}</span>}
              </div>
              <div className="auth-input-group">
                <span className="auth-input-icon">🔒</span>
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={mode === "signup" ? PASSWORD_MIN : undefined}
                  maxLength={200}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={update("password")}
                />
                <button
                  type="button"
                  className="auth-pw-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  title={showPassword ? t("Hide password") : t("Show password")}
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            {mode === "signup" && (
              <div className="auth-field">
                <div className="auth-field-header">
                  <label htmlFor="auth-org">{t("Farm or Organisation")}</label>
                  <span className="auth-hint">{t("Optional")}</span>
                </div>
                <div className="auth-input-group">
                  <span className="auth-input-icon">🌾</span>
                  <input
                    id="auth-org"
                    type="text"
                    maxLength={150}
                    autoComplete="organization"
                    placeholder={t("e.g. Green Valley Farm")}
                    value={form.organization}
                    onChange={update("organization")}
                  />
                </div>
              </div>
            )}

            <button type="submit" className="auth-submit-btn" disabled={busy}>
              {busy ? (
                <span className="auth-loading-text">
                  <span className="auth-spinner" /> {t("Verifying...")}
                </span>
              ) : mode === "login" ? (
                t("Sign In to FieldSense")
              ) : (
                t("Create FieldSense Account")
              )}
            </button>
          </form>

          {/* Quick Demo Credentials for Fast Testing (development builds only: the account doesn't exist in production) */}
          {DEV && (
            <div className="auth-demo-shortcut">
              <button type="button" className="auth-demo-btn" onClick={prefillDemo}>
                ⚡ {t("Quick Fill Demo Account")}
              </button>
            </div>
          )}

          <div className="auth-footer-toggle">
            {mode === "login" ? (
              <p>
                {t("Don't have an account yet?")}{" "}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => {
                    setMode("signup");
                    setError("");
                  }}
                >
                  {t("Create one now")}
                </button>
              </p>
            ) : (
              <p>
                {t("Already have an account?")}{" "}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => {
                    setMode("login");
                    setError("");
                  }}
                >
                  {t("Sign in")}
                </button>
              </p>
            )}
          </div>
        </div>

        <div className="auth-page-footer">
          <span>{t("Powered by SenseGrass Inc. · Enterprise Agricultural Intelligence")}</span>
          <a href={`mailto:${contact}`} className="auth-support-link">
            {t("Need support?")} {contact}
          </a>
        </div>
      </div>
    </div>
  );
}
