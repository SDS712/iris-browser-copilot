/**
 * Privacy rules. Iris never reads what the user typed: a field is only ever
 * checked for being empty, and the answer is a boolean.
 */
export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const SENSITIVE_AUTOCOMPLETE = new Set([
  'cc-number',
  'cc-csc',
  'cc-exp',
  'one-time-code',
  'current-password',
  'new-password',
]);

const SENSITIVE_RE =
  /(password|passcode|otp|one.?time|\bpin\b|cvv|cvc|card.?number|account.?(no|number)|aadhaar|upi.?pin)/i;

export function isSensitive(el: FormControl, label: string): boolean {
  if (el instanceof HTMLInputElement && el.type.toLowerCase() === 'password') return true;
  const tokens = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
  if (tokens.some((token) => SENSITIVE_AUTOCOMPLETE.has(token))) return true;
  return [label, el.getAttribute('name') ?? '', el.id].some((text) => SENSITIVE_RE.test(text));
}

/** Whether the field has anything in it. The value itself never leaves this function. */
export function isFilled(el: FormControl): boolean {
  return el.value.length > 0;
}
