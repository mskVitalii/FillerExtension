import { useEffect, useState } from "react";
import { ListPlus } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { linkedInPageKind } from "@/features/linkedin-collector/links";
import {
  getLinkedInCollectorSettings,
  hasLinkedInPermission,
  requestLinkedInPermission,
  setLinkedInCollectorEnabled,
} from "@/features/linkedin-collector/registration";

/**
 * On a LinkedIn job search / job page while the on-page "Add" buttons are off: offers to switch
 * them on right here (they are off by default and otherwise live in Job Search → From LinkedIn).
 * The buttons then appear on the open LinkedIn tabs without a reload (registration.ts).
 */
export function LinkedInCollectorBanner({ url }: { url: string }) {
  const t = useT();
  const onJobsPage = linkedInPageKind(url) !== null;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!onJobsPage) return;
    void Promise.all([getLinkedInCollectorSettings(), hasLinkedInPermission()]).then(([settings, granted]) => setEnabled(settings.enabled && granted));
  }, [onJobsPage]);

  if (!onJobsPage || enabled !== false) return null;

  function handleEnable() {
    // The permission prompt needs this click's user gesture — no await before it.
    void requestLinkedInPermission().then(async (granted) => {
      setDenied(!granted);
      if (!granted) return;
      await setLinkedInCollectorEnabled(true);
      setEnabled(true);
    });
  }

  return (
    <Card className="border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30">
      <CardContent className="flex items-start gap-2.5 p-3">
        <ListPlus className="mt-0.5 h-4 w-4 shrink-0 text-sky-700 dark:text-sky-400" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-xs">{t("linkedin.bannerText")}</p>
          <div>
            <Button size="sm" onClick={handleEnable}>
              {t("linkedin.enable")}
            </Button>
          </div>
          {denied && <p className="text-xs text-destructive">{t("linkedin.denied")}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
