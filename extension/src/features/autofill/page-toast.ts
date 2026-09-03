/**
 * A small on-page toast for actions that would otherwise be completely
 * silent — chiefly the right-click "Insert" action, which used to give no
 * feedback at all whether it worked, found nothing to insert into, or had
 * nothing to insert (spec_2 item 5 follow-up: users reported the feature
 * "never worked" with no way to tell why from a silent no-op).
 */
export type ToastTone = "success" | "error";

const TONE_BACKGROUND: Record<ToastTone, string> = {
  success: "#111827",
  error: "#7f1d1d",
};

export function showPageToast(message: string, tone: ToastTone = "success"): void {
  const toast = document.createElement("div");
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    zIndex: "2147483647",
    background: TONE_BACKGROUND[tone],
    color: "#f9fafb",
    padding: "10px 14px",
    borderRadius: "8px",
    fontSize: "13px",
    fontFamily: "system-ui, sans-serif",
    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
    maxWidth: "320px",
    userSelect: "text",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}
