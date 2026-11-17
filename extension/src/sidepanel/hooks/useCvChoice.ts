import { useEffect, useRef, useState } from "react";
import type { Job } from "@/types/job";
import type { CvMeta } from "@/types/profile";
import { getCvLibrary, setActiveCv } from "@/features/profile/repository";
import { pickCvForPosting, type CvChoice } from "@/features/cv-selection/select";
import { getCvChoiceState, setCvChoiceState } from "@/features/storage/session";
import { getPreferences } from "@/features/storage/sync";
import { sendMessage, type MessageOf } from "@/types/messages";

interface Options {
  tabId: number;
  tabUrl: string;
  active: boolean;
  job: Job;
  postingLanguages: string[] | undefined;
  /** False while the posting or its language is still being read — the pick waits for it. */
  settled: boolean;
  cvMeta: CvMeta | null;
  hasApiKey: boolean;
  onCvChange: (cv: CvMeta) => void;
}

/**
 * Picks this tab's CV once per posting (language + rules, or the AI when
 * enabled) and keeps it applied: the library's active CV is global, so it's
 * re-applied whenever this tab comes back into view. A hand pick
 * (`override`) is stored as `manual` and never replaced automatically.
 */
export function useCvChoice({ tabId, tabUrl, active, job, postingLanguages, settled, cvMeta, hasApiKey, onCvChange }: Options) {
  const [cvs, setCvs] = useState<CvMeta[]>([]);
  const [choice, setChoice] = useState<CvChoice | null>(null);
  const [choosing, setChoosing] = useState(false);
  const jobUrl = job.url || tabUrl;
  const decidedForRef = useRef<string | null>(null);
  const cvMetaRef = useRef(cvMeta);
  cvMetaRef.current = cvMeta;

  useEffect(() => {
    void getCvLibrary()
      .then((library) => setCvs(library.items))
      .catch(() => undefined);
  }, [cvMeta]);

  useEffect(() => {
    if (!settled || !jobUrl || !(job.position || job.description) || decidedForRef.current === jobUrl) return;
    const url = jobUrl;
    decidedForRef.current = url;
    setChoice(null);
    // Not tied to this effect's cleanup: `settled` flickers while the brief loads, and the pick must still land.
    const stale = () => decidedForRef.current !== url;
    void (async () => {
      const stored = await getCvChoiceState(tabId);
      if (stored?.url === url) {
        if (!stale()) setChoice(stored.choice);
        return;
      }
      const prefs = await getPreferences();
      if (!prefs.autoSelectCv) return;
      const library = await getCvLibrary().catch(() => null);
      if (!library || library.items.length < 2) return;
      let picked = pickCvForPosting(library.items, job, postingLanguages);
      if (prefs.aiChooseCv && hasApiKey) {
        setChoosing(true);
        try {
          const response = await sendMessage<MessageOf<"CV_CHOICE">>({
            type: "CHOOSE_CV",
            job,
            cvs: library.items,
            postingLanguage: postingLanguages?.[0],
          });
          picked = response.choice ?? picked;
        } catch {
          // Keep the offline pick.
        } finally {
          setChoosing(false);
        }
      }
      if (!picked || stale()) return;
      setChoice(picked);
      await setCvChoiceState(tabId, { url, choice: picked });
    })();
    // The job's text/language are read once `settled` turns true for this URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, jobUrl, tabId]);

  useEffect(() => {
    if (!active || !choice) return;
    void (async () => {
      // The Adapt CV tab may have stored a hand pick for this posting meanwhile.
      const stored = await getCvChoiceState(tabId);
      const current = stored?.url === jobUrl ? stored.choice : choice;
      if (current.cvId !== choice.cvId) setChoice(current);
      if (cvMetaRef.current?.id === current.cvId) return;
      const meta = await setActiveCv(current.cvId);
      if (meta) onCvChange(meta);
    })();
    // `cvMeta` is deliberately left out: changing the active CV elsewhere must not re-trigger this, only coming back here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, choice?.cvId]);

  async function override(cvId: string) {
    const manual: CvChoice = { cvId, reason: "", source: "manual" };
    setChoice(manual);
    decidedForRef.current = jobUrl;
    if (jobUrl) await setCvChoiceState(tabId, { url: jobUrl, choice: manual });
  }

  return { cvs, choice, choosing, override };
}
