// Lädt die vom Backend erzeugte Studienplan-Excel über den Trusted Proxy.
//
// WARUM NICHT einfach <a href="...">: Der Proxy authentifiziert über den
// Custom-Header `Authentication: Bearer <token>` (nicht `Authorization`, siehe
// providers/client.ts). Ein Browser-Navigations-Download kann keine eigenen
// Header mitschicken — deshalb der Umweg über fetch → Blob → Object-URL →
// synthetischer <a download>.
//
// Dateiname: primär aus dem `Content-Disposition`-Header der Antwort (der Proxy
// gibt ihn per Access-Control-Expose-Headers frei), ersatzweise aus
// `values.excel_dateiname`. Der Header ist maßgeblich, weil ihn der Endpunkt
// beim Ausliefern der Datei setzt — der State-Wert ist nur der Auslöser dafür,
// dass es überhaupt etwas herunterzuladen gibt.

import { getSessionToken } from "@/lib/session-token";

// Trägt den Erklärtext des Servers (z.B. beim 404 nach dem 24h-Cleanup), damit
// die UI ihn anzeigen kann, statt ein generisches „Download fehlgeschlagen".
export class ExcelDownloadError extends Error {
  readonly status: number;
  readonly vomServer: boolean;

  constructor(message: string, status: number, vomServer: boolean) {
    super(message);
    this.name = "ExcelDownloadError";
    this.status = status;
    this.vomServer = vomServer;
  }
}

export async function downloadExcel(
  apiUrl: string,
  threadId: string,
  dateiname: string,
): Promise<void> {
  const headers = new Headers();
  const token = getSessionToken();
  if (token) headers.set("Authentication", `Bearer ${token}`);

  const res = await fetch(
    `${apiUrl}/threads/${encodeURIComponent(threadId)}/excel`,
    { headers },
  );

  if (!res.ok) {
    const servertext = await fehlertextLesen(res);
    throw new ExcelDownloadError(
      servertext ?? `HTTP ${res.status}`,
      res.status,
      servertext != null,
    );
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = objectUrl;
  a.download =
    dateinameAusContentDisposition(res.headers.get("content-disposition")) ??
    dateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Verzögert freigeben: ein sofortiges revoke direkt nach click() bricht den
  // Download in manchen Browsern ab, bevor er begonnen hat.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

// `attachment; filename="plan.xlsx"` bzw. RFC 5987 `filename*=UTF-8''plan.xlsx`
// (letzteres nutzt FastAPI bei Nicht-ASCII-Namen). Gibt null zurück, wenn der
// Header fehlt — etwa wenn er doch nicht per CORS freigegeben ist.
export function dateinameAusContentDisposition(
  header: string | null,
): string | null {
  if (!header) return null;

  const erweitert = header.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i);
  if (erweitert) {
    try {
      const wert = decodeURIComponent(erweitert[1].trim());
      if (wert) return wert;
    } catch {
      // kaputtes Percent-Encoding → auf die einfache Form zurückfallen
    }
  }

  const einfach = header.match(/filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i);
  const wert = (einfach?.[1] ?? einfach?.[2])?.trim();
  return wert ? wert : null;
}

// Der Proxy erklärt Fehler im Body (FastAPI: {"detail": "..."}), z.B. warum die
// Datei nach 24h nicht mehr da ist. Diesen Text zeigen wir dem Studierenden.
async function fehlertextLesen(res: Response): Promise<string | null> {
  let roh: string;
  try {
    roh = (await res.text()).trim();
  } catch {
    return null;
  }
  if (!roh) return null;

  try {
    const json = JSON.parse(roh);
    for (const feld of [json?.detail, json?.message, json?.error]) {
      if (typeof feld === "string" && feld.trim()) return feld.trim();
    }
    return null;
  } catch {
    // Kein JSON. Nur echten Fließtext übernehmen — eine HTML-Fehlerseite (etwa
    // von einem Reverse Proxy) wäre für den Studierenden unbrauchbar.
    if (roh.startsWith("<") || roh.length > 300) return null;
    return roh;
  }
}
