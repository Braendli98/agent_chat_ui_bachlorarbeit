import { useQueryState } from "nuqs";

// Liefert die Basis-URL des Trusted Proxy nach derselben Regel wie
// providers/Stream.tsx und providers/Thread.tsx: der URL-Parameter `?apiUrl`
// gewinnt, sonst greift NEXT_PUBLIC_API_URL.
//
// Eigener Hook statt Erweiterung von StreamContext: dessen Wert IST aktuell
// exakt der useStream-Rückgabewert (Stream.tsx:47). Ihn zu wrappen, nur um eine
// URL durchzureichen, würde alle useStreamContext()-Aufrufstellen betreffen.
export function useApiUrl(): string {
  const [apiUrl] = useQueryState("apiUrl", {
    defaultValue: process.env.NEXT_PUBLIC_API_URL || "",
  });

  return apiUrl;
}
