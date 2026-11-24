import { useState } from "react";
import { useT } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { runUpdateCheck } from "@/features/updates/check";
import { useUpdateSnapshot } from "@/features/updates/use-update-snapshot";

/** Settings → About: the installed version and a manual "Check for updates" (`docs/updates.md`). */
export function AboutCard() {
  const t = useT();
  const snapshot = useUpdateSnapshot();
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    try {
      await runUpdateCheck({ force: true });
    } finally {
      setChecking(false);
    }
  }

  const state = snapshot?.state;
  let status = "";
  if (snapshot) {
    if (snapshot.offer) status = t("update.statusAvailable", { version: snapshot.offer.version });
    else if (state?.error) status = t("update.statusFailed", { error: state.error });
    else if (state) status = t("update.statusCurrent");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("update.about")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm">
          {t("update.version", { version: chrome.runtime.getManifest().version })}{" "}
          <span className="text-muted-foreground">
            · {snapshot?.storeInstall ? t("update.sourceStore") : t("update.sourceGitHub")}
          </span>
        </p>
        {status && <p className="text-xs text-muted-foreground">{status}</p>}
        {state?.checkedAt ? (
          <p className="text-xs text-muted-foreground">
            {t("update.checkedAt", { time: new Date(state.checkedAt).toLocaleString() })}
          </p>
        ) : null}
        <div>
          <Button size="sm" variant="outline" disabled={checking} onClick={() => void checkNow()}>
            {checking ? t("update.checking") : t("update.checkNow")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
