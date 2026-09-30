/**
 * The automatic site-trust check: on a login or payment page, or a site
 * with suspicious signs, Iris checks the site by itself and says nothing unless it looks
 * risky. A risky site is warned about once per moment: once for the site, once at its login
 * form, once at a payment form (remembered per tab in the widget, and while the side panel
 * is open). The backend caches the check by domain, so asking again costs nothing.
 */
import type { CreatePageResponse, IrisApi, PageSnapshot } from './api';
import { COPY } from './copy';
import type { NudgeEngine } from './nudges';
import { addCard, type IrisStore } from './store';

const PAYMENT_LABEL_RE = /card|cvv|cvc|expiry|upi pin|mpin/i;
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

/** When Iris warns about a risky site: on arrival, at its login form, at a payment form. */
export type TrustMoment = 'site' | 'login' | 'payment';

/** What's known about a site already checked. */
export interface SiteRecord {
  risky: boolean;
  warned: TrustMoment[];
}

export interface CheckedSites {
  get(host: string): SiteRecord | null;
  set(host: string, record: SiteRecord): void;
}

export function memorySites(): CheckedSites {
  const sites = new Map<string, SiteRecord>();
  return {
    get: (host) => sites.get(host) ?? null,
    set: (host, record) => void sites.set(host, record),
  };
}

/** The widget: per tab, across page loads. Storage can fail; then it lasts one page. */
export function sessionSites(key = 'iris.checked-sites'): CheckedSites {
  const read = (): Record<string, SiteRecord> => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, SiteRecord>;
    } catch {
      return {};
    }
  };
  return {
    get: (host) => read()[host] ?? null,
    set: (host, record) => {
      try {
        sessionStorage.setItem(key, JSON.stringify({ ...read(), [host]: record }));
      } catch {
        // Blocked storage: the next page may check again (the backend caches the result).
      }
    },
  };
}

/** This computer or a private network: the backend can't check it anyway. */
export function isLocalHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost' || LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  if (!name.includes('.') && !name.includes(':')) return true;
  if (name === '::1' || name.startsWith('fe80:') || /^f[cd]/.test(name)) return true;
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(name);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** The first password field, or failing that the first payment field (card, CVV, UPI PIN). */
export function loginOrPaymentField(
  snapshot: PageSnapshot,
): { id: string; kind: 'login' | 'payment' } | null {
  const password = snapshot.fields.find((field) => field.type === 'password');
  if (password) return { id: password.id, kind: 'login' };
  const payment = snapshot.fields.find(
    (field) => field.sensitive && PAYMENT_LABEL_RE.test(field.label),
  );
  return payment ? { id: payment.id, kind: 'payment' } : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export interface TrustWatchDeps {
  api: Pick<IrisApi, 'tool'>;
  store: IrisStore;
  nudges: () => NudgeEngine | null;
  checked: CheckedSites;
}

export class TrustWatch {
  constructor(private readonly deps: TrustWatchDeps) {}

  /** A new document was registered: check the site if it asks for a login or payment. */
  async onNewDocument(snapshot: PageSnapshot, response: CreatePageResponse): Promise<void> {
    const { api, store, checked } = this.deps;
    const nudges = this.deps.nudges();
    const host = hostOf(snapshot.url);
    if (!host || isLocalHost(host) || !nudges?.allowed) return;
    const field = loginOrPaymentField(snapshot);
    const moment: TrustMoment = field?.kind ?? 'site';
    const record = checked.get(host);
    // A site that looked fine, or a moment already warned about, needs nothing more.
    if (record && (!record.risky || record.warned.includes(moment))) return;
    if (!record && !field && response.site_signals.length === 0) return;
    let result;
    try {
      result = await api.tool('site-trust', { url: snapshot.url });
    } catch {
      return;
    }
    const card = result.card;
    if (card?.kind !== 'trust') return;
    const risky = card.verdict !== 'looks_ok';
    checked.set(host, { risky, warned: risky ? [...(record?.warned ?? []), moment] : [] });
    if (card.verdict === 'looks_ok') return;
    addCard(store, 'check_site_trust', result);
    nudges.onTrustWarning({
      key: `trust:${card.domain}:${moment}`,
      verdict: card.verdict,
      say: COPY.trustWarning(field?.kind ?? null, result.say),
      notice: COPY.trustNotice(card.lead),
      element_id: field?.id ?? null,
    });
  }
}
