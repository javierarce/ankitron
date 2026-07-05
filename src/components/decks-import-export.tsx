import { useRef, useState } from "react";
import { exportDeckToJson } from "@/lib/import-export";
import { useDeckImport } from "@/hooks/use-deck-import";
import { DeckPicker } from "./deck-picker";
import { ImportResultModal } from "./import-result-modal";
import { ModalDialog } from "./modal-dialog";

interface DecksImportExportProps {
  decks: string[];
}

export function DecksImportExport({ decks }: DecksImportExportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importer = useDeckImport();
  const [showExportPicker, setShowExportPicker] = useState(false);
  // Export failures reuse the result modal purely as a generic error display;
  // kept local since they're unrelated to the shared import controller.
  const [exportError, setExportError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) importer.beginImportFromFile(file);
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        onClick={() => setShowExportPicker(true)}
        disabled={importer.importing || decks.length === 0}
        className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors disabled:opacity-50"
        title="Pick a deck and download it as JSON"
      >
        Export
      </button>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importer.importing}
        className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors disabled:opacity-50"
        title="Import notes from a JSON file"
      >
        {importer.importing ? "Importing…" : "Import"}
      </button>

      {showExportPicker && (
        <ExportPickerDialog
          decks={decks}
          onCancel={() => setShowExportPicker(false)}
          onDone={() => setShowExportPicker(false)}
          onError={(msg) => {
            setShowExportPicker(false);
            setExportError(msg);
          }}
        />
      )}

      {importer.dialogs}

      {exportError && (
        <ImportResultModal
          result={null}
          error={exportError}
          errorTitle="Export failed"
          onClose={() => setExportError(null)}
        />
      )}
    </>
  );
}

function ExportPickerDialog({
  decks,
  onCancel,
  onDone,
  onError,
}: {
  decks: string[];
  onCancel: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [selected, setSelected] = useState<string>(decks[0] ?? "");
  const [working, setWorking] = useState(false);

  async function handleExport() {
    if (!selected) return;
    setWorking(true);
    try {
      await exportDeckToJson(selected);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <ModalDialog
      title="Export deck"
      titleClassName="mb-1"
      busy={working}
      onClose={onCancel}
      footer={{
        confirmLabel: "Export",
        busyLabel: "Exporting…",
        confirmDisabled: !selected,
        onConfirm: handleExport,
      }}
    >
      <p className="mb-4 text-sm text-foreground/50">
        Choose a deck to download as a JSON file.
      </p>

      <DeckPicker
        decks={decks}
        value={selected || null}
        onChange={setSelected}
        disabled={working}
        autoFocus
      />
    </ModalDialog>
  );
}
