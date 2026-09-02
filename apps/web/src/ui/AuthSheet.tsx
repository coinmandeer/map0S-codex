import { useEffect, useState } from "react";
import { getMapStore, type UserSession } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { apiGet, apiPost, apiSend } from "../lib/api";
import {
  injectedEthereum,
  linkInjectedWallet,
  type PublicAavegotchiInventory,
  type PublicIdentityLink
} from "../lib/linkedIdentity";

export function AuthSheet() {
  const store = getMapStore();
  const session = useMapStoreSnapshot((s) => s.session);
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<"login" | "register">(session?.isGuest ? "register" : "login");
  const [loading, setLoading] = useState(false);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identities, setIdentities] = useState<PublicIdentityLink[]>([]);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<{
    identityId: string;
    value: PublicAavegotchiInventory;
  } | null>(null);
  const [dataRightsBusy, setDataRightsBusy] = useState(false);
  const [dataRightsMessage, setDataRightsMessage] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const desktop = typeof window !== "undefined" && window.innerWidth >= 900;
  const registeredSession = session && !session.isGuest ? session : null;
  const sessionId = session?.id;

  const reloadIdentities = async () => {
    if (!sessionId) {
      setIdentities([]);
      return;
    }
    const data = await apiGet<{ identities: PublicIdentityLink[] }>("/v2/me/identities", {
      auth: true
    });
    setIdentities(data.identities);
  };

  useEffect(() => {
    let current = true;
    if (!sessionId) {
      setIdentities([]);
      return;
    }
    setIdentityLoading(true);
    void apiGet<{ identities: PublicIdentityLink[] }>("/v2/me/identities", { auth: true })
      .then((data) => {
        if (current) setIdentities(data.identities);
      })
      .catch(() => {
        if (current) setIdentities([]);
      })
      .finally(() => {
        if (current) setIdentityLoading(false);
      });
    return () => {
      current = false;
    };
  }, [sessionId]);

  const submit = async () => {
    setLoading(true);
    try {
      const endpoint =
        mode === "login" ? "/auth/login" : session?.isGuest ? "/auth/upgrade" : "/auth/register";
      const body =
        mode === "login"
          ? { email, password }
          : { email, password, displayName: displayName || email.split("@")[0] };

      const data = await apiPost<{ user: UserSession }>(endpoint, body);
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
    await apiPost("/auth/logout");
    const fresh = await apiPost<{ user: UserSession }>("/auth/guest");
    store.setSession(fresh.user);
    store.showToast("Odhlášeno");
    store.closeSheet();
  };

  const connectWallet = async () => {
    const provider = injectedEthereum(window);
    if (!provider) {
      setIdentityError("V prohlížeči není dostupná kompatibilní peněženka.");
      return;
    }
    setIdentityLoading(true);
    setIdentityError(null);
    try {
      await linkInjectedWallet(provider);
      await reloadIdentities();
      store.showToast("Peněženka je připojená ke stejnému MapOS profilu");
    } catch (error) {
      setIdentityError(
        error instanceof Error ? error.message : "Peněženku se nepodařilo připojit."
      );
    } finally {
      setIdentityLoading(false);
    }
  };

  const connectSimulation = async () => {
    setIdentityLoading(true);
    setIdentityError(null);
    try {
      await apiPost("/v2/auth/simulation/link", { label: "Testovací peněženka" });
      await reloadIdentities();
      store.showToast("Zapnutá testovací identita — nejde o skutečnou peněženku");
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : "Testovací identita selhala.");
    } finally {
      setIdentityLoading(false);
    }
  };

  const revokeIdentity = async (identity: PublicIdentityLink) => {
    if (
      !window.confirm(`Odpojit ${identity.displayLabel ?? identity.subject}? MapOS data zůstanou.`)
    ) {
      return;
    }
    setIdentityLoading(true);
    setIdentityError(null);
    try {
      await apiSend("DELETE", `/v2/me/identities/${encodeURIComponent(identity.id)}`);
      await reloadIdentities();
      setInventory((current) => (current?.identityId === identity.id ? null : current));
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : "Identitu se nepodařilo odpojit.");
    } finally {
      setIdentityLoading(false);
    }
  };

  const loadInventory = async (identity: PublicIdentityLink) => {
    setIdentityLoading(true);
    setIdentityError(null);
    try {
      const data = await apiGet<{ inventory: PublicAavegotchiInventory }>(
        "/v2/me/aavegotchi-inventory",
        { auth: true, query: { identityId: identity.id } }
      );
      setInventory({ identityId: identity.id, value: data.inventory });
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : "Inventář se nepodařilo načíst.");
    } finally {
      setIdentityLoading(false);
    }
  };

  const downloadAccountArchive = async () => {
    setDataRightsBusy(true);
    setDataRightsMessage(null);
    try {
      const archive = await apiGet<Record<string, unknown>>("/v2/me/export", { auth: true });
      const url = URL.createObjectURL(
        new Blob([`${JSON.stringify(archive, null, 2)}\n`], { type: "application/json" })
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "mapos-account-export.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setDataRightsMessage("Archiv účtu je připravený ke stažení.");
    } catch (error) {
      setDataRightsMessage(
        error instanceof Error ? error.message : "Archiv se nepodařilo vytvořit."
      );
    } finally {
      setDataRightsBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirmation !== "DELETE MY ACCOUNT") return;
    setDataRightsBusy(true);
    setDataRightsMessage(null);
    try {
      const result = await apiSend<{ status: "deleted" | "deleted-with-retention" }>(
        "DELETE",
        "/v2/me",
        { confirmation: deleteConfirmation }
      );
      setIdentities([]);
      setInventory(null);
      store.setSession(null);
      store.showToast(
        result.status === "deleted-with-retention"
          ? "Účet byl smazán; zákonné finanční záznamy zůstaly anonymizované."
          : "Účet a jeho data byly smazány."
      );
      store.closeSheet();
    } catch (error) {
      setDataRightsMessage(error instanceof Error ? error.message : "Účet se nepodařilo smazat.");
    } finally {
      setDataRightsBusy(false);
    }
  };

  return (
    <>
      <div className="overlay" onClick={() => store.closeSheet()} />
      <div className={`panel ${desktop ? "dialog" : "sheet"}`} data-testid="auth-sheet">
        {!desktop && <div className="panel-handle" />}
        <div className="panel-header">
          <h2>
            {registeredSession
              ? "Profil"
              : mode === "login"
                ? "Přihlášení"
                : session?.isGuest
                  ? "Uložit profil"
                  : "Registrace"}
          </h2>
          <button className="btn btn-ghost" onClick={() => store.closeSheet()}>
            ✕
          </button>
        </div>
        <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {registeredSession ? (
            <>
              <p>
                {registeredSession.displayName}
                <br />
                <span className="meta">{registeredSession.email}</span>
              </p>
              <button className="btn btn-accent" onClick={logout}>
                Odhlásit
              </button>
            </>
          ) : (
            <>
              {session?.isGuest && mode === "register" && (
                <p className="meta">
                  Piny, XP a postup z profilu {session.displayName} zůstanou zachované. Přidáš mu
                  jen jméno, e-mail a heslo.
                </p>
              )}
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
                {loading
                  ? "…"
                  : mode === "login"
                    ? "Přihlásit"
                    : session?.isGuest
                      ? "Uložit účet"
                      : "Registrovat"}
              </button>
              <button
                className="btn"
                onClick={() => setMode(mode === "login" ? "register" : "login")}
              >
                {mode === "login"
                  ? session?.isGuest
                    ? "Uložit současný profil"
                    : "Nemám účet"
                  : "Už účet mám"}
              </button>
            </>
          )}

          {session && (
            <section className="auth-identities" aria-labelledby="linked-identities-title">
              <div>
                <h3 id="linked-identities-title">Připojené identity</h3>
                <p className="meta">
                  Peněženka se přidá k tomuto profilu. Nevytvoří nový účet a odpojení nesmaže piny,
                  plány ani herní postup.
                </p>
              </div>

              <div className="auth-identity-actions">
                {capabilities?.siwe === true && (
                  <button className="btn" disabled={identityLoading} onClick={connectWallet}>
                    Připojit peněženku
                  </button>
                )}
                {capabilities?.identitySimulation === true && (
                  <button className="btn" disabled={identityLoading} onClick={connectSimulation}>
                    Testovací přihlášení <span className="badge">SIMULACE</span>
                  </button>
                )}
              </div>

              {capabilities && !capabilities.siwe && !capabilities.identitySimulation && (
                <p className="meta">Připojení peněženky není v tomto nasazení zapnuté.</p>
              )}
              {identityError && <p className="source-notice error">{identityError}</p>}
              {identityLoading && <p className="meta">Ověřuji identitu…</p>}

              <div className="auth-identity-list">
                {identities.map((identity) => (
                  <article
                    className={`auth-identity-row ${identity.revokedAt ? "is-revoked" : ""}`}
                    key={identity.id}
                  >
                    <div>
                      <strong>
                        {identity.type === "email"
                          ? "E-mailový účet"
                          : identity.simulated
                            ? "Testovací peněženka"
                            : "Peněženka"}
                      </strong>
                      {identity.simulated && <span className="badge">SIMULACE</span>}
                      <div className="meta auth-identity-subject">
                        {identity.displayMetadata?.name ??
                          identity.displayLabel ??
                          identity.subject}
                      </div>
                      {identity.displayMetadata?.source === "ens" && (
                        <div className="meta">ENS · pouze zobrazovací metadata</div>
                      )}
                      {identity.type === "email" && !identity.verifiedAt && (
                        <div className="meta">E-mail zatím není samostatně ověřený.</div>
                      )}
                      {identity.revokedAt && <div className="meta">Odpojeno</div>}
                    </div>
                    {!identity.revokedAt && identity.type !== "email" && (
                      <div className="auth-identity-row-actions">
                        <button className="btn small" onClick={() => void loadInventory(identity)}>
                          Inventář
                        </button>
                        <button className="btn small" onClick={() => void revokeIdentity(identity)}>
                          Odpojit
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>

              {inventory && (
                <div className="auth-inventory" role="status">
                  <strong>
                    Inventář {inventory.value.sourceMode === "simulation" ? "· SIMULACE" : ""}
                  </strong>
                  <p className="meta">{inventory.value.notice}</p>
                  {inventory.value.status === "available" && inventory.value.items?.length ? (
                    <ul>
                      {inventory.value.items.map((item) => (
                        <li key={item.tokenId}>{item.name ?? `Gotchi #${item.tokenId}`}</li>
                      ))}
                    </ul>
                  ) : inventory.value.status === "available" ? (
                    <p className="meta">V testovacím inventáři nejsou žádné položky.</p>
                  ) : null}
                </div>
              )}

              <details className="auth-data-rights" data-testid="account-data-rights">
                <summary>Export a smazání dat</summary>
                <p className="meta">
                  Nejdřív si můžeš stáhnout přenositelný archiv. Smazání odstraní mapová, osobní,
                  plánovací, sociální a herní data; zákonem vyžadované finanční záznamy mohou zůstat
                  jen pseudonymizované.
                </p>
                <button
                  className="btn"
                  type="button"
                  disabled={dataRightsBusy}
                  data-testid="account-export"
                  onClick={() => void downloadAccountArchive()}
                >
                  Stáhnout archiv účtu
                </button>
                <label className="planner-field">
                  <span>Pro nevratné smazání napiš DELETE MY ACCOUNT</span>
                  <input
                    value={deleteConfirmation}
                    autoComplete="off"
                    spellCheck={false}
                    data-testid="account-delete-confirmation"
                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                  />
                </label>
                <button
                  className="btn"
                  type="button"
                  disabled={dataRightsBusy || deleteConfirmation !== "DELETE MY ACCOUNT"}
                  data-testid="account-delete"
                  onClick={() => void deleteAccount()}
                >
                  Nevratně smazat účet
                </button>
                {dataRightsMessage && (
                  <p className="meta" role="status">
                    {dataRightsMessage}
                  </p>
                )}
              </details>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
