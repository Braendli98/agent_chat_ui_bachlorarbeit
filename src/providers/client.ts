import { Client } from "@langchain/langgraph-sdk";

export function createClient(
  apiUrl: string,
  apiKey: string | undefined,
  authScheme: string | undefined,
  sessionToken?: string | null,
) {
  // Header-Merge analog zu Stream.tsx: X-Auth-Scheme (LangSmith/Agent-Builder)
  // und Authentication (unser Trusted-Proxy-Bearer) können gemeinsam gesetzt
  // sein. Ohne den Bearer würde z.B. threads.search am Proxy 401 liefern.
  const defaultHeaders: Record<string, string> = {};
  if (authScheme) defaultHeaders["X-Auth-Scheme"] = authScheme;
  if (sessionToken) defaultHeaders["Authentication"] = `Bearer ${sessionToken}`;

  return new Client({
    apiKey,
    apiUrl,
    ...(Object.keys(defaultHeaders).length > 0 && { defaultHeaders }),
  });
}
