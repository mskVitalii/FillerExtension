import { Lock } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface TabAccessBannerProps {
  url: string;
  onAllowSite: () => void;
  onAllowAll: () => void;
}

/**
 * The panel stays open across tab switches, but switching tabs isn't a user
 * gesture on the extension, so a tab reached that way has no activeTab grant
 * and its page can't be read. Clicking the toolbar icon on it fixes that for
 * this tab; allowing the site (or every site, through
 * `optional_host_permissions`) fixes it for good, so the next tab just works.
 * Both requests must run in the button's own click handler.
 */
export function TabAccessBanner({ url, onAllowSite, onAllowAll }: TabAccessBannerProps) {
  const host = hostOf(url);
  const t = useT();
  return (
    <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
      <CardContent className="flex items-start gap-2.5 p-3">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-xs">
            {t("access.cantRead", { host: host ?? t("access.thisTab") })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onAllowAll}>
              {t("access.allowAll")}
            </Button>
            {host && (
              <Button size="sm" variant="outline" onClick={onAllowSite}>
                {t("access.allowOn", { host })}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
