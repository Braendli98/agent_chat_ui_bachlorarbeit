// Hält den vom Trusted Proxy ausgestellten Access-Token (Bearer-Token für
// die SDK-Endpunkte, siehe proxy_mock.py `_session_aus_bearer_oder_cookie`).
//
// ANDERS ALS api-key.tsx (LangSmith-API-Key, vom Nutzer manuell eingegeben,
// langlebig in localStorage): dieser Token kommt automatisch per
// URL-Redirect vom Login-Flow (`/session/start` → Redirect mit
// `?threadId=...&token=...`) und ist an eine Session mit 24h-TTL gebunden
// (proxy_sessions-Tabelle). sessionStorage statt localStorage, weil der
// Token beim Schließen des Tabs ohnehin ungültig werden soll — passt zur
// Lebensdauer der Session besser als dauerhafte Speicherung.

const STORAGE_KEY = "lg:chat:sessionToken";

export function getSessionToken(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(STORAGE_KEY) ?? null;
  } catch {
    // no-op — z.B. sessionStorage deaktiviert (privater Modus o.ä.)
  }
  return null;
}

export function setSessionToken(token: string): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // no-op
  }
}

export function clearSessionToken(): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
