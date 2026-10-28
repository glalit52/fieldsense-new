import { useState, type FormEvent } from "react";
import { api, type User } from "../lib/api.ts";

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
          setError("Please provide both email and password");
          setBusy(false);
          return;
        }
        const user = await api.login(form.email, form.password);
        onSuccess(user);
      } else {
        if (!form.name.trim() || form.name.trim().length < 2) {
          setError("Please enter your full name (at least 2 characters)");
          setBusy(false);
          return;
        }
        if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
          setError("Please enter a valid email address");
          setBusy(false);
          return;
        }
        if (!form.password || form.password.length < PASSWORD_MIN) {
          setError(`Password must be at least ${PASSWORD_MIN} characters long`);
          setBusy(false);
          return;
        }
        const user = await api.signup(form);
        onSuccess(user);
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed. Please check your details.");
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
            Precision soil intelligence, 35-yr agro-climate & satellite monitoring
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
              Sign In
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
              Create Account
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
                <label htmlFor="auth-name">Full Name</label>
                <div className="auth-input-group">
                  <span className="auth-input-icon">👤</span>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={100}
                    autoComplete="name"
                    placeholder="e.g. Lalit Gautam"
                    value={form.name}
                    onChange={update("name")}
                  />
                </div>
              </div>
            )}

            <div className="auth-field">
              <label htmlFor="auth-email">Email Address</label>
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
                <label htmlFor="auth-password">Password</label>
                {mode === "signup" && <span className="auth-hint">Min {PASSWORD_MIN} characters</span>}
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
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            {mode === "signup" && (
              <div className="auth-field">
                <div className="auth-field-header">
                  <label htmlFor="auth-org">Farm or Organisation</label>
                  <span className="auth-hint">Optional</span>
                </div>
                <div className="auth-input-group">
                  <span className="auth-input-icon">🌾</span>
                  <input
                    id="auth-org"
                    type="text"
                    maxLength={150}
                    autoComplete="organization"
                    placeholder="e.g. Green Valley Farm"
                    value={form.organization}
                    onChange={update("organization")}
                  />
                </div>
              </div>
            )}

            <button type="submit" className="auth-submit-btn" disabled={busy}>
              {busy ? (
                <span className="auth-loading-text">
                  <span className="auth-spinner" /> Verifying...
                </span>
              ) : mode === "login" ? (
                "Sign In to FieldSense"
              ) : (
                "Create FieldSense Account"
              )}
            </button>
          </form>

          {/* Quick Demo Credentials for Fast Testing (development builds only: the account doesn't exist in production) */}
          {DEV && (
            <div className="auth-demo-shortcut">
              <button type="button" className="auth-demo-btn" onClick={prefillDemo}>
                ⚡ Quick Fill Demo Account
              </button>
            </div>
          )}

          <div className="auth-footer-toggle">
            {mode === "login" ? (
              <p>
                Don't have an account yet?{" "}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => {
                    setMode("signup");
                    setError("");
                  }}
                >
                  Create one now
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{" "}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => {
                    setMode("login");
                    setError("");
                  }}
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>

        <div className="auth-page-footer">
          <span>Powered by SenseGrass Inc. · Enterprise Agricultural Intelligence</span>
          <a href={`mailto:${contact}`} className="auth-support-link">
            Need support? {contact}
          </a>
        </div>
      </div>
    </div>
  );
}
