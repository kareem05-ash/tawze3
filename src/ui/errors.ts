import { ar } from '../i18n/ar';
import { ServiceError } from '../services/common';

/** Turns any thrown value into a message that is safe and useful to show to the user (Arabic). */
export function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.message;
  if (e instanceof Error && /[\u0600-\u06FF]/.test(e.message)) return e.message; // domain validation messages are already Arabic
  console.error(e);
  return ar.common.unexpected;
}
