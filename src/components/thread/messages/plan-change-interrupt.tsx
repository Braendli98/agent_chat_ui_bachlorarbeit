import { useState } from "react";
import { Check, X } from "lucide-react";
import { useStreamContext } from "@/providers/Stream";
import { Button } from "@/components/ui/button";
import { MarkdownText } from "../markdown-text";
import type { PlanChangeInterruptValue } from "@/lib/plan-change-interrupt";

// Ja/Nein-Karte für die Planänderungs-Bestätigung. Wird ANSTELLE des Chat-
// Inputs gerendert, solange der Graph auf die Entscheidung wartet.
//
// Resume läuft über denselben /threads/{id}/runs/stream-Endpoint (kein
// separater /resume-Call): stream.submit(undefined, { command: { resume } }).
// resume === true  → Graph übernimmt die Planänderung.
// resume === false → Graph behält den bisherigen Plan.
export function PlanChangeInterrupt({
  value,
}: {
  value: PlanChangeInterruptValue;
}) {
  const stream = useStreamContext();
  // Lokaler Guard gegen Doppelklicks: sobald eine Entscheidung raus ist,
  // beide Buttons sperren, bis der Stream die Folge-AIMessage liefert.
  const [submitted, setSubmitted] = useState(false);
  const disabled = submitted || stream.isLoading;

  const decide = (resume: boolean) => {
    setSubmitted(true);
    stream.submit(undefined, { command: { resume } });
  };

  return (
    <div className="bg-muted mx-auto mb-8 w-full max-w-3xl overflow-hidden rounded-2xl border shadow-xs">
      <div className="border-b px-4 py-3">
        <h3 className="text-base font-semibold tracking-tight">
          {value.frage}
        </h3>
      </div>

      <div className="bg-background/50 px-4 py-3">
        <MarkdownText>{value.plan_text}</MarkdownText>
      </div>

      <div className="flex items-center justify-end gap-2 px-4 py-3">
        <Button
          variant="outline"
          onClick={() => decide(false)}
          disabled={disabled}
        >
          <X className="size-4" />
          Nein, behalten
        </Button>
        <Button
          onClick={() => decide(true)}
          disabled={disabled}
        >
          <Check className="size-4" />
          Ja, übernehmen
        </Button>
      </div>
    </div>
  );
}
