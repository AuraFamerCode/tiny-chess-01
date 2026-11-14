// Sign-up acquisition: the first non-direct touch that brought a browser to make.fun, stored once per account at
// sign-up (account_acquisition). One grammar for every reader, the browser that records the touch and the server that
// stores it, so neither may write or accept a value this file would not:
//
//   Acquisition            { source, medium, campaign, content, referrerHost }, each a tag or null
//   acqTag / acqHost       the shape of one tag (a utm value, a click id's network) and of a referring host
//   acquisitionOf          a landing's touch: the rule of src/lib/ga4.ts ga4AcqOf, null where GA writes (not set)
//   pack/parseAcquisition  the five fields as one `~`-joined value (the mf_acq cookie, the handoff's tail)
//   acquisitionOfCookie    the touch a request's Cookie header carries
//   split/joinHandoff      the `ga` handoff value: `<ga>`, `<ga>~<packed>` or `<ga>~<packed>~<arm>` (below)
//   isHandoffArm           the arm field's shape: the first_win_bonus cookie's value `<arm>.<browser id>`
//
// The touch rides the existing `ga` handoff value (POST /api/auth/solana/key's `ga`, the CLI's --ga) as a tail after
// the first `~`, never a new body field: the key route's body is strict and old kits refuse unknown flags. So does the
// browser's first_win_bonus assignment, as an optional sixth tail field after the touch: the value of its
// mf_ab_first_win_bonus cookie verbatim (server/api-types/experiments.ts: `control` or `offer`, a `.`, then a browser
// id of 16 to 64 of [A-Za-z0-9_-], case-sensitive, never lowercased on its way), which the key mint that makes the
// account binds it to (server/experiments/bind.ts), as the cookie binds a browser's own sign-up. Only that test rides
// it. So a value is one part (`<ga>`), six (`<ga>~<source>~<medium>~<campaign>~<content>~<referrer host>`) or seven
// (`<ga>~<source>~<medium>~<campaign>~<content>~<referrer host>~<arm>.<browser id>`); with an arm and no touch the
// five touch fields are empty (`<ga>~~~~~~offer.<id>`), and with no GA half the value opens with `~`. A handoff
// without a touch or an arm stays byte for byte what it was, and one with a touch and no arm too.
//
// Every `ga` reader allows 256 characters (HANDOFF_MAX: server/routes/solana-auth.ts GA_MAX, cli/register.ts GA_MAX,
// which kits already unpacked enforce). The longest value without an arm is 46 (server/ga4.ts GA4_HANDOFF_MAX) + 1 +
// ACQ_PACKED_MAX = 251; an arm adds up to 73 (`~`, `control`, `.`, 64), so joinHandoff leaves the arm alone off where it
// would pass HANDOFF_MAX and writes the rest as it would without one. A malformed arm field is ignored by every reader,
// never refused, and costs neither the GA half nor the touch.
//
// No PII: a tag is a campaign's own label and a host is a site's hostname alone, never a path or a query; no `@`, space
// or `~` survives a tag, and a browser id is a random draw of the browser's. No Node APIs and no DOM: safe for the Vite
// app and the node server alike. Not listed in contracts/index.ts (as contracts/ga4.ts is not).

import { EXPERIMENT_BROWSER_ID_RE, FIRST_WIN_BONUS_ARMS } from '../server/api-types/experiments.ts';
import { GA4_CLICK_IDS } from './ga4.ts';

/** The first-touch cookie: the packed Acquisition, set on a non-direct landing while the browser holds none and is signed out. Not HttpOnly. */
export const ACQ_COOKIE = 'mf_acq';
/** How long the first-touch cookie lasts, in days. */
export const ACQ_COOKIE_DAYS = 90;
/** The longest tag (source, medium, campaign, content). */
export const ACQ_TAG_MAX = 40;
/** The longest referring host. */
export const ACQ_HOST_MAX = 40;
/** The longest packed Acquisition: four tags, a host and four `~`. */
export const ACQ_PACKED_MAX = 4 * ACQ_TAG_MAX + ACQ_HOST_MAX + 4;
/** A tag's shape. */
export const ACQ_TAG_RE = /^[a-z0-9._-]{1,40}$/;
/** A referring host's shape. */
export const ACQ_HOST_RE = /^[a-z0-9.-]{1,40}$/;

