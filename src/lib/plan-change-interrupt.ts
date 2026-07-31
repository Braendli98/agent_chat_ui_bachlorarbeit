// Erkennt den EINEN Interrupt-Typ, den der Graph über den Trusted Proxy
// emittiert: die Planänderungs-Bestätigung. Der Graph pausiert mit
// interrupt({ plan_text, frage }) und erwartet als Resume-Wert ein reines
// Boolean (true = übernehmen, false = behalten) — siehe
// components/thread/messages/plan-change-interrupt.tsx.
//
// Der Guard ist ABSICHTLICH strikt (beide Felder müssen Strings sein), damit
// ausschließlich dieser Fall die Ja/Nein-Karte auslöst und andere/zukünftige
// Interrupt-Formen weiterhin über die generische Anzeige laufen.

export interface PlanChangeInterruptValue {
  plan_text: string;
  frage: string;
}

export function isPlanChangeInterruptValue(
  value: unknown,
): value is PlanChangeInterruptValue {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<PlanChangeInterruptValue>;
  return typeof v.plan_text === "string" && typeof v.frage === "string";
}
