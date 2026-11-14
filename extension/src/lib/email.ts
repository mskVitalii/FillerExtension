const EMAIL_ADDRESS_RE = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

/** True when an outreach contact (`Job.contact`) is an email address rather than a LinkedIn URL. */
export function isEmailAddress(contact: string): boolean {
  return EMAIL_ADDRESS_RE.test(contact.trim());
}