/** The longest `ga` handoff value any reader takes (see the header): joinHandoff leaves the arm off rather than pass it. */
export const HANDOFF_MAX = 256;

/** The separator of the packed fields, and of the handoff's `ga` from its packed tail and of that from its arm. No tag, host or arm may hold it. */
const SEP = '~';

/**
 * A search engine's host (`www.` already dropped), whose referral is organic: src/lib/ga4.ts SEARCH_ENGINE_RE, one
 * pattern on both sides. Any host on an engine's domain in any country (google.com, news.google.com, google.co.uk,
 * search.yahoo.com, bing.com, duckduckgo.com, baidu.com…) and any search. host (search.aol.com). A sign-in return from
 * accounts.google.* never reaches it (SIGN_IN_HOST_RE).
 */
const SEARCH_ENGINE_RE = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|brave|startpage|kagi)\.[a-z.]+$|^search\./i;
/**
 * A sign-in provider's page that sends the visitor straight back after an OAuth sign-in (Sign in with Google returns from
 * accounts.google.com; src/lib/ga4.ts SIGN_IN_HOST_RE): a return to the site, not a new touch, so it reads as a
 * self-referral does (no referring host, no touch) and the landing kept before the sign-in stands.
 */
const SIGN_IN_HOST_RE = /^accounts\.google\.[a-z.]+$/i;

/** Whether a referring host (bare, never cut, as the browser judges it) is a search engine's: its referral is organic. */
const isSearchHost = (host: string): boolean => SEARCH_ENGINE_RE.test(host);

/** What each ad network's click id marks as a medium (src/lib/ga4.ts CLICK_ID_MEDIUM): the search networks cpc, the rest paid_social. */
const CLICK_ID_MEDIUM: Readonly<Record<string, string>> = { google: 'cpc', microsoft: 'cpc' };

/** The utm keys that mark a landing as tagged (ga4AcqOf's: utm_term and utm_id do not). */
const UTM_TAGGED = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;

/** A first touch. Each field is a tag (ACQ_TAG_RE; referrerHost ACQ_HOST_RE) or null where GA4 would write (not set). */
export interface Acquisition {
  readonly source: string | null;
  readonly medium: string | null;
  readonly campaign: string | null;
  readonly content: string | null;
  readonly referrerHost: string | null;
}

/** The packed order of the fields. */
const FIELDS = ['source', 'medium', 'campaign', 'content', 'referrerHost'] as const;

/**
 * A tag: trimmed, lowercased, each run of characters outside [a-z0-9._-] written as one `_`, a leading or trailing `_`
 * dropped, cut to ACQ_TAG_MAX. Null when nothing is left. `My Clip #1` reads `my_clip_1`.
 */
export function acqTag(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const tag = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, ACQ_TAG_MAX)
    .replace(/_+$/, '');
  return ACQ_TAG_RE.test(tag) ? tag : null;
}

/** A host as compared: lowercased, one trailing `.` (the root) and a leading `www.` dropped. */
const bareHost = (host: string): string => host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

/** An external referrer's whole bare host, or null: acqHost's rule before the cut to ACQ_HOST_MAX. */
function externalHost(referrer: string | null | undefined, ownHosts: readonly string[]): string | null {
  if (typeof referrer !== 'string' || referrer.trim() === '') return null;
  let from: URL;
  try {
    from = new URL(referrer.trim());
  } catch {
    return null;
  }
  if (from.protocol !== 'http:' && from.protocol !== 'https:') return null;
  const host = bareHost(from.hostname);
  if (host === '' || SIGN_IN_HOST_RE.test(host) || ownHosts.some((own) => bareHost(own) === host)) return null;
  return ACQ_HOST_RE.test(host.slice(-ACQ_HOST_MAX)) ? host : null;
}

/**
 * The referring host of a referrer URL: an http(s) URL's hostname, lowercased, a leading `www.` dropped, the last
 * ACQ_HOST_MAX characters of a longer one. Null for anything else: not a URL, not http(s), one of `ownHosts` (the
 * site's own: a referral from itself is no touch), a sign-in provider's return (SIGN_IN_HOST_RE: accounts.google.com,
 * read as a self-referral is), or a host outside [a-z0-9.-] (an IP v6 literal). Never a path or a query.
 */
