import { ArrowUpCircle, Download, ExternalLink, X } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { dismissUpdate } from "@/features/updates/check";
import { useUpdateSnapshot } from "@/features/updates/use-update-snapshot";

/**
 * "A newer Filler is out" (`docs/updates.md`). An unpacked install gets the
 * GitHub release's notes, its `extension.zip` and the three manual steps; a
 * Web Store install gets "Reload to update" (Chrome already downloaded it).
 * Dismissed per version — the next release shows it again.
 */
export function UpdateBanner() {
  const t = useT();
  const snapshot = useUpdateSnapshot();
  const offer = snapshot?.offer;
  if (!snapshot || !offer || offer.version === snapshot.dismissedVersion) return null;

  return (
    <Card className="border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
      <CardContent className="flex items-start gap-2.5 p-3">
        <ArrowUpCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400" />
        <div className="flex min-w-0 flex-1 flex-col gap-2 text-xs">
          <p className="font-medium">
            {t("update.available", { version: offer.version, current: snapshot.currentVersion })}
          </p>
          {offer.kind === "store" ? (
            <>
              <p className="text-muted-foreground">{t("update.storeReady")}</p>
              <div>
                <Button size="sm" onClick={() => chrome.runtime.reload()}>
                  {t("update.reload")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <a
                  href={offer.release.zipUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground hover:opacity-90"
                >
                  <Download className="h-3.5 w-3.5" /> {t("update.download")}
                </a>
                <a
                  href={offer.release.notesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 font-medium hover:bg-muted"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> {t("update.notes")}
                </a>
              </div>
              <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
                <li>{t("update.step1")}</li>
                <li>{t("update.step2")}</li>
                <li>
                  {t("update.step3")}{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })}
                  >
                    {t("update.openExtensions")}
                  </button>
                </li>
              </ol>
            </>
          )}
        </div>
        <button
          type="button"
          aria-label={t("update.dismiss")}
          title={t("update.dismiss")}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => void dismissUpdate(offer.version)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </CardContent>
    </Card>
  );
}
