import React, {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
} from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { type Message } from "@langchain/langgraph-sdk";
import {
  uiMessageReducer,
  isUIMessage,
  isRemoveUIMessage,
  type UIMessage,
  type RemoveUIMessage,
} from "@langchain/langgraph-sdk/react-ui";
import { useQueryState } from "nuqs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LangGraphLogoSVG } from "@/components/icons/langgraph";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { getApiKey } from "@/lib/api-key";
import {
  getSessionToken,
  setSessionToken,
} from "@/lib/session-token";
import { useThreads } from "./Thread";
import { toast } from "sonner";

export type StateType = {
  messages: Message[];
  ui?: UIMessage[];
  // Nur der Dateiname (z.B. "studienplan_ws25.xlsx"), KEIN Serverpfad — der
  // frühere Pfad im Nachrichtentext war für Studierende ohnehin nicht öffenbar.
  // Ist das Feld gesetzt, rendert der Chatverlauf eine Download-Karte, die die
  // Datei über GET /threads/{threadId}/excel holt (siehe lib/excel-download.ts).
  excel_dateiname?: string;
};

const useTypedStream = useStream<
  StateType,
  {
    UpdateType: {
      messages?: Message[] | Message | string;
      ui?: (UIMessage | RemoveUIMessage)[] | UIMessage | RemoveUIMessage;
      context?: Record<string, unknown>;
    };
    CustomEventType: UIMessage | RemoveUIMessage;
  }
>;

type StreamContextType = ReturnType<typeof useTypedStream>;
const StreamContext = createContext<StreamContextType | undefined>(undefined);

