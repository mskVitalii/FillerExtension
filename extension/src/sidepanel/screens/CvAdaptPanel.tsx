import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Eye, FilePlus, FileUp, Paperclip, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { CvPreview } from "@/components/cv-template/CvPreview";
import { VariableEditor } from "@/components/cv-template/VariableEditor";
import { VariableSelector } from "@/components/cv-template/VariableSelector";
import { sendMessage } from "@/types/messages";
import { EMPTY_JOB, type Job } from "@/types/job";
import type { CvMeta, Profile } from "@/types/profile";
import { EMPTY_CV_TEMPLATE, type CvTemplate, type CvTemplateLibrary, type CvVariable } from "@/types/cv-template";
import { getCvTemplates, saveCvTemplate, templateForCv } from "@/features/cv-template/repository";
import { DOCX_MIME } from "@/features/cv-template/docx";
import {
  EMPTY_ADAPT_ENTRY,
  loadAdaptEntry,
  recordAdaptedCv,
  renderAdaptedCv,
  type AdaptedCvFormat,
  resolveValues,
  saveAdaptEntry,
  suggestEntry,
  usedVariables as templateUsedVariables,
} from "@/features/cv-template/adapt";
import { extractVariableNames, fillTemplate, findOptionsInPosting, syncVariables } from "@/features/cv-template/template";
import { CV_MARKDOWN_SYNTAX, parseCvMarkdown, parsePlainText } from "@/features/cv-template/markdown";
import { getCvFile, getCvLibrary, replaceCvFile, setActiveCv, uploadCv } from "@/features/profile/repository";
import { getTabState, type CvAdaptEntry } from "@/features/storage/session";
import { getCachedJob } from "@/features/storage/local";
import { downloadFile, openPdfPreview } from "@/features/pdf/export";
import { extractCvText, isDocxFile, normalizeCvFile } from "@/lib/cv-text";
import { fileToBase64 } from "@/lib/base64";
import { cn } from "@/lib/utils";

type View = "adapt" | "template";
type SaveStatus = "idle" | "saving" | "saved" | "local-only";
type TemplateDraft = Omit<CvTemplate, "updatedAt">;

interface CvAdaptPanelProps {
  tabId: number;
  tabUrl: string;
  profile: Profile;
  hasApiKey: boolean;
  onBack: () => void;
  onRequestApiKey: () => void;
  /** The CV picked here becomes the extension-wide active CV (autofill, attachments, AI context). */
  onCvChange: (cv: CvMeta) => void;
}

/** The posting MainView already extracted for this tab (its per-tab state, else the URL-keyed extraction cache). */
async function loadJob(tabId: number, tabUrl: string): Promise<Job> {
  const state = await getTabState(tabId);
  if (state && state.url === tabUrl && (state.job.position || state.job.description)) return state.job;
  return (await getCachedJob(tabUrl)) ?? EMPTY_JOB;
}