export function acqHost(referrer: string | null | undefined, ownHosts: readonly string[]): string | null {
  return externalHost(referrer, ownHosts)?.slice(-ACQ_HOST_MAX) ?? null;
}

/** An Acquisition whose fields are all null is no touch. */
const isEmpty = (a: Acquisition): boolean => FIELDS.every((field) => a[field] === null);

/**
 * The first touch a landing carries, or null for a direct one: the rule of src/lib/ga4.ts ga4AcqOf, with null where GA
 * writes (not set). A utm tag (source, medium, campaign or content) or an ad click id (contracts/ga4.ts GA4_CLICK_IDS)
 * gives source (utm_source, else the click id's network), medium (utm_medium, else cpc for google and microsoft,
 * paid_social for the rest), campaign and content, plus the referring host. With neither, an external referrer gives
 * source = its host and medium organic (a search engine, SEARCH_ENGINE_RE, judged on the whole host before its cut) or
 * referral; a sign-in provider's return (accounts.google.com) is no touch. `href` is
 * the landing URL, `referrer` the document's referrer, `ownHosts` the site's own hosts (contracts/ga4.ts
 * GA4_HOSTS.hosts); the landing's own host is never external either.
 */
export function acquisitionOf(href: string, referrer: string | null | undefined, ownHosts: readonly string[]): Acquisition | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const hosts = url.hostname === '' ? ownHosts : [...ownHosts, url.hostname];
  const external = externalHost(referrer, hosts);
  const referrerHost = external?.slice(-ACQ_HOST_MAX) ?? null;
  const query = url.searchParams;
  const clickId = Object.keys(GA4_CLICK_IDS).find((key) => query.has(key));
  const network: string | null = clickId ? GA4_CLICK_IDS[clickId as keyof typeof GA4_CLICK_IDS] : null;
  const tagged = UTM_TAGGED.some((key) => (query.get(key) ?? '').trim() !== '');
  if (tagged || network) {
    // `||` as ga4AcqOf has it: a utm_source that is present but blank still wins over the network (GA writes (not set)).
    const touch: Acquisition = {
      source: acqTag(query.get('utm_source') || network),
      medium: acqTag(query.get('utm_medium') || (network ? (CLICK_ID_MEDIUM[network] ?? 'paid_social') : null)),
      campaign: acqTag(query.get('utm_campaign')),
      content: acqTag(query.get('utm_content')),
      referrerHost,
    };
    return isEmpty(touch) ? null : touch;
  }
  if (external === null || referrerHost === null) return null;
  return {
    source: referrerHost,
    medium: isSearchHost(external) ? 'organic' : 'referral',
    campaign: null,
    content: null,
    referrerHost,
  };
}

/** A field's shape: a tag's, or a host's for referrerHost. */
const shapeOf = (field: (typeof FIELDS)[number]): RegExp => (field === 'referrerHost' ? ACQ_HOST_RE : ACQ_TAG_RE);

/**
 * The five fields joined by `~` in the order source, medium, campaign, content, referrerHost, a null field empty. Null
 * when every field is null, or when one is not in its shape (so whatever this packs, parseAcquisition reads back).
 */
export function packAcquisition(a: Acquisition | null | undefined): string | null {
  if (!a || isEmpty(a)) return null;
  const parts: string[] = [];
  for (const field of FIELDS) {
    const value = a[field];
    if (value === null) parts.push('');
    else if (typeof value === 'string' && shapeOf(field).test(value)) parts.push(value);
    else return null;
  }
  return parts.join(SEP);
}

/** A packed Acquisition: exactly five `~`-separated fields, each empty or in its shape, at least one set, at most ACQ_PACKED_MAX characters. Anything else is null. */
export function parseAcquisition(packed: string | null | undefined): Acquisition | null {
  if (typeof packed !== 'string' || packed === '' || packed.length > ACQ_PACKED_MAX) return null;
  const parts = packed.split(SEP);
  if (parts.length !== FIELDS.length) return null;
  const values: (string | null)[] = [];
  for (const [i, field] of FIELDS.entries()) {
    const part = parts[i] as string;
    if (part === '') values.push(null);
    else if (shapeOf(field).test(part)) values.push(part);
    else return null;
  }
  const [source, medium, campaign, content, referrerHost] = values as [string | null, string | null, string | null, string | null, string | null];
  const a: Acquisition = { source, medium, campaign, content, referrerHost };
  return isEmpty(a) ? null : a;
}

