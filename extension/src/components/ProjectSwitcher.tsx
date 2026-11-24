import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DEFAULT_PROJECT_ID, projectLabel, type Project } from "@/features/projects/registry";
import { createProject, deleteProject, getActiveProjectId, listProjects, renameProject, setActiveProject } from "@/features/projects/store";

/** Set before the panel reloads into a project just created: it opens Settings there (App.tsx). */
export const NEW_PROJECT_FLAG = "filler.newProject";

type Mode = { kind: "idle" } | { kind: "create" } | { kind: "rename" } | { kind: "delete" };

/**
 * The project picker in the Side Panel header (FillerAgent `docs/projects.md`): switch, create,
 * rename, delete (with a confirmation). Switching changes `activeProjectId`; every open panel then
 * reloads into that project (App.tsx listens for it).
 */
export function ProjectSwitcher() {
  const t = useT();
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState(DEFAULT_PROJECT_ID);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [list, id] = await Promise.all([listProjects(), getActiveProjectId()]);
    setProjects(list);
    setActive(id);
  }

  useEffect(() => {
    void load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && ("projects" in changes || "activeProjectId" in changes)) void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const current = projects.find((p) => p.id === active);
  const label = (p: Project) => projectLabel(p, t("projects.default"));

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      setMode({ kind: "idle" });
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode.kind === "create") {
      void run(async () => {
        const project = await createProject(name);
        sessionStorage.setItem(NEW_PROJECT_FLAG, project.name);
        await setActiveProject(project.id);
      });
    } else if (mode.kind === "rename") {
      void run(() => renameProject(active, name));
    }
  }

  if (mode.kind === "create" || mode.kind === "rename") {
    return (
      <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-1">
        <Input
          autoFocus
          className="h-7 min-w-0 flex-1 text-xs"
          aria-label={mode.kind === "create" ? t("projects.new") : t("projects.rename")}
          placeholder={t("projects.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setMode({ kind: "idle" })}
        />
        <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={!name.trim()}>
          {mode.kind === "create" ? t("common.create") : t("common.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setMode({ kind: "idle" })}>
          {t("common.cancel")}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </form>
    );
  }

  if (mode.kind === "delete" && current) {
    return (
      <div role="alertdialog" aria-label={t("projects.delete")} className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs">
        <span className="min-w-0">{t("projects.deleteConfirm", { name: label(current) })}</span>
        <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={() => void run(() => deleteProject(current.id))}>
          {t("projects.deleteYes")}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setMode({ kind: "idle" })}>
          {t("common.cancel")}
        </Button>
        {error && <span className="text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <Select
        className="h-7 w-auto min-w-0 max-w-[11rem] truncate py-0 pl-2 pr-7 text-xs"
        aria-label={t("projects.label")}
        value={active}
        onChange={(e) => void run(() => setActiveProject(e.target.value))}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {label(p)}
          </option>
        ))}
      </Select>
      <IconButton
        label={t("projects.new")}
        onClick={() => {
          setName("");
          setMode({ kind: "create" });
        }}
      >
        <Plus />
      </IconButton>
      <IconButton
        label={t("projects.rename")}
        onClick={() => {
          setName(current ? label(current) : "");
          setMode({ kind: "rename" });
        }}
      >
        <Pencil />
      </IconButton>
      {active !== DEFAULT_PROJECT_ID && (
        <IconButton label={t("projects.delete")} onClick={() => setMode({ kind: "delete" })}>
          <Trash2 />
        </IconButton>
      )}
    </div>
  );
}