async function sleep(ms = 4000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkGraphStatus(
  apiUrl: string,
  apiKey: string | null,
  authScheme?: string,
): Promise<boolean> {
  try {
    const headers = new Headers();
    if (apiKey) headers.set("X-Api-Key", apiKey);
    if (authScheme) headers.set("X-Auth-Scheme", authScheme);

    const res = await fetch(`${apiUrl}/info`, {
      headers,
    });

    return res.ok;
  } catch (e) {
    console.error(e);
    return false;
  }
}

const StreamSession = ({
  children,
  apiKey,
  apiUrl,
  assistantId,
  authScheme,
  sessionToken,
}: {
  children: ReactNode;
  apiKey: string | null;
  apiUrl: string;
  assistantId: string;
  authScheme?: string;
  sessionToken?: string | null;
}) => {
  const [threadId, setThreadId] = useQueryState("threadId");
  const { getThreads, setThreads } = useThreads();
  // Header-Merge: X-Auth-Scheme (bestehender LangSmith/Agent-Builder-Weg)
  // und Authentication (unser eigener Bearer-Token vom Trusted Proxy)
  // können grundsätzlich gleichzeitig gesetzt sein — beide landen in
  // EINEM defaultHeaders-Objekt statt in zwei separaten bedingten Spreads,
  // sonst würde der zweite den ersten überschreiben statt zu ergänzen.
  const defaultHeaders: Record<string, string> = {};
  if (authScheme) defaultHeaders["X-Auth-Scheme"] = authScheme;
  if (sessionToken) defaultHeaders["Authentication"] = `Bearer ${sessionToken}`;

  const streamValue = useTypedStream({
    apiUrl,
    apiKey: apiKey ?? undefined,
    assistantId,
    ...(Object.keys(defaultHeaders).length > 0 && { defaultHeaders }),
    threadId: threadId ?? null,
    fetchStateHistory: true,
    onCustomEvent: (event, options) => {
      if (isUIMessage(event) || isRemoveUIMessage(event)) {
        options.mutate((prev) => {
          const ui = uiMessageReducer(prev.ui ?? [], event);
          return { ...prev, ui };
        });
      }
    },
    onThreadId: (id) => {
      setThreadId(id);
      // Refetch threads list when thread ID changes.
      // Wait for some seconds before fetching so we're able to get the new thread that was created.
      sleep().then(() => getThreads().then(setThreads).catch(console.error));
    },
  });

  useEffect(() => {
    checkGraphStatus(apiUrl, apiKey, authScheme).then((ok) => {
      if (!ok) {
        toast.error("Failed to connect to LangGraph server", {
          description: () => (
            <p>
              Please ensure your graph is running at <code>{apiUrl}</code> and
              your API key is correctly set (if connecting to a deployed graph).
            </p>
          ),
          duration: 10000,
          richColors: true,
          closeButton: true,
        });
      }
    });
  }, [apiKey, apiUrl, authScheme]);

  return (
    <StreamContext.Provider value={streamValue}>
      {children}
    </StreamContext.Provider>
  );
};

// Default values for the form
const DEFAULT_API_URL = "http://localhost:2024";
const DEFAULT_ASSISTANT_ID = "agent";
const AGENT_BUILDER_AUTH_SCHEME = "langsmith-api-key";

export const StreamProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  // Get environment variables
  const envApiUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL;
  const envAssistantId: string | undefined =
    process.env.NEXT_PUBLIC_ASSISTANT_ID;
  const envAuthScheme: string | undefined = process.env.NEXT_PUBLIC_AUTH_SCHEME;

  // Use URL params with env var fallbacks
  const [apiUrl, setApiUrl] = useQueryState("apiUrl", {
    defaultValue: envApiUrl || "",
  });
  const [assistantId, setAssistantId] = useQueryState("assistantId", {
    defaultValue: envAssistantId || "",
  });
  const [authScheme, setAuthScheme] = useQueryState("authScheme", {
    defaultValue: envAuthScheme || "",
  });
  const [isAgentBuilder, setIsAgentBuilder] = useState(
    () =>
      (authScheme || envAuthScheme || "").toLowerCase() ===
      AGENT_BUILDER_AUTH_SCHEME,
  );

  // For API key, use localStorage with env var fallback
  const [apiKey, _setApiKey] = useState(() => {
    const storedKey = getApiKey();
    return storedKey || "";
  });

  const setApiKey = (key: string) => {
    window.localStorage.setItem("lg:chat:apiKey", key);
    _setApiKey(key);
  };

  // ── Access-Token vom Trusted Proxy ──────────────────────────────────
  //
  // Kommt per Redirect vom Login-Flow (/session/start → Redirect auf
  // `<agent-chat-ui>/?threadId=...&token=...`). Wird NUR EINMAL aus der
  // URL gelesen und sofort wieder entfernt (setToken(null) löscht den
  // Query-Param) — ein Bearer-Token darf nicht dauerhaft in der Adress-
  // zeile/Browser-Historie stehen bleiben. Der Wert selbst landet in
  // sessionStorage (siehe lib/session-token.tsx), damit er Reloads
  // innerhalb desselben Tabs übersteht, aber mit dem Tab endet — passend
  // zur Lebensdauer der Server-Session (24h-TTL, siehe proxy_sessions).
  const [urlToken, setUrlToken] = useQueryState("token");
  const [sessionToken, setSessionTokenState] = useState<string | null>(null);
  // Bis der Token-Ursprung (URL vs. sessionStorage) einmal aufgelöst ist,
  // wird weder Chat noch „nicht eingeloggt" gerendert — sonst würde beim
  // frischen Einstieg (?token=... in der URL) kurz der Logout-Screen
  // aufblitzen bzw. useStream ohne Bearer-Header starten.
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    if (urlToken) {
      setSessionToken(urlToken);
      setSessionTokenState(urlToken);
      setUrlToken(null);
    } else {
      setSessionTokenState(getSessionToken());
    }
    setAuthInitialized(true);
    // Nur beim ersten Mount lesen — urlToken/setUrlToken absichtlich nicht
    // in den Dependencies, sonst würde das eigene setUrlToken(null) einen
    // erneuten Durchlauf auslösen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine final values to use, prioritizing URL params then env vars
  const finalApiUrl = apiUrl || envApiUrl;
  const finalAssistantId = assistantId || envAssistantId;
  const finalAuthScheme = authScheme || envAuthScheme || "";

  // Show the form if we: don't have an API URL, or don't have an assistant ID
  if (!finalApiUrl || !finalAssistantId) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center p-4">
        <div className="animate-in fade-in-0 zoom-in-95 bg-background flex max-w-3xl flex-col rounded-lg border shadow-lg">
          <div className="mt-14 flex flex-col gap-2 border-b p-6">
            <div className="flex flex-col items-start gap-2">
              <LangGraphLogoSVG className="h-7" />
              <h1 className="text-xl font-semibold tracking-tight">
                Agent Chat
              </h1>
            </div>
            <p className="text-muted-foreground">
              Welcome to Agent Chat! Before you get started, you need to enter
              the URL of the deployment and the assistant / graph ID.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();

              const form = e.target as HTMLFormElement;
              const formData = new FormData(form);
              const apiUrl = formData.get("apiUrl") as string;
              const assistantId = formData.get("assistantId") as string;
              const apiKey = formData.get("apiKey") as string;

              setApiUrl(apiUrl);
              setApiKey(apiKey);
              setAssistantId(assistantId);
              setAuthScheme(isAgentBuilder ? AGENT_BUILDER_AUTH_SCHEME : "");

              form.reset();
            }}
            className="bg-muted/50 flex flex-col gap-6 p-6"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="apiUrl">
                Deployment URL<span className="text-rose-500">*</span>
              </Label>
              <p className="text-muted-foreground text-sm">
                This is the URL of your LangGraph deployment. Can be a local, or
                production deployment.
              </p>
              <Input
                id="apiUrl"
                name="apiUrl"
                className="bg-background"
                defaultValue={apiUrl || DEFAULT_API_URL}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="assistantId">
                Assistant / Graph ID<span className="text-rose-500">*</span>
              </Label>
              <p className="text-muted-foreground text-sm">
                This is the ID of the graph (can be the graph name), or
                assistant to fetch threads from, and invoke when actions are
                taken.
              </p>
              <Input
                id="assistantId"
                name="assistantId"
                className="bg-background"
                defaultValue={assistantId || DEFAULT_ASSISTANT_ID}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="apiKey">LangSmith API Key</Label>
              <p className="text-muted-foreground text-sm">
                This is <strong>NOT</strong> required if using a local LangGraph
                server. This value is stored in your browser's local storage and
                is only used to authenticate requests sent to your LangGraph
                server.
              </p>
              <PasswordInput
                id="apiKey"
                name="apiKey"
                defaultValue={apiKey ?? ""}
                className="bg-background"
                placeholder="lsv2_pt_..."
              />
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="agentBuilderEnabled">
                    Built with Agent Builder
                  </Label>
                  <p className="text-muted-foreground text-sm">
                    Enable this for Agent Builder deployments.
                  </p>
                </div>
                <Switch
                  id="agentBuilderEnabled"
                  checked={isAgentBuilder}
                  onCheckedChange={setIsAgentBuilder}
                />
              </div>
            </div>

            <div className="mt-2 flex justify-end">
              <Button
                type="submit"
                size="lg"
              >
                Continue
                <ArrowRight className="size-5" />
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Solange der Token-Ursprung noch nicht aufgelöst ist: kurzer Ladezustand.
  if (!authInitialized) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center">
        <LoaderCircle className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  // Ohne Session-Token gibt es keinen Zugang. Der Einstieg erfolgt
  // AUSSCHLIESSLICH über die vom Backend-Skript (get_login_url.py) erzeugte
  // URL `/?threadId=...&token=...`. Deshalb hier KEIN Login-Button / kein
  // OAuth, sondern ein klarer „nicht eingeloggt"-Zustand statt des
  // LangSmith-Setup-Formulars.
  if (!sessionToken) {
    return <NotLoggedInScreen />;
  }

  return (
    <StreamSession
      apiKey={apiKey}
      apiUrl={finalApiUrl}
      assistantId={finalAssistantId}
      authScheme={finalAuthScheme || undefined}
      sessionToken={sessionToken}
    >
      {children}
    </StreamSession>
  );
};

