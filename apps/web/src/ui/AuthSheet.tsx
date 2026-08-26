import { useState } from "react";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { API_BASE } from "../lib/api";

export function AuthSheet() {
  const store = getMapStore();
  const session = useMapStoreSnapshot((s) => s.session);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const desktop = typeof window !== "undefined" && window.innerWidth >= 900;

  const submit = async () => {
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const body =
        mode === "login"
          ? { email, password }
          : { email, password, displayName: displayName || email.split("@")[0] };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Chyba přihlášení");
      }

      const data = await res.json();
      store.setSession(data.user);
      store.showToast(`Vítej, ${data.user.displayName}!`);
      store.closeSheet();
    } catch (err) {
      store.showToast(err instanceof Error ? err.message : "Chyba");
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
    store.setSession(null);
    store.showToast("Odhlášeno");
    store.closeSheet();
  };

  return (
    <>
      <div className="overlay" onClick={() => store.closeSheet()} />
      <div className={`panel ${desktop ? "dialog" : "sheet"}`} data-testid="auth-sheet">
        {!desktop && <div className="panel-handle" />}
        <div className="panel-header">
          <h2>{session ? "Profil" : mode === "login" ? "Přihlášení" : "Registrace"}</h2>
          <button className="btn btn-ghost" onClick={() => store.closeSheet()}>
            ✕
          </button>
        </div>
        <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {session ? (
            <>
              <p>
                {session.displayName}
                <br />
                <span className="meta">{session.email}</span>
              </p>
              <button className="btn btn-accent" onClick={logout}>
                Odhlásit
              </button>
            </>
          ) : (
            <>
              {mode === "register" && (
                <input
                  placeholder="Jméno"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              )}
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="auth-email"
              />
              <input
                type="password"
                placeholder="Heslo"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="auth-password"
              />
              <button
                className="btn btn-accent"
                onClick={submit}
                disabled={loading}
                data-testid="auth-submit"
              >
                {loading ? "…" : mode === "login" ? "Přihlásit" : "Registrovat"}
              </button>
              <button
                className="btn"
                onClick={() => setMode(mode === "login" ? "register" : "login")}
              >
                {mode === "login" ? "Nemám účet" : "Mám účet"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
