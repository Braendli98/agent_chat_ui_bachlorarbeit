import { Info } from "lucide-react";

// Dauerhaft sichtbarer Transparenz-Hinweis (Kapitel 4.4): Der Nutzer muss
// jederzeit erkennen, dass er mit einem KI-System interagiert.
//
// Bewusst NICHT wegklickbar und ohne eigenen State — der Hinweis wird im
// sticky Footer direkt unter dem Eingabefeld gerendert und ist damit in JEDEM
// Zustand sichtbar (leerer Start, laufender Chat, aktiver Bestätigungs-
// Interrupt). role="note" macht ihn für Screenreader als Anmerkung erkennbar.
export function AiDisclosure() {
  return (
    <div
      role="note"
      className="text-muted-foreground -mt-4 mb-2 flex w-full max-w-3xl items-center justify-center gap-1.5 px-4 text-center text-xs leading-snug"
    >
      <Info
        className="size-3.5 flex-shrink-0"
        aria-hidden="true"
      />
      <span>
        Hinweis: Du interagierst mit einem KI-System. Antworten können fehlerhaft
        sein – bitte wichtige Informationen eigenständig prüfen.
      </span>
    </div>
  );
}
