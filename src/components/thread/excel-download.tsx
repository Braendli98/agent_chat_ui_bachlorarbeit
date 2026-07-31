import { useState } from "react";
import { Download, FileSpreadsheet, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { useQueryState } from "nuqs";
import { Button } from "@/components/ui/button";
import { useApiUrl } from "@/hooks/use-api-url";
import { downloadExcel, ExcelDownloadError } from "@/lib/excel-download";

// Datei-Karte am Ende des Chatverlaufs. Wird gerendert, sobald
// `values.excel_dateiname` gesetzt ist.
//
// Die Karte hängt bewusst NICHT an einer einzelnen Nachricht: excel_dateiname
// ist Thread-State, es gibt also genau eine Karte pro Thread, die immer auf die
// aktuelle Datei zeigt — auch nach einem Reload, weil sie aus dem persistierten
// State kommt.
export function ExcelDownload({ dateiname }: { dateiname: string }) {
  const [threadId] = useQueryState("threadId");
  const apiUrl = useApiUrl();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!apiUrl || !threadId || loading) return;

    setLoading(true);
    try {
      await downloadExcel(apiUrl, threadId, dateiname);
    } catch (e) {
      // Erklärt der Server den Fehler selbst (z.B. „Datei nach 24 Stunden
      // entfernt"), zeigen wir SEINEN Text — der sagt dem Studierenden etwas,
      // ein generisches „Download fehlgeschlagen" nicht.
      if (e instanceof ExcelDownloadError && e.vomServer) {
        toast.error(e.message, {
          richColors: true,
          closeButton: true,
          duration: 10000,
        });
      } else {
        toast.error("Der Studienplan konnte nicht heruntergeladen werden.", {
          description: (
            <p>
              Bitte versuche es erneut.{" "}
              <code>{e instanceof Error ? e.message : String(e)}</code>
            </p>
          ),
          richColors: true,
          closeButton: true,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-muted flex w-full max-w-3xl items-center gap-3 rounded-2xl border p-3 shadow-xs">
      <FileSpreadsheet
        className="text-muted-foreground size-8 flex-shrink-0"
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{dateiname}</p>
        <p className="text-muted-foreground text-xs">
          Dein Studienplan als Excel-Datei
        </p>
      </div>

      <Button
        onClick={handleClick}
        disabled={loading || !threadId}
        className="flex-shrink-0"
      >
        {loading ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
        Herunterladen
      </Button>
    </div>
  );
}
