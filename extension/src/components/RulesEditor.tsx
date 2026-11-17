import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadFile } from "@/features/pdf/export";

/** What the rule pickers accept — plain text the AI gets verbatim. */
export const RULES_FILE_ACCEPT = ".md,.markdown,.txt,text/markdown,text/plain";

interface RulesEditorProps {
  initial: string;
  placeholder: string;
  /** File name for a download of rules that were typed, not uploaded. */
  defaultFileName: string;
  /** Reads the stored document — for the uploaded file's name, which App-level state doesn't carry. */
  load: () => Promise<{ content: string; sourceFileName?: string } | null>;
  save: (content: string, sourceFileName?: string) => Promise<void>;
  onSaved: (content: string) => void;
}

/**
 * A rules textarea (cover-letter or outreach rules) that can also be filled
 * from a .md/.txt file and saved back out as one — both through icons inside
 * the field's corner, not extra buttons next to it. An upload is saved right
 * away; the file's name is kept so the download gives the same file back
 * (with any edits made here since).
 */
export function RulesEditor({ initial, placeholder, defaultFileName, load, save, onSaved }: RulesEditorProps) {
  const [draft, setDraft] = useState(initial);
  const [sourceFileName, setSourceFileName] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load()
      .then((doc) => setSourceFileName(doc?.sourceFileName))
      .catch(() => undefined);
    // Once on mount — the name only changes through this editor afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persist(content: string, fileName = sourceFileName) {
    setSaving(true);
    setError(null);
    try {
      await save(content, fileName);
      onSaved(content);
    } catch (err) {
      // The local cache write already landed — only the Drive backup failed.
      setError(err instanceof Error ? `Saved on this device only: ${err.message}` : "Saved on this device only.");
      onSaved(content);
    } finally {
      setSaving(false);
    }
  }

  async function handleFile(file: File) {
    const content = await file.text();
    setDraft(content);
    setSourceFileName(file.name);
    await persist(content, file.name);
  }

  function handleDownload() {
    const name = sourceFileName ?? defaultFileName;
    // text/plain, not text/markdown: a .md would otherwise open in a tab instead of downloading on some setups.
    void downloadFile(new File([draft], name, { type: "text/plain;charset=utf-8" }));
  }

  const iconClass =
    "flex h-7 w-7 items-center justify-center rounded-md bg-background/80 text-muted-foreground backdrop-blur hover:bg-muted hover:text-foreground disabled:opacity-40";

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <textarea
          className="min-h-24 w-full rounded-md border border-border bg-background p-2 pr-20 text-sm outline-none"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="absolute right-1.5 top-1.5 flex gap-0.5">
          <button
            type="button"
            className={iconClass}
            onClick={() => fileInputRef.current?.click()}
            disabled={saving}
            aria-label="Upload rules from a .md or .txt file"
            title="Upload from a .md / .txt file"
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={iconClass}
            onClick={handleDownload}
            disabled={!draft.trim()}
            aria-label={`Download as ${sourceFileName ?? defaultFileName}`}
            title={`Download as ${sourceFileName ?? defaultFileName}`}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={RULES_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {sourceFileName && <p className="text-[11px] text-muted-foreground">From file: {sourceFileName}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button size="sm" onClick={() => void persist(draft)} disabled={saving || draft === initial} className="w-fit">
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
