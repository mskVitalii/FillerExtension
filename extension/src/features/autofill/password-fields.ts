/**
 * Deciding a `type="password"` box is a *create-a-password* field (so
 * Autofill / Insert should put a freshly generated password into it) rather
 * than a login field, which must be left alone.
 *
 * `autocomplete="new-password"` is the one unambiguous marker, but plenty of
 * ATS registration forms (SAP SuccessFactors, rexx, softgarden…) never set
 * it — the live example that motivated this used `autocomplete="off"`. So we
 * fall back to the cluster of signals a create-password flow always carries:
 *
 *  - a password-policy / strength handler wired to the field
 *    (`onkeyup="checkPasswordPolicy(…)"`)
 *  - `aria-describedby` pointing at a strength meter / policy progress bar
 *  - a "choose / set / confirm your password" label, in EN or DE
 *  - a sibling confirmation password field in the same form
 *
 * A field explicitly marked `autocomplete="current-password"` is always
 * excluded, whatever else it looks like.
 */

const CONFIRM_TOKEN_RE =
  /conf|confirm|repeat|re-?type|re-?enter|verif|wiederhol|best(?:a|ä|ae)tig|erneut|again|_2\b|2$/i;

const POLICY_HANDLER_RE =
  /password\s*polic|password\s*strength|passwordstrength|pwd?polic|checkpassword|validatepassword|passwort(?:st(?:a|ä|ae)rke|richtlinie)|zxcvbn/i;

const POLICY_DESCRIBEDBY_RE =
  /pwd?polic|passwordpolic|pw-?strength|passwordstrength|strength\s*meter|password\s*meter|pwd?meter|pwd?progress|progress\w*pwd|pwd\w*progress/i;

const CREATE_TEXT_RE =
  /(?:choose|create|set up|set a|new|confirm|repeat|re-?enter|re-?type)\s+(?:a\s+|your\s+)?(?:pass\s?word|pass\s?phrase|kennwort|passwort)|(?:kennwort|passwort|pass\s?word)\s+(?:again|erneut|wiederhol|best(?:a|ä|ae)tig|festlegen|w(?:a|ä|ae)hlen|erstellen|vergeben)|w(?:a|ä|ae)hlen sie ein (?:kennwort|passwort)|neues?\s+(?:kennwort|passwort)/i;

const HANDLER_ATTRS = ["onkeyup", "onkeydown", "oninput", "onblur", "onchange", "onfocus"];

function autocompleteToken(el: HTMLInputElement): string {
  return el.getAttribute("autocomplete")?.toLowerCase().trim() ?? "";
}

function isPasswordInput(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === "password" && !el.disabled;
}

/** Label text tied to `el` via `for=`, a wrapping `<label>`, or `aria-labelledby`. */
function labelText(el: HTMLInputElement): string {
  const doc = el.ownerDocument;
  const id = el.getAttribute("id");
  if (id) {
    const label = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent) return label.textContent;
  }
  const wrapping = el.closest("label");
  if (wrapping?.textContent) return wrapping.textContent;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((refId) => doc.getElementById(refId)?.textContent ?? "")
      .join(" ");
  }
  return "";
}

/** Just the inline event-handler source on `el`, concatenated. */
function handlerText(el: HTMLInputElement): string {
  return HANDLER_ATTRS.map((attr) => el.getAttribute(attr) ?? "").join(" ");
}

/** Everything readable about `el` except its handlers (name, id, aria, label, describedby targets). */
function describeText(el: HTMLInputElement): string {
  const parts = [
    el.name,
    el.id,
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("placeholder") ?? "",
    el.getAttribute("title") ?? "",
    labelText(el),
  ];
  const describedBy = el.getAttribute("aria-describedby");
  if (describedBy) {
    parts.push(describedBy);
    for (const refId of describedBy.split(/\s+/)) {
      const ref = el.ownerDocument.getElementById(refId);
      if (ref) parts.push(ref.id, ref.className, ref.textContent ?? "");
    }
  }
  return parts.join(" ");
}

function shortDescribe(el: HTMLInputElement): string {
  return [el.name, el.id, el.getAttribute("aria-label") ?? "", el.getAttribute("placeholder") ?? ""].join(" ");
}

function formPasswords(el: HTMLInputElement): HTMLInputElement[] {
  const form = el.form ?? el.closest("form");
  if (!form) return [];
  return Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(isPasswordInput);
}

/**
 * True when `el` is a field where the user is meant to *set* a password —
 * safe to fill with a generated value. Login fields return false.
 */
export function isNewPasswordField(el: Element): el is HTMLInputElement {
  if (!isPasswordInput(el)) return false;

  const autocomplete = autocompleteToken(el);
  if (autocomplete === "current-password") return false;
  if (autocomplete === "new-password") return true;

  const handlers = handlerText(el);
  if (POLICY_HANDLER_RE.test(handlers)) return true;
  // A handler that passes a confirmation field as an argument —
  // `checkPolicy(event, fbclc_pwdConf, true)` — is a create-password tell.
  if (/[(,]\s*[\w.$]*(?:conf|confirm|verif|wiederhol|bestat|bestaetig)[\w.$]*\s*[,)]/i.test(handlers)) return true;

  const description = describeText(el);
  if (POLICY_DESCRIBEDBY_RE.test(description)) return true;
  if (CREATE_TEXT_RE.test(`${description} ${handlers}`)) return true;

  // A sibling confirmation password field means this one is where the new
  // password gets set.
  const siblings = formPasswords(el).filter((p) => p !== el);
  if (siblings.some((p) => CONFIRM_TOKEN_RE.test(shortDescribe(p)))) return true;

  return false;
}

/**
 * The confirmation field(s) that should get the *same* generated password as
 * `field` — matched by name first, then the classic unnamed "password +
 * confirm" pair. `current-password` fields are never returned.
 */
export function findConfirmPasswordFields(field: HTMLInputElement): HTMLInputElement[] {
  const others = formPasswords(field).filter(
    (p) => p !== field && autocompleteToken(p) !== "current-password",
  );

  const named = others.filter((p) => CONFIRM_TOKEN_RE.test(shortDescribe(p)));
  if (named.length > 0) return named;

  // Unnamed classic pair: exactly one other non-login password field.
  if (others.length === 1) return others;
  return [];
}