const NotLoggedInScreen: React.FC = () => {
  return (
    <div className="flex min-h-screen w-full items-center justify-center p-4">
      <div className="animate-in fade-in-0 zoom-in-95 bg-background flex max-w-md flex-col gap-4 rounded-lg border p-6 shadow-lg">
        <div className="flex flex-col items-start gap-2">
          <LangGraphLogoSVG className="h-7" />
          <h1 className="text-xl font-semibold tracking-tight">
            Nicht eingeloggt
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Für den Zugang wird ein persönlicher Login-Link mit gültigem
          Session-Token benötigt. Öffne die Chat-Oberfläche bitte über deinen
          Login-Link (Format{" "}
          <code className="text-xs">/?threadId=…&amp;token=…</code>).
        </p>
        <p className="text-muted-foreground text-sm">
          Der Link wird backend-seitig erzeugt. Falls du keinen hast, wende dich
          an die Betreuung bzw. erzeuge ihn im PoC über das Login-Skript.
        </p>
      </div>
    </div>
  );
};

// Create a custom hook to use the context
export const useStreamContext = (): StreamContextType => {
  const context = useContext(StreamContext);
  if (context === undefined) {
    throw new Error("useStreamContext must be used within a StreamProvider");
  }
  return context;
};

export default StreamContext;
