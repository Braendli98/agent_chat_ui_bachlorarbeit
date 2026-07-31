# Änderungen gegenüber der Original-Agent-Chat-UI

Dieses Repo ist ein Fork der [langchain-ai/agent-chat-ui](https://github.com/langchain-ai/agent-chat-ui).
Es wurde so angepasst, dass es **nicht direkt gegen einen LangGraph-Server**,
sondern gegen unseren **eigenen Trusted Proxy** läuft.

```
Browser (Agent Chat UI)  →  Trusted Proxy (FastAPI, :8020)  →  Agent-Server (:8010, LangGraph + Postgres)  →  MCP
```

Das Frontend spricht **ausschließlich** mit dem Proxy. Es wurde **nur das
Frontend** geändert; das Backend/der Proxy ist gegeben.

Die Themen der Anpassung:

1. **Auth/Login** über Session-Token statt LangSmith-API-Key
2. **Bestätigungs-Interrupts** (Ja/Nein bei Planänderung)
3. **Env**-Vorgaben auf den Proxy
4. **„Nicht eingeloggt"-Zustand** statt LangSmith-Setup-Formular
5. **Dauerhafter KI-Hinweis** (Transparenzpflicht)
6. **Excel-Download** des Studienplans

---

## Datei-Überblick

| Datei | Art | Zweck der Änderung |
|-------|-----|--------------------|
| `src/lib/session-token.tsx` | **neu** | Session-Token (Bearer) in sessionStorage halten |
| `src/providers/Stream.tsx` | geändert | Token aus URL lesen/speichern/entfernen, Bearer-Header setzen, Login-Gate |
| `src/providers/client.ts` | geändert | Bearer-Header auch für den SDK-Client (threads.search) |
| `src/providers/Thread.tsx` | geändert | Session-Token an threads.search durchreichen |
| `src/lib/plan-change-interrupt.ts` | **neu** | Type-Guard für den Planänderungs-Interrupt |
| `src/components/thread/messages/plan-change-interrupt.tsx` | **neu** | Ja/Nein-Karte für die Bestätigung |
| `src/components/thread/index.tsx` | geändert | Karte statt Chat-Input rendern, wenn Interrupt aktiv |
| `src/components/thread/messages/ai.tsx` | geändert | doppelte (read-only) Interrupt-Anzeige unterdrücken |
| `.env.example` | geändert | Vorgaben auf Proxy-URL + assistantId |
| `src/components/thread/ai-disclosure.tsx` | **neu** | Dauerhaft sichtbarer KI-Transparenz-Hinweis (S3 / Kap. 4.4) |
| `src/lib/excel-download.ts` | **neu** | Excel per fetch + Bearer-Header laden und als Datei speichern |
| `src/hooks/use-api-url.tsx` | **neu** | Proxy-Basis-URL (`?apiUrl` vor `NEXT_PUBLIC_API_URL`) als Hook |
| `src/components/thread/excel-download.tsx` | **neu** | Datei-Karte mit Download-Button im Chatverlauf |

---

## 1. Auth / Login per Session-Token

### Warum
Das Original authentifiziert sich per **LangSmith-API-Key** (langlebig, manuell
eingegeben, im localStorage). Unser Proxy nutzt stattdessen einen
**kurzlebigen Session-Token** (24h-TTL), der beim Login ausgestellt wird.

Besonderheit des Proxy-Vertrags: Der Auth-Header heißt
**`Authentication: Bearer <token>`** — **nicht** das übliche `Authorization`.
(Cookie-Fallback existiert am Proxy, aber das SDK schickt cross-origin keine
Credentials → der Bearer-Header ist der Weg.)

### Login-Flow (PoC, kein HISinOne)
Im PoC gibt es kein echtes HISinOne. Ein Backend-Skript übernimmt dessen Rolle:

1. `python app/get_login_url.py <matrikel>` signiert lokal ein Dev-JWT, ruft
   `/session/start` am Proxy und **erzeugt eine fertige Browser-URL**:
   `http://localhost:3000/?threadId=<thread_id>&token=<access_token>`
2. Diese URL im Browser öffnen → man landet direkt eingeloggt in der Chat-UI.

Es gibt **bewusst keinen Login-Button und kein OAuth** im Frontend. (Für die
Produktion würde HISinOne später denselben `?threadId=&token=`-Einstieg per
Redirect liefern — das Frontend bleibt dann unverändert.)

### Was im Code passiert

**`src/lib/session-token.tsx` (neu)** — get/set/clear für den Token in
`sessionStorage` (nicht localStorage):
- `sessionStorage` ist **pro Tab** und wird beim Tab-Schließen geleert — das
  passt zur Lebensdauer der Server-Session besser als dauerhaftes localStorage.
- Multi-User funktioniert dadurch über getrennte Browser-Profile/Inkognito.

**`src/providers/Stream.tsx`** — beim Laden der Seite:
- `?token` aus der eigenen URL lesen → in sessionStorage speichern →
  Query-Param **sofort aus der URL entfernen** (ein Bearer-Token darf nicht in
  Adresszeile/History stehenbleiben).
- Der Token wird bei allen SDK-Calls als `Authentication: Bearer <token>` über
  `defaultHeaders` mitgeschickt (gemergt mit dem bestehenden
  `X-Auth-Scheme`-Header, damit sich beide nicht überschreiben).

**`src/providers/client.ts` + `src/providers/Thread.tsx`** — derselbe
Bearer-Header auch für den separaten SDK-Client, den die Thread-History nutzt
(`threads.search`). Ohne den Header läge dort ein 401 statt einer sauberen
(leeren) Antwort.

### threadId in der URL — bewusst behalten
Nur der **`token`** wird aus der URL entfernt, die **`threadId` bleibt** drin.
Begründung (vom Backend bestätigt):
- `threadId = HMAC(kürzel, PROXY_SECRET)` — einweg, nicht erratbar, leakt das
  Kürzel nicht → **kein sensibler Wert**.
- Das **einzige** Credential ist der `token`. Der Proxy **validiert** die
  threadId gegen die an den Token gebundene (403 bei Abweichung) — eine fremde
  oder manipulierte threadId ohne passenden Token gewährt nichts.
- Die gesamte Thread-Logik der App ist URL-basiert. threadId in der URL zu
  lassen erhält die **Reload-Kontinuität im selben Tab** (Token aus
  sessionStorage + threadId aus URL) ohne Zusatzcode.

---

## 2. Bestätigungs-Interrupts (Ja/Nein)

### Warum
Der Graph pausiert bei einer Planänderung mit `interrupt()` und wartet auf eine
Ja/Nein-Entscheidung. Das Original rendert unbekannte Interrupts nur **read-only**
(`GenericInterruptView`) — **ohne Buttons und ohne Fortsetzen (resume)**. Der
Nutzer säße fest.

### Interrupt-Vertrag (vom Backend definiert)
- Erkennen: `stream.interrupt.value === { plan_text: string, frage: string }`
- Fortsetzen über denselben `/threads/{id}/runs/stream`-Endpoint (kein
  separater `/resume`-Call):
  - **Ja:** `stream.submit(undefined, { command: { resume: true } })`
  - **Nein:** `stream.submit(undefined, { command: { resume: false } })`
- Es gibt genau **einen** Interrupt-Typ im System.

### Was im Code passiert

**`src/lib/plan-change-interrupt.ts` (neu)** — strikter Type-Guard: nur wenn
`plan_text` **und** `frage` beide Strings sind, wird dieser Fall behandelt.
(Absichtlich strikt, damit keine anderen Interrupt-Formen fälschlich die Karte
auslösen.)

**`src/components/thread/messages/plan-change-interrupt.tsx` (neu)** — die
Ja/Nein-Karte: Überschrift = `frage`, Body = `plan_text` (als Markdown), zwei
Buttons. Doppelklick-Schutz: nach der ersten Entscheidung beide Buttons sperren,
bis der Stream die Folge-AIMessage liefert.

**`src/components/thread/index.tsx`** — solange der Interrupt aktiv ist, wird die
Karte **anstelle** des Chat-Inputs gerendert; danach kommt der normale Input
automatisch zurück.

**`src/components/thread/messages/ai.tsx`** — für genau diesen Interrupt-Typ die
read-only `GenericInterruptView` unterdrücken, damit der Plan nicht **doppelt**
erscheint (einmal in der Karte am Input, einmal im Nachrichtenfluss).

---

## 3. Env-Vorgaben (`.env.example`)

### Warum
Das Original zeigt auf einen lokalen LangGraph-Dev-Server (`:2024`). Wir zeigen
auf den Proxy.

- `NEXT_PUBLIC_API_URL=http://localhost:8020` — Basis-URL des **Proxy** (nicht
  des Agent-Servers `:8010`). `localhost` muss exakt der in
  `PROXY_CORS_ORIGINS` erlaubten Origin entsprechen.
- `NEXT_PUBLIC_ASSISTANT_ID=studienplaner` — der Proxy ist Single-Graph und
  ignoriert die assistantId, aber das SDK verlangt einen Wert.

Sind **beide** Env-Vars gesetzt, überspringt das Frontend das
Deployment-URL-/Graph-ID-Setup-Formular automatisch.

---

## 4. „Nicht eingeloggt"-Zustand (`src/providers/Stream.tsx`)

### Warum
Wenn kein Token vorhanden ist (z.B. `localhost:3000` ohne Login-Link, oder nach
Tab-Schließen ein Bookmark mit threadId aber ohne Token), zeigte das Original das
**LangSmith-Setup-Formular** — für unseren Flow sinnlos und irreführend.

### Was im Code passiert
- Ein `authInitialized`-Flag stellt sicher, dass erst gerendert wird, wenn der
  Token-Ursprung (URL vs. sessionStorage) aufgelöst ist — sonst würde beim
  frischen Einstieg (`?token=…`) kurz der Logout-Screen aufblitzen bzw.
  `useStream` ohne Bearer-Header starten.
- Ohne Token wird eine klare **„Nicht eingeloggt"-Karte** gezeigt (Hinweis:
  „Bitte über deinen Login-Link öffnen"), **kein** Setup-Formular, **kein**
  Login-Button.

### Lebenszyklus (erwartetes Verhalten, kein Bug)
`sessionStorage` wird beim Tab-Schließen geleert. Danach führt die reine URL
(threadId ohne Token) zu einem 401 am Proxy — die „Nicht eingeloggt"-Karte fängt
das **vor** dem Request sauber ab. Dann ist ein neuer Login-Link nötig
(`app/get_login_url.py`). Für den PoC so gewollt.

---

## 5. Dauerhafter KI-Hinweis (S3 / Kapitel 4.4)

### Warum
Transparenzpflicht: Der Nutzer muss **jederzeit** erkennen, dass er mit einem
**KI-System** interagiert. „Dauerhaft sichtbar" heißt: in jedem Zustand
vorhanden und **nicht wegklickbar**.

### Was im Code passiert
**`src/components/thread/ai-disclosure.tsx` (neu)** — eine kleine, zustandslose
Hinweiszeile (Icon + Text, `role="note"`), bewusst ohne Schließen-Button.

**`src/components/thread/index.tsx`** — der Hinweis wird im **sticky Footer
direkt unter dem Eingabefeld** gerendert, und zwar **außerhalb** der
Input/Karte-Umschaltung. Dadurch ist er in allen Zuständen sichtbar:
- leerer Startbildschirm,
- laufender Chat (Footer ist `sticky bottom-0` → immer im Viewport),
- aktiver Bestätigungs-Interrupt (wenn die Ja/Nein-Karte den Input ersetzt).

Text: *„Hinweis: Du interagierst mit einem KI-System. Antworten können fehlerhaft
sein – bitte wichtige Informationen eigenständig prüfen."*

Der Wortlaut lässt sich zentral in `ai-disclosure.tsx` anpassen.

---

## 6. Excel-Download des Studienplans

### Warum
Das Backend erzeugt den Studienplan als Excel-Datei und legt **nur den
Dateinamen** in den State (`values.excel_dateiname`). Der frühere
Server-Dateipfad im Nachrichtentext entfällt — er zeigte auf das Dateisystem des
Agent-Servers und war für Studierende ohnehin nicht öffenbar.

### Vertrag (vom Backend definiert)
- State-Feld: `values.excel_dateiname` — nur der Dateiname, kein Pfad.
- Download: `GET /threads/{threadId}/excel` mit dem üblichen Header
  `Authentication: Bearer <token>`.
- Das Feld wird **auch wieder geleert**, sobald die Datei nicht mehr zum Plan
  passt: nach bestätigter Planänderung, nach einer Präferenzkorrektur
  (ECTS/Arbeitsstunden), nach einem Horizontwechsel und nach einem bestätigten
  Neustart. Ist es leer, gibt es keinen Download.
- Der Endpunkt liest `excel_dateiname` bei jedem Aufruf frisch aus dem State und
  liefert damit immer den aktuellen Stand.
- `Content-Disposition` ist per `Access-Control-Expose-Headers` freigegeben und
  damit für unser `fetch` lesbar.
- Fehler (z.B. 404, wenn das Cleanup die Datei nach 24 h entfernt hat) enthalten
  einen erklärenden Text im Body.

### Was im Code passiert

**`src/providers/Stream.tsx`** — `StateType` um das optionale Feld
`excel_dateiname` erweitert. Das Feld kommt automatisch mit, weil der Stream
ohnehin im `values`-Modus läuft.

**`src/lib/excel-download.ts` (neu)** — die Download-Logik.
Ein einfaches `<a href="…">` funktioniert hier **nicht**: Der Proxy
authentifiziert über den Custom-Header `Authentication`, und ein
Browser-Navigations-Download kann keine eigenen Header mitschicken. Deshalb:
`fetch` → `res.blob()` → `URL.createObjectURL` → synthetischer `<a download>` →
verzögertes `revokeObjectURL` (sofortiges Freigeben bricht den Download in
manchen Browsern ab).

Der Dateiname kommt primär aus dem `Content-Disposition`-Header der Antwort
(maßgeblich, weil ihn der Endpunkt beim Ausliefern der Datei setzt), ersatzweise
aus `excel_dateiname`. Der Parser deckt beide Formen ab: `filename="…"` und
RFC 5987 `filename*=UTF-8''…` (das nutzt FastAPI bei Umlauten).

Fehler des Servers werden **im Wortlaut** durchgereicht: `ExcelDownloadError`
trägt den Erklärtext aus dem Body (FastAPI `{"detail": …}`), damit die UI beim
404 nach dem 24h-Cleanup sagen kann, *warum* die Datei weg ist, statt nur
„Download fehlgeschlagen". HTML-Fehlerseiten und überlange Bodies werden dabei
verworfen — die wären für Studierende unbrauchbar.

**`src/hooks/use-api-url.tsx` (neu)** — die Proxy-URL wird nach derselben Regel
wie in `Stream.tsx`/`Thread.tsx` abgeleitet (`?apiUrl` schlägt
`NEXT_PUBLIC_API_URL`). Eigener Hook statt Erweiterung des `StreamContext`:
dessen Wert ist aktuell **exakt** der `useStream`-Rückgabewert — ihn nur für eine
URL zu wrappen, würde alle `useStreamContext()`-Aufrufstellen betreffen.

**`src/components/thread/excel-download.tsx` (neu)** — Datei-Karte mit
Dateiname, Icon und Download-Button; während des Ladens Spinner + gesperrter
Button, bei Fehlern ein deutscher Toast (dasselbe `richColors`/`closeButton`-
Muster wie die übrige Fehleranzeige).

**`src/components/thread/index.tsx`** — die Karte wird **am Ende des
Chatverlaufs** gerendert, nicht innerhalb der Nachrichtenliste:
`excel_dateiname` ist **Thread-State und nicht an eine einzelne Nachricht
gebunden**. Es gibt also genau eine Karte pro Thread, die immer auf die aktuelle
Datei zeigt — auch nach einem Reload, weil sie aus dem persistierten State kommt.

Die Bindung ist bewusst **reaktiv** (`stream.values?.excel_dateiname`), nicht
einmalig: Leert das Backend das Feld, verschwindet die Karte sofort. Das ist
keine Kosmetik — der Dateiname trägt einen Inhalts-Hash, die alte Datei existiert
also weiter. Ein Download aus veraltetem State hätte deshalb **stillschweigend
die falsche Datei** geliefert, ohne 404.

### CORS am Proxy
Geklärt: Die `CORSMiddleware` hängt global an der Proxy-App und fängt den
`OPTIONS`-Preflight vor dem Routing ab — sie deckt jeden Pfad ab, auch neue.
`Authentication` steht in `Access-Control-Allow-Headers`, der Origin kommt aus
`PROXY_CORS_ORIGINS`. Am Frontend ist dafür nichts zu tun.

---

## Was NICHT geändert wurde

- Kein Backend-/Proxy-Code (dieses Repo ist reines Frontend).
- Der Next.js-API-Passthrough (`src/app/api/[..._path]/route.ts`) ist in diesem
  Setup **ungenutzt**: `NEXT_PUBLIC_API_URL` zeigt direkt auf den Proxy, das SDK
  spricht cross-origin mit ihm. Relevant ist daher die **CORS**-Konfiguration am
  Proxy, nicht der Passthrough.
- Die vorhandene Agent-Inbox-Interrupt-UI (Approve/Reject/Edit) bleibt erhalten;
  unser Planänderungs-Interrupt läuft daran vorbei über die eigene Karte.

---

## Starten

```bash
pnpm dev        # startet Next.js auf http://localhost:3000
```

Einstieg **nicht** über `localhost:3000` direkt (→ „nicht eingeloggt"), sondern
über den vom Backend erzeugten Login-Link:

```bash
python app/get_login_url.py <matrikel>   # am Backend; gibt die Login-URL aus
```

Voraussetzung: Proxy läuft auf `:8020`, und `http://localhost:3000` steht in
`PROXY_CORS_ORIGINS`.
