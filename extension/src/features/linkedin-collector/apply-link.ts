/**
 * The employer's own application link behind LinkedIn's "Apply ↗" button (jobs that apply off
 * LinkedIn), read from the DOM already rendered — never by clicking it. LinkedIn wraps it in its
 * own redirect, e.g.
 *   https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fbolt.eu%2Fen%2Fcareers%2Fpositions%2F%3Fashby_jid%3D…&urlhash=…
 * (also `/redir/redirect/?url=`, `/jobs/view/externalApply/<id>?url=`). The `url` parameter is the
 * employer's page; the agent goes there directly, never through LinkedIn. An Easy Apply job has no
 * such link: "".
 *
 * Extension only — FillerAgent must not import anything from `linkedin-collector/`.
 */

const LINKEDIN_HOST_RE = /(?:^|\.)linkedin\.[a-z.]+$/i;
/** LinkedIn's own redirect wrappers, whose `url` parameter is the destination. */
const WRAPPER_PATH_RE = /^\/(?:safety\/go|redir\/redirect|jobs\/view\/externalApply)(?:\/|$)/;
/** "Apply", "Apply on company website", "Bewerben", "Jetzt bewerben", "Откликнуться", "Postuler"… */
const APPLY_LABEL_RE = /\b(?:apply|bewerb\w*|postuler|candidat\w*|solicitar|candidatura)\b|откликнуться/i;
const EASY_APPLY_RE = /easy apply|einfach bewerben|candidature simplifiée|solicitud sencilla|простой отклик/i;
/** Tracking parameters that only tell the employer where the click came from. */
const TRACKING_PARAM_RE = /^(?:utm_\w+|trk|trackingId|refId|lipi|gclid|fbclid)$/i;

/** The panel of the selected job (search pages) or the posting's top card (`/jobs/view/`). */
const DETAILS_SELECTOR = [
  "[data-sdui-screen*='JobDetails']",
  ".jobs-search__job-details",
  ".jobs-details",
  ".job-view-layout",
  ".jobs-unified-top-card",
].join(", ");

/** The description box: its links (company site, benefits) also go through `/safety/go/`, but they aren't "Apply". */
const DESCRIPTION_SELECTOR = "[componentkey^='JobDetails_AboutTheJob_'], .jobs-description, .jobs-box__html-content, #job-details";

/** A destination as the employer's own http(s) URL, without tracking parameters; "" for LinkedIn itself or anything else. */
export function cleanEmployerUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || LINKEDIN_HOST_RE.test(url.hostname)) return "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM_RE.test(key)) url.searchParams.delete(key);
  return url.toString();
}

/** The employer URL a LinkedIn link leads to: the `url` of a redirect wrapper, or the link itself when it's off LinkedIn. */
export function unwrapLinkedInRedirect(href: string, base = "https://www.linkedin.com/"): string {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return "";
  }
  if (!LINKEDIN_HOST_RE.test(url.hostname)) return cleanEmployerUrl(url.toString());
  if (!WRAPPER_PATH_RE.test(url.pathname)) return "";
  return cleanEmployerUrl(url.searchParams.get("url"));
}

function labelOf(el: Element): string {
  return `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`.replace(/\s+/g, " ").trim();
}

/** The employer's application URL of the selected / shown job, from its "Apply" link; "" when there is none (Easy Apply). */
export function employerApplyUrl(doc: Document): string {
  const roots = [...doc.querySelectorAll(DETAILS_SELECTOR)];
  for (const root of roots.length ? roots : [doc.body ?? doc.documentElement]) {
    for (const link of root.querySelectorAll("a[href]")) {
      if (link.closest(DESCRIPTION_SELECTOR)) continue;
      const label = labelOf(link);
      if (!APPLY_LABEL_RE.test(label) || EASY_APPLY_RE.test(label)) continue;
      const url = unwrapLinkedInRedirect(link.getAttribute("href") ?? "");
      if (url) return url;
    }
  }
  return "";
}