function sameTemplate(a: TemplateDraft, b: TemplateDraft) {
  return a.format === b.format && a.content === b.content && JSON.stringify(a.variables) === JSON.stringify(b.variables);
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/**
 * Adapt CV tab: every CV in the library carries its own set of
 * `{{placeholders}}` (city, job title, main language, keywords, whole
 * swappable blocks…), each with its own variants. A Word CV is its own
 * template — placeholders are typed into it in Word and the output keeps its
 * layout exactly; a PDF CV gets a Markdown template rendered to PDF here.
 * Per posting, variants found in the posting are pre-selected offline, the
 * AI refines the rest, the user overrides anything via a selector, and the
 * result is downloaded or attached straight into the page's upload field.
 */
export function CvAdaptPanel({ tabId, tabUrl, profile, hasApiKey, onBack, onRequestApiKey, onCvChange }: CvAdaptPanelProps) {
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>("adapt");
  const [cvs, setCvs] = useState<CvMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<CvTemplateLibrary>({});
  const [saved, setSaved] = useState<TemplateDraft>(EMPTY_CV_TEMPLATE);
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_CV_TEMPLATE);
  /** Bytes of the selected Word CV — loaded once per selection, reused for every export. */
  const [docx, setDocx] = useState<Uint8Array | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [job, setJob] = useState<Job>(EMPTY_JOB);
  const [entry, setEntry] = useState<CvAdaptEntry>(EMPTY_ADAPT_ENTRY);
  const [customNames, setCustomNames] = useState<Set<string>>(new Set());
  const [suggesting, setSuggesting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const templateFileRef = useRef<HTMLInputElement>(null);
  const addCvRef = useRef<HTMLInputElement>(null);
  const replaceDocxRef = useRef<HTMLInputElement>(null);
  const autoSuggestTriedRef = useRef<string | null>(null);

  const selectedCv = cvs.find((cv) => cv.id === selectedId) ?? null;

  useEffect(() => {
    void (async () => {
      const [library, loadedTemplates, loadedJob] = await Promise.all([
        getCvLibrary(),
        getCvTemplates(),
        loadJob(tabId, tabUrl),
      ]);
      setCvs(library.items);
      setTemplates(loadedTemplates);
      setJob(loadedJob);
      setSelectedId(library.activeId ?? library.items[0]?.id ?? null);
      setLoaded(true);
    })();
  }, [tabId, tabUrl]);

  // Everything per CV — its template, this posting's values for it, and a
  // Word CV's bytes — reloads whenever the selection (or that CV's file) changes.
  useEffect(() => {
    if (!loaded || !selectedCv) return;
    let cancelled = false;
    const template = templateForCv(selectedCv, templates);
    setSaved(template);
    setDraft(template);
    setSaveStatus("idle");
    setCustomNames(new Set());
    setDocx(null);
    setView(template.format === "markdown" && !template.content.trim() ? "template" : "adapt");
    void loadAdaptEntry(tabId, tabUrl, selectedCv.id).then((loadedEntry) => {
      if (!cancelled) setEntry(loadedEntry);
    });
    if (template.format === "docx") {
      getCvFile(selectedCv.id)
        .then(async (file) => {
          if (cancelled) return;
          if (file) setDocx(new Uint8Array(await file.arrayBuffer()));
          else setError("Couldn't load the Word CV from Google Drive.");
        })
        .catch(() => {
          if (!cancelled) setError("Couldn't load the Word CV from Google Drive.");
        });
    }
    return () => {
      cancelled = true;
    };
    // `templates` is read only when the selection changes — saving updates it without re-seeding the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, selectedCv?.id, selectedCv?.uploadedAt, tabId, tabUrl]);

  const isDocx = draft.format === "docx";
  const usedNames = useMemo(() => extractVariableNames(draft.content), [draft.content]);
  const draftTemplate = useMemo<CvTemplate>(() => ({ ...draft, updatedAt: "" }), [draft]);
  const usedVariables = useMemo(() => templateUsedVariables(draftTemplate), [draftTemplate]);
  const foundByName = useMemo(
    () => Object.fromEntries(usedVariables.map((v) => [v.name, findOptionsInPosting(v.options, job)])),
    [usedVariables, job],
  );
  const resolvedValues = useMemo(() => resolveValues(draftTemplate, job, entry.values), [draftTemplate, job, entry]);
  const blocks = useMemo(() => {
    const filled = fillTemplate(draft.content, resolvedValues, { mark: true });
    return isDocx ? parsePlainText(filled) : parseCvMarkdown(filled);
  }, [draft.content, resolvedValues, isDocx]);
  const dirty = !sameTemplate(draft, saved);
  const hasJob = Boolean(job.position || job.description);

  function updateEntry(next: CvAdaptEntry) {
    setEntry(next);
    if (selectedCv) void saveAdaptEntry(tabId, tabUrl, selectedCv.id, next);
  }

  function handleValueChange(name: string, value: string, custom: boolean) {
    // A hand-picked value no longer carries the AI's reasoning for a different one.
    const reasons = { ...entry.reasons };
    delete reasons[name];
    updateEntry({ ...entry, values: { ...entry.values, [name]: value }, reasons });
    setCustomNames((prev) => {
      const next = new Set(prev);
      if (custom) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  async function handleSuggest() {
    if (!hasApiKey) {
      onRequestApiKey();
      return;
    }
    setSuggesting(true);
    setError(null);
    try {
      updateEntry(await suggestEntry(job, draftTemplate, entry));
      setCustomNames(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not suggest values.");
    } finally {
      setSuggesting(false);
    }
  }

  // Once per posting and CV: let the AI refine the offline pre-selection as
  // soon as there's a template, a posting and a key — the same "work is
  // already done when you look" behavior as auto-answered questions.
  useEffect(() => {
    if (!loaded || !selectedCv || entry.aiSuggested || autoSuggestTriedRef.current === selectedCv.id) return;
    if (!hasApiKey || !hasJob || usedVariables.length === 0 || dirty) return;
    autoSuggestTriedRef.current = selectedCv.id;
    void handleSuggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, selectedCv?.id, entry.aiSuggested, hasApiKey, hasJob, usedVariables.length, dirty]);

  function confirmDiscard(): boolean {
    return !dirty || window.confirm("Discard unsaved placeholder changes?");
  }

  async function handleSelectCv(id: string) {
    if (id === selectedId || !confirmDiscard()) return;
    setError(null);
    setStatus(null);
    setSelectedId(id);
    const meta = await setActiveCv(id);
    if (meta) onCvChange(meta);
  }

  async function handleAddCv(rawFile: File) {
    if (!confirmDiscard()) return;
    const file = normalizeCvFile(rawFile);
    setBusy("Uploading CV…");
    setError(null);
    try {
      const meta = await uploadCv(file, await extractCvText(file));
      setCvs((list) => [...list, meta]);
      setSelectedId(meta.id);
      onCvChange(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the CV.");
    } finally {
      setBusy(null);
    }
  }

  /** A Word CV edited in Word (new placeholders typed in) replaces the library entry's file, keeping its id — and so its placeholder settings. */
  async function handleReplaceDocx(rawFile: File) {
    if (!selectedCv) return;
    const file = normalizeCvFile(rawFile);
    if (!isDocxFile(file)) {
      setError("Pick a .docx file.");
      return;
    }
    setBusy("Replacing file…");
    setError(null);
    try {
      const text = await extractCvText(file);
      const meta = await replaceCvFile(selectedCv.id, file, text);
      if (!meta) return;
      // Carry the (possibly unsaved) placeholder settings over onto the new file's text and save
      // them; the selection effect then re-seeds from `templates` because `uploadedAt` changed.
      const next: TemplateDraft = { format: "docx", content: text, variables: syncVariables(text, draft.variables) };
      const savedTemplate = await saveCvTemplate(meta.id, next, cvs.map((cv) => cv.id)).catch(() => ({
        ...next,
        updatedAt: new Date().toISOString(),
      }));
      setTemplates((lib) => ({ ...lib, [meta.id]: savedTemplate }));
      setCvs((list) => list.map((cv) => (cv.id === meta.id ? meta : cv)));
      onCvChange(meta);
      setStatus(`Loaded ${meta.fileName} — ${extractVariableNames(text).length} placeholder(s) found.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not replace the file.");
    } finally {
      setBusy(null);
    }
  }

  function updateDraft(next: TemplateDraft) {
    setDraft({ ...next, variables: syncVariables(next.content, next.variables) });
    setSaveStatus("idle");
  }

  function updateVariable(index: number, variable: CvVariable) {
    updateDraft({ ...draft, variables: draft.variables.map((v, i) => (i === index ? variable : v)) });
  }

  async function handleSave() {
    if (!selectedCv) return;
    setSaveStatus("saving");
    setError(null);
    // Blank variants are editing leftovers ("Add variant" never filled in), not real options.
    const cleaned: TemplateDraft = {
      ...draft,
      variables: draft.variables.map((v) => ({ ...v, options: v.options.filter((o) => o.trim()) })),
    };
    try {
      const result = await saveCvTemplate(selectedCv.id, cleaned, cvs.map((cv) => cv.id));
      setTemplates((lib) => ({ ...lib, [selectedCv.id]: result }));
      setSaveStatus("saved");
    } catch {
      // `saveCvTemplate` wrote the local cache before the Drive call that threw.
      setTemplates((lib) => ({ ...lib, [selectedCv.id]: { ...cleaned, updatedAt: new Date().toISOString() } }));
      setSaveStatus("local-only");
    }
    setSaved(cleaned);
    setDraft(cleaned);
  }

  async function templatize(cvText: string) {
    if (!hasApiKey) {
      onRequestApiKey();
      return;
    }
    if (draft.content.trim() && !window.confirm("Replace the current template with one built from this CV?")) return;
    setBusy("Building template…");
    setError(null);
    try {
      const result = await sendMessage<{ type: "CV_TEMPLATE_DRAFT"; content: string; variables: CvVariable[] }>({
        type: "TEMPLATIZE_CV",
        cvText,
      });
      updateDraft({ format: "markdown", content: result.content, variables: result.variables });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build a template from the CV.");
    } finally {
      setBusy(null);
    }
  }

  /** `.md`/`.txt` is taken as an already-written Markdown template; a PDF is a plain CV, so it goes through the AI conversion (or raw text without a key). */
  async function handleTemplateFile(file: File) {
    setError(null);
    try {
      if (isPdfFile(file)) {
        const text = await extractCvText(file);
        if (hasApiKey) await templatize(text);
        else updateDraft({ ...draft, content: text });
        return;
      }
      if (draft.content.trim() && !window.confirm(`Replace the current template with ${file.name}?`)) return;
      updateDraft({ ...draft, content: await file.text() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file.");
    }
  }

  /** Every PDF produced here (preview, attach, download) is also kept with this posting's application. */
  async function renderOutput(format: AdaptedCvFormat = "pdf"): Promise<File> {
    if (!selectedCv) throw new Error("No CV selected.");
    const file = await renderAdaptedCv(selectedCv, draftTemplate, resolvedValues, profile, {
      format,
      docx,
      company: job.company,
    });
    if (format === "pdf") {
      const cv = selectedCv;
      recordAdaptedCv(job.url ? job : { ...job, url: tabUrl }, cv, resolvedValues, file)
        .then((saved) => saved && setStatus("Saved with this posting in Applications."))
        .catch(() => undefined);
    }
    return file;
  }

  /** A Word CV's PDF comes from Google Docs and takes a few seconds — say so instead of a generic spinner. */
  function exportingLabel(format: AdaptedCvFormat): string {
    return isDocx && format === "pdf" ? "Converting to PDF via Google Docs…" : "Exporting…";
  }

  async function handleDownload(format: AdaptedCvFormat) {
    setBusy(exportingLabel(format));
    setError(null);
    try {
      await downloadFile(await renderOutput(format));
    } catch (err) {
      setError(err instanceof Error ? `Export failed: ${err.message}` : "Export failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handlePreview() {
    setBusy(exportingLabel("pdf"));
    setError(null);
    try {
      await openPdfPreview(await renderOutput("pdf"));
    } catch (err) {
      setError(err instanceof Error ? `Preview failed: ${err.message}` : "Preview failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleAttach() {
    setBusy(exportingLabel("pdf"));
    setError(null);
    setStatus(null);
    try {
      const file = await renderOutput();
      const response = await sendMessage<{ type: "UPLOAD_FILE_RESULT"; nativeInputs: number; dropZones: number }>({
        type: "UPLOAD_FILE",
        tabId,
        kind: "cv",
        fileName: file.name,
        mimeType: file.type,
        base64Data: await fileToBase64(file),
      });
      setStatus(`Adapted CV placed into ${response.nativeInputs} file input(s), ${response.dropZones} drop zone(s).`);
    } catch (err) {
      setError(err instanceof Error ? `Attach failed: ${err.message}` : "Attach failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) return null;

  const missingValues = usedVariables.filter((v) => !resolvedValues[v.name]?.trim()).map((v) => v.name);
  const exportDisabled = Boolean(busy) || (isDocx && !docx);

  // Plain render helpers, called as functions — not mounted as <Components/>,
  // which React would remount (and so defocus their inputs) on every render.
  function renderAdaptView() {
    if (!draft.content.trim()) {
      return (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          This CV has no template yet.{" "}
          <button onClick={() => setView("template")} className="underline underline-offset-2">
            Create one
          </button>
          , then come back here to adapt it per posting.
        </p>
      );
    }
    return (
      <>
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-2">
          {hasJob ? (
            <p className="text-xs">
              <span className="font-medium">{job.position || "Untitled role"}</span>
              {job.company && <span className="text-muted-foreground"> · {job.company}</span>}
              {job.location && <span className="text-muted-foreground"> · {job.location}</span>}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No job posting detected on this tab yet — open the main view on a posting first. Variants below are
              your defaults.
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={suggesting || !hasJob || usedVariables.length === 0}
            onClick={() => void handleSuggest()}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {suggesting ? "Picking values…" : entry.aiSuggested ? "Re-suggest from posting" : "Suggest from posting"}
          </Button>
        </div>

        {usedVariables.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {isDocx
              ? "No {{placeholders}} in this Word file yet — type some in Word, then use Replace .docx in the Placeholders tab."
              : "The template has no {{placeholders}} yet — add some in the Placeholders tab."}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {usedVariables.map((variable) => (
              <VariableSelector
                key={variable.name}
                variable={variable}
                value={resolvedValues[variable.name] ?? ""}
                foundInPosting={foundByName[variable.name] ?? []}
                custom={customNames.has(variable.name)}
                reason={entry.reasons[variable.name]}
                onChange={(value, custom) => handleValueChange(variable.name, value, custom)}
              />
            ))}
          </div>
        )}

        {missingValues.length > 0 && (
          <p className="text-xs text-amber-700">
            Empty in the {isDocx ? "document" : "PDF"}: {missingValues.map((name) => `{{${name}}}`).join(", ")}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={exportDisabled} onClick={() => void handlePreview()}>
            <Eye className="h-3.5 w-3.5" /> Preview PDF
          </Button>
          <Button size="sm" variant="outline" disabled={exportDisabled} onClick={() => void handleAttach()}>
            <Paperclip className="h-3.5 w-3.5" /> Attach to page
          </Button>
          <Button size="sm" variant="ghost" disabled={exportDisabled} onClick={() => void handleDownload("pdf")}>
            <Download className="h-3.5 w-3.5" /> PDF
          </Button>
          {isDocx && (
            <Button size="sm" variant="ghost" disabled={exportDisabled} onClick={() => void handleDownload("docx")}>
              <Download className="h-3.5 w-3.5" /> .docx
            </Button>
          )}
        </div>
        {isDocx && (
          <p className="text-xs text-muted-foreground">
            The PDF is made from your Word file by Google Docs — layout, photo and fonts carried over, except
            weights Google doesn't have (Calibri Light shows as Calibri). The first time, Google asks once to let
            Filler create temporary files in your Drive; the file is deleted right after. The preview below is text
            only — use Preview PDF for the real page.
          </p>
        )}

        <Card>
          <CardContent className="max-h-[28rem] overflow-y-auto p-3">
            <CvPreview blocks={blocks} />
          </CardContent>
        </Card>
      </>
    );
  }

  function renderDocxTemplateView() {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-2 text-xs">
        <p>
          <span className="font-medium">Word CV:</span> {selectedCv?.fileName} · {usedNames.length} placeholder
          {usedNames.length === 1 ? "" : "s"} found
        </p>
        <p className="text-muted-foreground">
          To add or move a placeholder, type it in Word (e.g. {"{{main_language}}"}) and replace the file — this CV
          keeps its placeholder settings. The value takes the formatting of the text where {"{{"} starts; a
          multi-line variant becomes line breaks inside that paragraph.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => replaceDocxRef.current?.click()}>
            <FileUp className="h-3.5 w-3.5" /> Replace .docx
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!docx}
            onClick={() => {
              if (docx && selectedCv) {
                void downloadFile(new File([new Uint8Array(docx)], selectedCv.fileName, { type: DOCX_MIME }));
              }
            }}
          >
            <Download className="h-3.5 w-3.5" /> Download original
          </Button>
          <input
            ref={replaceDocxRef}
            type="file"
            accept={`.docx,${DOCX_MIME}`}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleReplaceDocx(file);
              e.target.value = "";
            }}
          />
        </div>
        <details>
          <summary className="cursor-pointer text-muted-foreground">Document text</summary>
          <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
            {draft.content}
          </pre>
        </details>
      </div>
    );
  }

  function renderMarkdownTemplateView() {
    return (
      <>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={Boolean(busy) || !selectedCv?.text}
            onClick={() => selectedCv && void templatize(selectedCv.text)}
          >
            <WandSparkles className="h-3.5 w-3.5" /> Build from this CV with AI
          </Button>
          <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => templateFileRef.current?.click()}>
            <FileUp className="h-3.5 w-3.5" /> Load template
          </Button>
          <input
            ref={templateFileRef}
            type="file"
            accept=".md,.txt,.pdf,text/plain,text/markdown,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleTemplateFile(file);
              e.target.value = "";
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          This is a PDF CV, so it's rebuilt from a template and exported as a new PDF. AI keeps your wording and only
          adds structure plus {"{{city}}"}, {"{{job_position}}"}, {"{{main_language}}"}, {"{{keywords}}"}. To keep an
          exact layout instead, add the CV as a .docx.
        </p>

        <details className="rounded-md border border-border bg-muted/20 p-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Template syntax</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{CV_MARKDOWN_SYNTAX}</pre>
          <p className="mt-2 text-muted-foreground">
            A variant can be several lines — e.g. a {"{{go_bullets}}"} placeholder whose variants are whole blocks of
            bullet points, one per stack.
          </p>
        </details>

        <textarea
          aria-label="CV template"
          className="min-h-72 rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-primary"
          placeholder={"# Jane Doe\n{{job_position}} · {{city}}\n\n## Skills\n{{main_language}}, {{keywords}}"}
          value={draft.content}
          onChange={(e) => updateDraft({ ...draft, content: e.target.value })}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex w-fit items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-base font-semibold">Adapt CV</h1>
        <span />
      </div>

      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          CV
          <Select
            value={selectedId ?? ""}
            disabled={cvs.length === 0 || Boolean(busy)}
            onChange={(e) => void handleSelectCv(e.target.value)}
          >
            {cvs.length === 0 && <option value="">No CV uploaded yet</option>}
            {cvs.map((cv) => {
              const count = extractVariableNames(templateForCv(cv, templates).content).length;
              return (
                <option key={cv.id} value={cv.id}>
                  {cv.fileName}
                  {count > 0 ? ` · ${count} placeholder${count === 1 ? "" : "s"}` : ""}
                </option>
              );
            })}
          </Select>
        </label>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          disabled={Boolean(busy)}
          onClick={() => addCvRef.current?.click()}
        >
          <FilePlus className="h-3.5 w-3.5" /> Add CV
        </Button>
        <input
          ref={addCvRef}
          type="file"
          accept={`.pdf,.docx,application/pdf,${DOCX_MIME}`}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleAddCv(file);
            e.target.value = "";
          }}
        />
      </div>

      {busy && <p className="text-xs text-muted-foreground">{busy}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {status && <p className="text-xs text-muted-foreground">{status}</p>}

      {!selectedCv ? (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          Add a CV to adapt. A <span className="font-medium">Word (.docx)</span> CV keeps its exact layout — type{" "}
          {"{{city}}"}, {"{{job_position}}"}, {"{{main_language}}"}… right into it in Word. A PDF CV gets a template
          built here and is exported as a fresh PDF.
        </p>
      ) : (
        <>
          <div className="flex gap-1 border-b border-border text-sm">
            {(["adapt", "template"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setView(tab)}
                className={cn(
                  "-mb-px border-b-2 px-2 py-1",
                  view === tab ? "border-primary font-medium" : "border-transparent text-muted-foreground",
                )}
              >
                {tab === "adapt" ? "For this job" : "Placeholders"}
                {tab === "template" && dirty && <span className="ml-1 text-amber-600">•</span>}
              </button>
            ))}
          </div>

          {view === "adapt"
            ? renderAdaptView()
            : isDocx
              ? renderDocxTemplateView()
              : renderMarkdownTemplateView()}

          {view === "template" && (
            <>
              {draft.variables.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Placeholders</h2>
                  {draft.variables.map((variable, index) => (
                    <VariableEditor
                      key={variable.name}
                      variable={variable}
                      used={usedNames.includes(variable.name)}
                      onChange={(next) => updateVariable(index, next)}
                      onDelete={() =>
                        updateDraft({ ...draft, variables: draft.variables.filter((_, i) => i !== index) })
                      }
                    />
                  ))}
                </div>
              )}
              <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-background py-2">
                <Button size="sm" disabled={!dirty || saveStatus === "saving"} onClick={() => void handleSave()}>
                  {saveStatus === "saving" ? "Saving…" : "Save"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {dirty && "Unsaved changes"}
                  {!dirty && saveStatus === "saved" && "Saved to Drive"}
                  {!dirty && saveStatus === "local-only" && "Saved on this device — Drive save failed"}
                </span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