/** The first well-shaped `mf_acq` of a Cookie header (a quoted value unquoted), else null. */
export function acquisitionOfCookie(cookieHeader: string | null | undefined): Acquisition | null {
  if (typeof cookieHeader !== 'string' || cookieHeader === '') return null;
  for (const pair of cookieHeader.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0 || pair.slice(0, eq).trim() !== ACQ_COOKIE) continue;
    let value = pair.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    const a = parseAcquisition(value);
    if (a) return a;
  }
  return null;
}

/**
 * A handoff split in its three parts (see the header): `ga` the GA browser handoff before the first `~`, `packed` the
 * packed Acquisition after it, `arm` the first_win_bonus cookie's value after the touch. None is validated; an empty
 * part is null.
 */
export interface Handoff {
  readonly ga: string | null;
  readonly packed: string | null;
  readonly arm: string | null;
}

/** The arm field's first_win_bonus arms (control, offer). */
const HANDOFF_ARMS: readonly string[] = FIRST_WIN_BONUS_ARMS;

/**
 * Whether `value` is an arm field a handoff may carry: the first_win_bonus cookie's value `<arm>.<browser id>`, the arm
 * control or offer and the browser id EXPERIMENT_BROWSER_ID_RE's (16 to 64 of [A-Za-z0-9_-], case-sensitive), exactly
 * as server/experiments/cookie.ts parseExperimentCookieValue reads it unquoted.
 */
export function isHandoffArm(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const dot = value.indexOf('.');
  return dot > 0 && HANDOFF_ARMS.includes(value.slice(0, dot)) && EXPERIMENT_BROWSER_ID_RE.test(value.slice(dot + 1));
}

/** The tail of a handoff with an arm and no touch: the five touch fields, each empty. */
const NO_TOUCH = SEP.repeat(FIELDS.length - 1);

/**
 * A `ga` handoff value in its parts: cut at its first `~` (none: all of it is `ga`), the rest the packed touch, except
 * that a rest of exactly six `~`-separated fields is the touch's five and the arm (five empty touch fields: no
 * touch). Any other rest is `packed` whole, as before the arm existed. Validates no part: ga4BrowserFromHandoff,
 * parseAcquisition and isHandoffArm do, each reader ignoring a malformed part on its own.
 */
export function splitHandoff(raw: string | null | undefined): Handoff {
  if (typeof raw !== 'string' || raw === '') return { ga: null, packed: null, arm: null };
  const at = raw.indexOf(SEP);
  if (at < 0) return { ga: raw, packed: null, arm: null };
  const ga = raw.slice(0, at);
  let packed = raw.slice(at + 1);
  let arm = '';
  const fields = packed.split(SEP);
  if (fields.length === FIELDS.length + 1) {
    arm = fields.pop() as string;
    packed = fields.join(SEP);
    if (packed === NO_TOUCH) packed = '';
  }
  return { ga: ga === '' ? null : ga, packed: packed === '' ? null : packed, arm: arm === '' ? null : arm };
}

/**
 * The handoff value (see the header): `ga`, `~packed`, `ga~packed`, or null when both are empty; then, when `arm` is
 * one isHandoffArm takes and `packed` is empty or five fields, `~` and the arm after the touch (its five fields empty
 * when there is none), unless that would pass HANDOFF_MAX: the arm alone is left off then. A handoff without a touch
 * or an arm is `ga` byte for byte; one without an arm is what it was before the arm existed.
 */
export function joinHandoff(ga: string | null | undefined, packed: string | null | undefined, arm?: string | null): string | null {
  const head = typeof ga === 'string' ? ga : '';
  const tail = typeof packed === 'string' ? packed : '';
  const plain = tail === '' ? (head === '' ? null : head) : `${head}${SEP}${tail}`;
  if (!isHandoffArm(arm)) return plain;
  const touch = tail === '' ? NO_TOUCH : tail;
  // A tail that is not five fields would read back with the arm inside it: such a tail carries none.
  if (touch.split(SEP).length !== FIELDS.length) return plain;
  const withArm = `${head}${SEP}${touch}${SEP}${arm}`;
  return withArm.length <= HANDOFF_MAX ? withArm : plain;
}
