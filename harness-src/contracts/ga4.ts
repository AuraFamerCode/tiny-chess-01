// The make.fun GA4 event contract: every event the site and the server send to Google Analytics 4, the
// parameters each carries and how GA reports them, the user properties, the primary CTA ids, and the query
// keys a page_location may keep. One source of truth for three readers, none of which may name an event or a
// parameter this file does not hold: the browser client (a type-checked sbTrack-style call), the server's
// Measurement Protocol sender, and the audit (.cosmos/skills/ga-audit, whose tracking-plan.json mirrors this
// file and is held equal to it by tests/unit/ga4-plan.test.ts). No imports and no Node APIs: safe for the
// Vite app and the node server alike.
//
//   GA4_HOSTS               the hostnames the property receives
//   GA4_EVENTS              event name -> { sender, key, expect, since, params, where, stitch }
//   GA4_USER_PROPERTIES     user-scoped dimensions (customUser:<name>)
//   GA4_PRIMARY_CTA         the data-track ids of the primary CTAs, and the events that hand off from them
//   GA4_PAGE_TYPES          page_view's page_type: the route names of src/routes/match.ts that are tracked
//   GA4_PAGE_LOCATION_*     what page_location may carry (ga4PageLocation applies it, client and server alike)
//   GA4_CLICK_IDS           ad click ids a landing keeps, and the network each belongs to
//   GA4_BUILTIN_DIMENSIONS  the GA Data API name each 'builtin' parameter is read as
//   GA4_LIMITS              GA4's name, count and length limits the contract is held to
//   Ga4EventName, Ga4Params<E>   the types a call site is checked against
//
// A parameter's kind says how GA reports it:
//   dim         an event-scoped custom dimension (customEvent:<name>), registered in the property
//   metric      an event-scoped custom metric (customEvent:<name>), registered in the property
//   builtin     a parameter GA reads natively (link_url, search_term, value, currency, transaction_id,
//               page_location): nothing to register, its Data API name is in GA4_BUILTIN_DIMENSIONS
//   unreported  sent but not registered (an id too fine for a dimension): BigQuery export only
// One parameter name has one kind in every event (GA refuses a name as both a dimension and a metric, and
// a dimension is registered once per name, not once per event). Dimension values are strings (a boolean is
// 'true' or 'false', at most 100 characters); a metric's and `value`'s are numbers. A parameter an event
// carries only in some cases (page_view's competition_slug: on a bounty's page, not the board) names the
// case in the event's `when`, so ga-audit's param coverage reads its '(not set)' on the rows of that case
// alone instead of filing every other page as a dropped parameter. A parameter that ships after its event
// (skill_fetch's bot) names its own day in the event's `paramSince`, so that coverage reads it from that
// day on and never files the event's earlier rows, sent before the parameter existed, as dropped.
//
// sender: 'client' events come from the browser's gtag; 'server' events from the Measurement Protocol, sent
// after the action is committed (never before, never for an action that was refused); 'both' only when one
// event name is sent from each side for different actions. A server-sent event carries `stitch`, how it is
// tied to the visitor:
//   browser    the request is always the visitor's browser: client_id and session_id from its _ga and
//              _ga_<stream> cookies
//   request    either: the browser's cookies when the request carries them, else (an agent, the CLI, an API
//              key) the account's stored ga_client_id
//   account    no browser is in the request (a worker, an admin acting for the account): the account's
//              stored ga_client_id
//   anonymous  no account, no cookie: a per-day bucket client_id (skill_fetch, mcp_request), never a person
// Every server-sent event also carries user_id = the account id (opaque, not PII, absent only on
// 'anonymous'), page_location (ga4PageLocation of the page the action came from, on the public origin),
// session_id and engagement_time_msec (GA4_SERVER_COMMON_PARAMS).
//
// No PII in any parameter, user property or page_location: no email, phone, wallet address, handle, IP,
// claim code, device code, token or free text a visitor typed. A competition slug, an entry id and a
// proposal id are public or opaque and may ride. Admin pages are never tracked (GA4_PAGE_TYPES leaves them
// out; staff actions send nothing of their own: a staff action that is a user's conversion, a proposal
// approved, is sent for the user's account).
//
// Consent: no banner and no consent-mode gate. The client sends nothing from an automated browser
// (navigator.webdriver) unless ?ga_force=1.

/** The day this contract's events were first planned: every `since` below but the referral events'. */
const SINCE = '2026-11-05';
/** The day the referral program's events ship (referral_share, referral_signup, referral_claim). */
const REFERRALS_SINCE = '2026-11-08';
/** The day skill_fetch's `bot` ships, with agent_kind ai_search (an AI answer engine's fetcher told from a crawler). */
const SKILL_FETCH_BOT_SINCE = '2026-11-08';
/** The day the agent-fetch counter ships: mcp_request, and skill_fetch's `verified` (an AI fetcher's address against its owner's list). */
const AGENT_FETCH_SINCE = '2026-11-08';
/** The day discord_join ships (a Join Discord click, named, where Enhanced measurement saw only a generic outbound click). */
const DISCORD_JOIN_SINCE = '2026-11-09';
/** The day page_exit's page_type and sign_up's via ship (an exit split by page without a join; a person's sign-up told from an agent's key mint). */
const EXIT_TYPE_SIGNUP_VIA_SINCE = '2026-11-09';
/** The day agent_prompt_email ships (a phone's Email me the prompt beside Copy for your agent). */
const PROMPT_EMAIL_SINCE = '2026-11-10';
/** The day the discord_reward A/B test ships: experiment_exposure, and the Discord quest's CTAs (link_area quest_offer). */
const DISCORD_REWARD_SINCE = '2026-11-09';
/** The day the tutorial A/B test ships: experiment_exposure's experiment tutorial, tutorial_step and tutorial_end, the tours' CTAs. */
const TUTORIAL_SINCE = '2026-11-09';
/** The day the on-chain side market's events are planned: market_trade's action, and market_close_position. */
const SIDE_MARKET_SINCE = '2026-11-13';

/** The hostnames the property receives: `host` is the site, `hosts` every host expected to report. */
export const GA4_HOSTS = { host: 'make.fun', hosts: ['make.fun', 'dev.make.fun'] } as const;

export type Ga4ParamKind = 'dim' | 'metric' | 'builtin' | 'unreported';
export type Ga4Sender = 'client' | 'server' | 'both';
export type Ga4Expect = 'always' | 'sometimes';
export type Ga4Stitch = 'browser' | 'request' | 'account' | 'anonymous';

export interface Ga4EventSpec {
  readonly sender: Ga4Sender;
  /** Marked a key event in GA: a conversion (a money or commit act, or the primary CTA). */
  readonly key: boolean;
  /** always: every audit window should hold some; sometimes: a window may legitimately hold none. */
  readonly expect: Ga4Expect;
  readonly since: string;
  /** Present on every event a server sends (sender server or both), never on a client one. */
  readonly stitch?: Ga4Stitch;
  readonly params: Readonly<Record<string, Ga4ParamKind>>;
  /**
   * The params it carries only in some cases, each with its case: other 'dim' params of this event and the values under which
   * it is always set (tracking-plan.json `when`). A param left out is carried on every event the sender sends.
   */
  readonly when?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /**
   * The params that shipped after the event, each with the day it first shipped, later than the event's `since`
   * (tracking-plan.json params[].since). A param left out shipped with the event.
   */
  readonly paramSince?: Readonly<Record<string, string>>;
  /** `<repo path>#<symbol>`: the file and the identifier at or beside which the event is sent. */
  readonly where: string;
}

/** GA4's own limits (support.google.com/analytics/answer/9267744), the contract is held to them. */
export const GA4_LIMITS = {
  eventNameLength: 40,
  paramNameLength: 40,
  paramValueLength: 100,
  userPropertyValueLength: 36,
  paramsPerEvent: 25,
  eventDimensions: 50,
  userDimensions: 25,
  metrics: 50,
  keyEvents: 30,
  reservedPrefixes: ['ga_', 'google_', 'firebase_'],
  // GA's reserved event names (app_install is one of them: the PWA install is `pwa_install`).
  reservedEvents: [
    'ad_activeview', 'ad_click', 'ad_exposure', 'ad_impression', 'ad_query', 'adunit_exposure',
    'app_clear_data', 'app_install', 'app_remove', 'app_update', 'error', 'first_open', 'first_visit',
    'in_app_purchase', 'notification_dismiss', 'notification_foreground', 'notification_open',
    'notification_receive', 'os_update', 'screen_view', 'session_start', 'user_engagement',
  ],
} as const;

/** Where a 'builtin' parameter is read: its GA Data API name. */
export const GA4_BUILTIN_DIMENSIONS = {
  link_url: 'linkUrl',
  search_term: 'searchTerm',
  value: 'eventValue',
  currency: 'currencyCode',
  transaction_id: 'transactionId',
  page_location: 'pageLocation',
} as const;

/** What every Measurement Protocol event carries besides its own params (see the header). */
export const GA4_SERVER_COMMON_PARAMS = {
  page_location: 'builtin',
  session_id: 'unreported',
  engagement_time_msec: 'unreported',
} as const satisfies Record<string, Ga4ParamKind>;

export const GA4_EVENTS = {
  // ---------------------------------------------------------------------------------------------- client
  // Every page and every in-app navigation (the app is a SPA, so GA's own page_view is switched off and
  // this one is sent per route change). page_type is the Route name of src/routes/match.ts
  // (sponsorRouteOf's `sponsor` and `proposal` too, and signInErrorOf's `sign-in-error`, the home page's
  // address under a failed sign-in's query); competition_slug is set on a page that has one: always
  // on bounty and leaderboard, on archive only as a bounty's entry breakdown (/bounty/<slug>/e/<id>, not
  // /s/<id>), never on another page type (src/lib/ga4.ts#ga4PageOf).
  page_view: {
    sender: 'client', key: false, expect: 'always', since: SINCE,
    params: { page_type: 'dim', competition_slug: 'dim' },
    when: { competition_slug: { page_type: ['bounty', 'leaderboard'] } },
    where: 'src/App.tsx#matchRoute',
  },
  // Any click on a link or button carrying data-track (else a stable id, else 'link'). cta_id is the
  // data-track value (GA4_PRIMARY_CTA lists the primary ones), link_area the nearest data-track-area (GA4_PRIMARY_CTA
  // lists the primary CTAs' areas; beta_welcome is the beta welcome dialog, src/components/help/BetaWelcome.tsx, whose
  // Join our Discord is beta_welcome_discord, whose Reviewed on Trustpilot tag is beta_welcome_trustpilot and whose Let's
  // make some fun and X are beta_welcome_close; quest_offer, from
  // DISCORD_REWARD_SINCE, is the Discord quest, src/components/quests/: its modal's one action by state,
  // quest_continue_discord | quest_link_discord | quest_join_server | quest_claim, the 'I joined, check again' link under
  // Join our server quest_check_join, its X quest_close, and the header's pill and a phone's bottom bar that open it
  // again, quest_reopen); quick_tour and full_tour, from TUTORIAL_SINCE, are the tutorial's two tours, src/components/tutorial/
  // (src/lib/tutorial.ts TUTORIAL_TRACK): Skip tutorial_skip, the X tutorial_close, Next tutorial_next, Copy prompt and the
  // prompt's copy icon home_earn_agent_copy (the band's primary CTA id: the same prompt copied), I pasted it tutorial_pasted,
  // Back tutorial_back, Find a bounty tutorial_find_bounty, Join our Discord tutorial_discord, the first step's Reviewed
  // on Trustpilot tag tutorial_trustpilot, and the paste step's app picker tutorial_app_claude_code | tutorial_app_codex |
  // tutorial_app_cursor; first_win_bonus is the first-win bonus band, src/components/quests/FirstWinBand.tsx (the
  // first_win_bonus test's offer arm alone; src/lib/firstWinPromo.ts FIRST_WIN_TRACK): Sign up first_win_sign_up, Find a
  // bounty first_win_find_bounty, Claim $10 first_win_claim, its X first_win_dismiss; tab_bar is a phone's bottom tab
  // bar, src/components/SiteTabBar.tsx, on every page under 40rem of window: its tabs
  // tab_home | tab_live (the board's Now list, /?list=now) | tab_saved (Saved, /?list=saved) |
  // tab_profile (signed out, tab_profile opens the sign-in dialog: sign_in_open); else header | footer | main by
  // landmark (the footer's Trustpilot rating is footer_trustpilot_score, and the plain link shown until that rating is
  // read footer_trustpilot; the phone board's list control, src/components/board/ListControl.tsx, the one button that
  // opens its sort and filter sheet, is board_controls_open, in main).
  cta_click: {
    sender: 'client', key: false, expect: 'always', since: SINCE,
    params: { cta_id: 'dim', link_url: 'builtin', link_area: 'dim' },
    where: 'src/main.tsx#startInstall',
  },
  // A [data-track-section] element first scrolled into view on a page; section_index is its order on the page.
  section_view: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { section_id: 'dim', section_index: 'metric' },
    where: 'src/main.tsx#startInstall',
  },
  // Sent once when a page is left or hidden, by beacon: how far and how long the visitor read, and the
  // Core Web Vitals of the page (LCP and INP in ms, CLS times 1000 as an integer). page_type is the page's page_view
  // page_type (from EXIT_TYPE_SIGNUP_VIA_SINCE). last_section is set only where a page renders [data-track-section]: the
  // board (HomeHero, HomeEarnBand, AllBounties), the referral landing (the board under who invited you) and a bounty's
  // pages (BountyPage, ClosedResults), and there only once a section was seen.
  page_exit: {
    sender: 'client', key: false, expect: 'always', since: SINCE,
    params: {
      page_type: 'dim', max_scroll: 'metric', last_section: 'dim', engaged_ms: 'metric', lcp_ms: 'metric', inp_ms: 'metric',
      cls_x1000: 'metric',
    },
    when: { last_section: { page_type: ['board', 'referral', 'bounty', 'leaderboard'] } },
    paramSince: { page_type: EXIT_TYPE_SIGNUP_VIA_SINCE },
    where: 'src/main.tsx#startInstall',
  },
  // An uncaught error or unhandled rejection: message is the error's own text cut to 100 characters with
  // any URL query removed (an empty or bare 'Uncaught' one is the thrown value's name or text), source the script it
  // came from (a path, never a query): the event's file, else the first same-origin frame of the error's or the
  // rejection's stack; 'cross-origin' for a bare 'Script error.' with no file (another origin's script, hidden by CORS).
  js_error: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { message: 'dim', source: 'dim' },
    where: 'src/main.tsx#startInstall',
  },
  // KEY. The human -> agent hand-off, the site's primary CTA: the visitor copies the one-line prompt
  // ("Read make.fun/skill.md and enter the bounty ...") for their coding agent. The whole product starts
  // here (the agent funnel's first step after the landing), so it is the conversion the ads optimize for.
  // placement home_hero | bounty_page | sponsor_wizard | guide (a guide's Quick start, src/components/help/Guide.tsx) |
  // home_earn_band (the home page's Ways to earn band in the site footer, src/components/board/HomeEarnBand.tsx: its
  // prompt chip's copy icon) | quick_tour | full_tour (the tutorial's copy
  // step, from TUTORIAL_SINCE, src/components/tutorial/TutorialHost.tsx: its Copy prompt and its prompt's copy icon);
  // copy_result copied | manual (the clipboard refused and the prompt was selected for Ctrl+C). competition_slug is the
  // bounty the bar is for: none on the sponsor wizard, which has no bounty yet, nor on a guide, the band or
  // a tour, whose prompt names none.
  agent_prompt_copy: {
    sender: 'client', key: true, expect: 'always', since: SINCE,
    params: { placement: 'dim', competition_slug: 'dim', copy_result: 'dim' },
    when: { competition_slug: { placement: ['home_hero', 'bounty_page'] } },
    where: 'src/components/board/AgentEntryBar.tsx#copyText',
  },
  // The starter kit link of an AgentEntryBar (a .tar.gz whose URL has no extension, so GA's own
  // file_download never sees it: the bar's Starter kit, the home hero band's Download starter kit in Copy for your
  // agent's chevron menu, the header door's Download starter kit in the split's chevron menu, src/components/board/
  // AgentSplit.tsx), and the same download wherever else it is offered: the bounty page's action dock (the tarballs
  // in the same split's chevron menu, or the Download kit half of a listing that takes no entries), the entry
  // dialog's step 1 and the page body's kit downloads (the sealed-window line's final kit, the Kit section's dev and
  // final kits). Sent only for a real kit, not for the agent-guide link it falls back to. placement home_hero |
  // bounty_page | sponsor_wizard | bounty_dock | entry_steps | bounty_kits.
  kit_download: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { placement: 'dim', competition_slug: 'dim' },
    where: 'src/components/board/AgentEntryBar.tsx#kitLink',
  },
  // A phone's Email me the prompt sent (src/components/board/PromptEmail.tsx): the server accepted the address and its email
  // provider took the message (POST /api/agent-prompt/email answered 2xx), so the visitor has the exact Copy for your
  // agent prompt in their inbox to open on a computer. Shown only on a phone (the bar's max-sm) on a server that sends
  // email. Not a key event: it is the hand-off deferred, and the agent's arrival (skill_fetch, then the entry) counts the
  // conversion. Never the address. placement home_hero; competition_slug the hero's bounty.
  agent_prompt_email: {
    sender: 'client', key: false, expect: 'sometimes', since: PROMPT_EMAIL_SINCE,
    params: { placement: 'dim', competition_slug: 'dim' },
    when: { competition_slug: { placement: ['home_hero'] } },
    where: 'src/components/board/PromptEmail.tsx#sendPromptEmail',
  },
  // The sign-in dialog opened; placement is the opening SignInButton's testId (header-sign-in is the header's, sign-in the
  // entry dialog's steps; the signed-out profile, notifications and admin cards run the flow inline and open no dialog,
  // so they send none, only login_start), or create_bounty
  // for the signed-out header's Create a bounty (src/components/board/SiteHeader.tsx opens the same dialog over /sponsor/new),
  // or tab_bar for the Profile tab of a phone's tab bar while signed out (src/App.tsx opens its one dialog over the page in view),
  // or bounty_hold_appeal for a signed-out arrival at a bounty's #distinct-entrant-appeal (src/components/board/BountyPage.tsx
  // HoldAppealAtFragment opens it before the copy-check appeal).
  sign_in_open: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { placement: 'dim' },
    where: 'src/components/ui.tsx#SignInButton',
  },
  // A sign-in method chosen: GitHub's, Google's or Discord's redirect started, or a wallet asked to sign. method github |
  // google | discord | solana | dev.
  login_start: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { method: 'dim' },
    where: 'src/components/auth/SignInDialog.tsx#goToGithub',
  },
  // A wallet sign-in that ended without a session: reason rejected | failed | unavailable.
  login_error: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { method: 'dim', reason: 'dim' },
    where: 'src/components/auth/SignInDialog.tsx#signInWithWallet',
  },
  // A bounty saved or unsaved with the bookmark (browser-local, so no server could see it).
  bounty_save: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { competition_slug: 'dim', saved: 'dim' },
    where: 'src/components/BookmarkButton.tsx#toggle',
  },
  // GA's recommended `search`: the site search, once the query settles. The client sends nothing for a
  // term over 40 characters or one holding '@' or a 32+ character base58 run (an address), and the term
  // lowercased and trimmed. result_count is how many rows it listed.
  search: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { search_term: 'builtin', result_count: 'metric' },
    where: 'src/components/board/SiteSearch.tsx#onQueryChange',
  },
  // GA's recommended `select_content`: a bounty, entry or profile picked from the site search, a board
  // card, a card of the board's live band (src/components/board/LiveBand.tsx) or one of its Upcoming rows
  // (src/components/board/UpcomingRows.tsx). content_type bounty | entry | profile | page; item_id the competition slug
  // or entry id (never a handle); placement site_search | board_card | board_live_band | board_upcoming. A phone's
  // board sends the same three: a bounty's row (src/components/board/BountyRow.tsx) the card's, board_card, a live row
  // or a card of the Live rail (src/components/board/LiveRail.tsx) the band's, board_live_band, and a row of its
  // Upcoming section, the wide board's own row, board_upcoming.
  select_content: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { content_type: 'dim', item_id: 'dim', placement: 'dim' },
    where: 'src/components/BountyCard.tsx#BountyCard',
  },
  // GA's recommended `share`: the win panel's Share on X, or its Copy link. method x | copy_link,
  // content_type win, item_id the competition slug.
  share: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { method: 'dim', content_type: 'dim', item_id: 'dim' },
    where: 'src/components/win/WinCelebration.tsx#xIntentUrl',
  },
  // The account's referral link put out from the profile's Referrals tab (its hero's link row, LinkRow, and an empty
  // state's Copy link): method copy (the clipboard took the link) | x (Share on X) | native (the browser's share sheet
  // reported it shared). Never the link or its code: the code names the account it credits.
  referral_share: {
    sender: 'client', key: false, expect: 'sometimes', since: REFERRALS_SINCE,
    params: { method: 'dim' },
    where: 'src/components/profile/ReferralsPanel.tsx#LinkRow',
  },
  // A click on a link to the Discord invite (DISCORD_INVITE_URL), sent as the link opens its new tab: community join intent.
  // A key event, the second client one beside the primary CTA, so Discord interest counts per source and per ad in GA4's
  // key-event reports and the ads ledger rather than being read off Enhanced measurement's generic `click`; Google Ads
  // imports it as a secondary conversion (counted, never bid on). It is intent, not a join: the invite opens off-site, so
  // it sits on no funnel (tests/unit/ga4-plan.test.ts). placement footer_band (the footer's Discord band's Join Discord) |
  // beta_welcome (the beta welcome's Join our Discord) | footer_social (the footer Socials column's Discord) |
  // quest_offer (the Discord quest's Join our server, src/components/quests/QuestHost.tsx, from DISCORD_REWARD_SINCE) |
  // quick_tour | full_tour (a tour's last step's Join our Discord, src/components/tutorial/, from TUTORIAL_SINCE).
  discord_join: {
    sender: 'client', key: true, expect: 'sometimes', since: DISCORD_JOIN_SINCE,
    params: { placement: 'dim' },
    where: 'src/components/DiscordBand.tsx#trackDiscordJoin',
  },
  // An A/B test's arm assigned to a browser, sent as the beta welcome opens on its first visit to a signed-out viewer, the
  // same moment in every arm (intention to treat; an open to a signed-in account sends none, in any arm), once per browser
  // (src/lib/experiments.ts exposeOnce, from src/components/help/BetaWelcome.tsx; the server's experiment_exposure row,
  // POST /api/experiments/exposure, is the count the admin readout reads, this is GA's copy for its own segments).
  // experiment discord_reward (the Discord quest test, sent until it concluded on 2026-11-10: its $2 offer is every new
  // account's quest since, with no arm); arm control (the welcome alone) | offer ($2) | offer_5 ($5) | offer_10 ($10) |
  // offer_20 ($20) (each offer arm's quest modal followed the welcome's close, src/components/quests/QuestHost.tsx).
  // experiment tutorial (the tutorial test, from TUTORIAL_SINCE, its arm drawn on its own, one event per test at the same
  // open); arm control (the welcome alone) | quick_tour (a four-turn
  // ghost chat) | full_tour (a four-step split-card pager) (each tour arm's tour follows the welcome's close, before any
  // quest, src/components/tutorial/TutorialHost.tsx). A browser outside a test (its first visit while that test was off, or
  // one that had the welcome before) sends none for it.
  // experiment ad_landing (the ad_landing test, src/lib/adLandingTest.ts sendAdLandingExposure, also through exposeOnce):
  // sent at another moment, a dog ad's home landing (Meta, or a campaign, content or term naming a dog) while the dog
  // contest takes entries, once per browser at the landing that rolled its arm, signed in or out, both arms alike, just
  // after GA starts; arm control (stayed home) | contest_feed (sent to the contest's Feed tab, /bounty/<slug>#feed, before
  // the landing page_view, so that page is the session's landing page). A forced arm (?ab_ad_landing=) sends none.
  // experiment first_win_bonus (the first_win_bonus test, from 2026-11-10, src/lib/firstWinBonus.ts stepFirstWinBonus,
  // also through exposeOnce): sent at another moment, a signed-out page load once the browser holds its arm (the load
  // that rolled it by GET /api/quests' shares, or a later one), once per browser, both arms alike whether or not a promo
  // shows; a signed-in viewer sends none; arm control (no offer) | offer ($10 free once the account has won $5 in bounty
  // rewards, the first_win_bonus quest).
  experiment_exposure: {
    sender: 'client', key: false, expect: 'sometimes', since: DISCORD_REWARD_SINCE,
    params: { experiment: 'dim', arm: 'dim' },
    where: 'src/lib/experiments.ts#exposeOnce',
  },
  // A tour's step first reached on this open of the tutorial (src/components/tutorial/TutorialHost.tsx, once per step per
  // open): arm quick_tour | full_tour (the browser's tutorial arm, as experiment_exposure names it); step how | copy |
  // paste | next, how being the tour shown; step_index its 1-based place, 1 to 4.
  tutorial_step: {
    sender: 'client', key: false, expect: 'sometimes', since: TUTORIAL_SINCE,
    params: { arm: 'dim', step: 'dim', step_index: 'metric' },
    where: 'src/lib/tutorial.ts#trackTutorialStep',
  },
  // A tour closed: arm quick_tour | full_tour; outcome finished (Find a bounty) | skipped (Skip, the X, Esc or the
  // backdrop); step and step_index the step it closed at, as tutorial_step's. Join our Discord closes nothing (discord_join).
  tutorial_end: {
    sender: 'client', key: false, expect: 'sometimes', since: TUTORIAL_SINCE,
    params: { arm: 'dim', outcome: 'dim', step: 'dim', step_index: 'metric' },
    where: 'src/lib/tutorial.ts#trackTutorialEnd',
  },
  // The app install control: the browser's prompt answered, or the app installed. outcome accepted |
  // dismissed | installed | steps_shown (the iOS/Safari steps disclosed) | bar_dismissed (the phone's install
  // bar turned down, src/components/InstallBar.tsx#dismissInstallBar). Not `app_install`: GA reserves it.
  pwa_install: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { outcome: 'dim' },
    where: 'src/lib/install.ts#promptInstall',
  },
  // A finished entry's storefront put to use: method copy (the command), link (Use this bot), download
  // (Download code) or original (View on GitHub). entry_id is unreported: too fine for a dimension.
  entry_use: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { method: 'dim', competition_slug: 'dim', entry_id: 'unreported' },
    where: 'src/components/archive/Storefront.tsx#UseCopy',
  },
  // A step of a multi-step form reached, once per step per page view: form_id sponsor_proposal (each
  // wizard question as it shows) | entry (the dialog's kit, build and link steps as each comes into
  // view, sent from src/components/board/SubmissionForm.tsx); step the step's stable name (the plan's
  // forms block lists them in order); step_index its 1-based place. No completion or abandon event:
  // the form's own event is the completion (generate_lead, entry_submit).
  form_step: {
    sender: 'client', key: false, expect: 'sometimes', since: SINCE,
    params: { form_id: 'dim', step: 'dim', step_index: 'metric' },
    where: 'src/components/sponsor/ProposalWizard.tsx#ProposalWizard',
  },

  // ---------------------------------------------------------------------------------------------- server
  // KEY. An account made (a first sign-in by GitHub, Google, Discord or a Solana wallet): the visitor became a user. method
  // github | google | discord | solana. via (from EXIT_TYPE_SIGNUP_VIA_SINCE) web (a person's sign-in: the OAuth callback, a
  // wallet's siws/verify) | agent (an agent's key mint, POST /api/auth/solana/key, whose verify makes the account: its
  // method reads solana). Sent from the first-session after-hook of Better Auth (server/auth.ts trackSignIn), once per
  // account.
  sign_up: {
    sender: 'server', key: true, expect: 'sometimes', since: SINCE, stitch: 'browser',
    params: { method: 'dim', via: 'dim' },
    paramSince: { via: EXIT_TYPE_SIGNUP_VIA_SINCE },
    where: 'server/auth.ts#databaseHooks',
  },
  // GA's recommended `login`: a session made for an account that exists already (every sign-in that is
  // not the first one). method github | google | discord | solana.
  login: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'browser',
    params: { method: 'dim' },
    where: 'server/auth.ts#databaseHooks',
  },
  // A sign-up that carried a referral code and bound it (bindReferral wrote the referral row, after the session hook's
  // sign_up), sent for the new account: method github | google | discord | solana | key (an agent's key mint, POST /api/auth/solana/key, whose
  // body's `ref` carried the code; its sign_up reads solana). Never the code or the referrer: each names an account. Not a
  // key event: sign_up is the conversion, this says it came by a referral.
  referral_signup: {
    sender: 'server', key: false, expect: 'sometimes', since: REFERRALS_SINCE, stitch: 'request',
    params: { method: 'dim' },
    where: 'server/referrals/attribution.ts#bindReferral',
  },
  // The first-sign-in username step answered: step username (a handle chosen) | skip.
  profile_setup: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: { step: 'dim' },
    where: 'server/profile/routes.ts#changeHandle',
  },
  // A wallet linked to the signed-in account (POST /api/auth/siws/link succeeded).
  wallet_link: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'browser',
    params: {},
    where: 'server/auth.ts#LINK_PATH',
  },
  // KEY. A signed-in person approved an agent's connect request (/connect): the agent may now enter as
  // them. The commit act between the sign-up and the entry, and the only step a person takes for an
  // agent that logs in with `makefun login`. scopes the granted scopes sorted and comma-joined
  // (bet,comment,enter,sponsor); merge true when the approval also merges the agent's account.
  agent_connect_approve: {
    sender: 'server', key: true, expect: 'sometimes', since: SINCE, stitch: 'browser',
    params: { scopes: 'dim', merge: 'dim' },
    where: 'server/agents/connect.ts#decideConnect',
  },
  // A signed-in person refused an agent's connect request.
  agent_connect_deny: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'browser',
    params: {},
    where: 'server/agents/connect.ts#decideConnect',
  },
  // The agent redeemed its approved grant (its token poll succeeded, pollToken): its API key is minted, the agent
  // is connected and can enter.
  agent_connect_complete: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'account',
    params: { scopes: 'dim' },
    where: 'server/agents/connect.ts#pollToken',
  },
  // A paired agent disconnected from the account (its keys revoked).
  agent_disconnect: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'browser',
    params: {},
    where: 'server/agents/connect.ts#disconnectWallet',
  },
  // An agent read a document the copied prompt or an answer engine points it at: a non-browser GET (no Sec-Fetch-Dest; never a
  // HEAD; a browser loading the page is a page_view, not this) of /skill.md, /heartbeat.md, /developers or /llms.txt, a revalidation's 304
  // included (server/routes/agent.ts agentDoc and its llms.txt route), of the Agent Skill wrapper /skills/make-fun/SKILL.md (a
  // static file of the built web UI: server/app.ts webUi), of the bounty list those documents send an agent to, GET
  // /api/competitions with any query (?status=open), its JSON or markdown (server/app.ts: the act after the read), or of a
  // guide, /guide/<slug> (server/routes/seo.ts). doc skill | heartbeat | developers | llms | agent-skill | api-competitions |
  // make-money-with-ai-agents | how-ai-agents-earn-money | ai-agent-bounties | post-a-bounty-for-ai-agents
  // (server/accounts/ga-client.ts SKILL_FETCH_PATHS). No cookie, no account: the client_id is the numeric bucket
  // <hash of agent_kind>.<yyyymmdd> (MP takes only digits.digits), so the day's reads of one agent family are one anonymous user.
  // agent_kind is the user agent's family: claude | codex | cursor | gemini | curl | ai_search | crawler | other. `ai_search` is
  // an AI answer engine's fetcher (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User,
  // and xAI's xAI-SearchBot, GrokBot, xAI-Grok, grok-agent, which before 2026-11-09 read as crawler or other:
  // ga-client.ts AI_SEARCH_BOTS; Claude Code's WebFetch also sends Claude-User, but with a claude-code token, and counts as
  // `claude`: it fetches from a developer's machine); `crawler` a search, SEO, social-preview or AI-training crawler by User-Agent (Googlebot,
  // bingbot, GPTBot, ClaudeBot ...). bot, on those two alone (from SKILL_FETCH_BOT_SINCE), is the token that told it: the
  // fetcher's name as its owner writes it, or the crawler's product token, never more than the token (no URL or address rides).
  // verified, on ai_search alone (from AGENT_FETCH_SINCE), says whether the client address is in the list that fetcher's owner
  // publishes (server/accounts/fetcher-ranges.ts FETCHER_RANGE_SOURCES): true | false (the User-Agent's claim is not to be
  // believed) | unknown (no copy of the list held, or no address; always for xAI's four, whose owner publishes no list:
  // fetcher-ranges.ts UNLISTED_FETCHERS). Information only: every read is served and counted alike.
  // Sent once per reader (client IP) per doc per agent family per UTC day (server/accounts/ga-client.ts trackSkillFetch).
  skill_fetch: {
    sender: 'server', key: false, expect: 'always', since: SINCE, stitch: 'anonymous',
    params: { doc: 'dim', agent_kind: 'dim', bot: 'dim', verified: 'dim' },
    when: { bot: { agent_kind: ['ai_search', 'crawler'] }, verified: { agent_kind: ['ai_search'] } },
    paramSince: { bot: SKILL_FETCH_BOT_SINCE, verified: AGENT_FETCH_SINCE },
    where: 'server/routes/agent.ts#agentDoc',
  },
  // An agent's use of the MCP server: POST /mcp answered 200 or 202 (server/routes/agent.ts) carrying an `initialize` (a client
  // connecting: the server is stateless, so this is the session) or a `tools/call` of a tool the server lists. rpc initialize |
  // tools/call; tool the tool called (on tools/call alone). agent_kind, bot and verified as skill_fetch's, from the User-Agent;
  // where it names no family (`other`: an SDK's bare fetch), the agent family the initialize's clientInfo.name names. mcp_client
  // is that clientInfo.name (the client's own name, claude-code, codex-mcp-client, cursor-vscode ...: letters, digits, spaces and
  // . _ + / - only, at most 64, else unknown), on initialize always, and on a tools/call when the same address and User-Agent
  // initialized that UTC day. No cookie, no account: skill_fetch's anonymous bucket (agent family and day). Sent once per client
  // (client IP, agent family) per rpc and tool per UTC day (server/accounts/ga-client.ts trackMcpRequest).
  mcp_request: {
    sender: 'server', key: false, expect: 'sometimes', since: AGENT_FETCH_SINCE, stitch: 'anonymous',
    params: { rpc: 'dim', tool: 'dim', agent_kind: 'dim', bot: 'dim', mcp_client: 'dim', verified: 'dim' },
    when: {
      tool: { rpc: ['tools/call'] },
      bot: { agent_kind: ['ai_search', 'crawler'] },
      mcp_client: { rpc: ['initialize'] },
      verified: { agent_kind: ['ai_search'] },
    },
    where: 'server/routes/mcp.ts#mcpRequestCounter',
  },
  // KEY. An entry accepted (POST /api/competitions/:slug/submissions answered 202): the agent funnel's
  // commit act, a signed, receipted entry in a competition. via web (a session) | agent (an API key); round
  // is the entry's round number. Never the claim code the 202 carries.
  entry_submit: {
    sender: 'server', key: true, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: { competition_slug: 'dim', round: 'dim', via: 'dim', entry_id: 'unreported' },
    where: 'server/routes/submissions.ts#SubmissionCreated',
  },
  // An entry graded (the grader's result was published): result finished | failed | timeout | nondeterministic.
  entry_graded: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'account',
    params: { competition_slug: 'dim', round: 'dim', result: 'dim', entry_id: 'unreported' },
    where: 'server/pipeline/publish.ts#createPublishStage',
  },
  // The entrant won a paid place when the competition resolved (the `won` notification's sweep): prize_place
  // is the placement, value the prize in USD. Not a key event: the prize is not revenue, prize_claim is the act.
  entry_win: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'account',
    params: {
      competition_slug: 'dim', prize_place: 'metric', value: 'builtin', currency: 'builtin',
      entry_id: 'unreported',
    },
    where: 'server/notifications/sweep.ts#sweepResults',
  },
  // The winner's claim form accepted (POST /api/submissions/:id/claim, applyClaim): a payout is queued.
  prize_claim_apply: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: { competition_slug: 'dim', via: 'dim', entry_id: 'unreported' },
    where: 'server/routes/community.ts#applyClaim',
  },
  // KEY. A prize claimed on chain (POST /api/claims/:id/submit confirmed): the winner is paid, the last
  // step of the agent funnel and the only point where money reaches an entrant. value is the USDC paid in
  // USD (amount_base_units / 1e6), result full | partial.
  prize_claim: {
    sender: 'server', key: true, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: {
      competition_slug: 'dim', value: 'builtin', currency: 'builtin', result: 'dim', via: 'dim',
      claim_id: 'unreported',
    },
    where: 'server/routes/claims.ts#ClaimSubmitResponse',
  },
  // A referrer's claim of its approved referral rewards filed (POST /api/me/referrals/claim, the MCP tool
  // claim_referral_rewards through it), after its inline send: value the claim's USDC in USD (amount_base_units / 1e6),
  // result paid | sending | held (an admin's Pay decides it), via web | agent. A refused claim (400, 409, 451) sends nothing.
  // Not a key event: a referral reward is what the program costs, not a conversion.
  referral_claim: {
    sender: 'server', key: false, expect: 'sometimes', since: REFERRALS_SINCE, stitch: 'request',
    params: { value: 'builtin', currency: 'builtin', result: 'dim', via: 'dim' },
    where: 'server/referrals/claim.ts#claimReferralRewardsOf',
  },
  // A sponsor proposal draft made (POST /api/sponsor/proposals answered 201). via web | agent.
  proposal_start: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: { via: 'dim', proposal_id: 'unreported' },
    where: 'server/routes/sponsor.ts#renderProposal',
  },
  // A sponsor asked the team to set the proposal up from a brief (custom bounty request).
  proposal_setup_request: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: { proposal_id: 'unreported' },
    where: 'server/routes/sponsor.ts#PROPOSAL_SETUP_REQUEST_ACTION',
  },
  // KEY. GA's recommended `generate_lead`: a sponsor proposal submitted for review, its pot deposited on
  // chain and in the proposal's vault until the team decides (proposal.submit, server/routes/sponsor/store.ts
  // PROPOSAL_SUBMIT_ACTION). The sponsor funnel's commit act. lead_type sponsor_proposal; value the pot in USD.
  generate_lead: {
    sender: 'server', key: true, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: { lead_type: 'dim', value: 'builtin', currency: 'builtin', proposal_id: 'unreported' },
    where: 'server/routes/sponsor.ts#PROPOSAL_SUBMIT_ACTION',
  },
  // A sponsor withdrew a deposited proposal (pot returned).
  proposal_withdraw: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: { proposal_id: 'unreported' },
    where: 'server/routes/sponsor.ts#PROPOSAL_WITHDRAW_ACTION',
  },
  // The team rejected a submitted proposal (pot returned): sent for the sponsor's account, by the admin's action.
  proposal_reject: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'account',
    params: { proposal_id: 'unreported' },
    where: 'server/routes/admin/proposals.ts#recordRejected',
  },
  // KEY. GA's recommended `purchase`: the prize funded. The team approved the sponsor's proposal, the pot
  // moved into the prize escrow and the competition listed (recordApproved, the one place every approval
  // path ends): the sponsor's money is committed. transaction_id the proposal id (one purchase per
  // proposal), value the pot in USD. Sent for the sponsor's account, not the approving admin's.
  purchase: {
    sender: 'server', key: true, expect: 'sometimes', since: SINCE, stitch: 'account',
    params: { transaction_id: 'builtin', value: 'builtin', currency: 'builtin', competition_slug: 'dim' },
    where: 'server/routes/admin/proposals.ts#recordApproved',
  },
  // KEY. A side-bet trade landed: the on-chain market's POST /api/competitions/:slug/market/trades/submit confirmed (a
  // USDC trade on the side_market program), the one act a spectator commits money to on a competition, so the spectator
  // funnel's conversion. side yes | no, action buy | sell, via web | api | mcp (the submit route's caller: a session, an
  // API key's REST call, an MCP tool; the trades only the indexer sees, direct, house and quoter, send nothing),
  // first_trade true on the wallet's first trade on that market (its ticket opened with it), sent by the submit handler
  // once the trade is confirmed and recorded (server/routes/market.ts submitTrade).
  market_trade: {
    sender: 'server', key: true, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: { competition_slug: 'dim', side: 'dim', action: 'dim', via: 'dim', first_trade: 'dim' },
    paramSince: { action: SIDE_MARKET_SINCE },
    where: 'server/routes/market.ts#submitTrade',
  },
  // A side-bet position closed: a confirmed sell (POST .../market/trades/submit) that left the wallet no shares on that
  // outcome (the web's Close, an MCP prepare_bet with close: true, or any sell of the whole position), sent beside that
  // sell's market_trade. side yes | no, the side closed; via web | api | mcp. Not a key event: market_trade is the act.
  // The submit handler sends it (server/routes/market.ts submitTrade).
  market_close_position: {
    sender: 'server', key: false, expect: 'sometimes', since: SIDE_MARKET_SINCE, stitch: 'request',
    params: { competition_slug: 'dim', side: 'dim', via: 'dim' },
    where: 'server/routes/market.ts#submitTrade',
  },
  // A payout delegation registered (POST /api/agents/me/delegations): the owner's wallet is now the payout
  // pin. result created (201) | repinned (200).
  delegation_register: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: { result: 'dim' },
    where: 'server/routes/delegations.ts#DelegationResponse',
  },
  // Two accounts merged (an approved merge, POST /api/account/merges/approve).
  account_merge: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'browser',
    params: {},
    where: 'server/routes/account-merge.ts#afterMerge',
  },
  // A comment posted on a competition (POST /api/competitions/:slug/comments answered 201), held for
  // moderation or not. is_reply true for a reply.
  comment_post: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: { competition_slug: 'dim', via: 'dim', is_reply: 'dim' },
    where: 'server/routes/community/comments.ts#answerRefusals',
  },
  // A contact channel verified with its 6-digit code (POST /api/me/contact/:channel/confirm). channel
  // email | phone; never the address.
  contact_verify: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: { channel: 'dim' },
    where: 'server/contact/store.ts#confirmCode',
  },
  // A browser subscribed to Web Push (POST /api/notifications/push): notifications opted in.
  push_subscribe: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'browser',
    params: {},
    where: 'server/routes/notifications.ts#PushBody',
  },
  // An entrant's masq build key issued for a metered competition (POST /api/competitions/:slug/build-key
  // answered 201). rotate true when it replaced an active key.
  build_key_issue: {
    sender: 'server', key: false, expect: 'sometimes', since: SINCE, stitch: 'request',
    params: { competition_slug: 'dim', rotate: 'dim' },
    where: 'server/routes/competitions/build-key.ts#issueBuildKey',
  },
} as const satisfies Record<string, Ga4EventSpec>;

export type Ga4EventName = keyof typeof GA4_EVENTS;

type ParamsOf<E extends Ga4EventName> = (typeof GA4_EVENTS)[E]['params'];
type ParamValue<Name extends string, Kind> = Kind extends 'metric' ? number : Name extends 'value' ? number : string;

/** The parameters an event may carry, each typed by its kind: a number for a metric and for `value`, else a string. */
export type Ga4Params<E extends Ga4EventName> = {
  -readonly [P in keyof ParamsOf<E> & string]?: ParamValue<P, ParamsOf<E>[P]>;
};

/** Every event name, in the order above. */
export const GA4_EVENT_NAMES = Object.keys(GA4_EVENTS) as Ga4EventName[];

/** The key events, derived from GA4_EVENTS's `key`. */
export const GA4_KEY_EVENTS: readonly Ga4EventName[] = GA4_EVENT_NAMES.filter((name) => GA4_EVENTS[name].key);

/** The events a server sends over the Measurement Protocol (sender server or both). */
export const GA4_SERVER_EVENTS: readonly Ga4EventName[] = GA4_EVENT_NAMES.filter((name) => GA4_EVENTS[name].sender !== 'client');

export const isGa4EventName = (name: string): name is Ga4EventName => Object.hasOwn(GA4_EVENTS, name);

/**
 * User-scoped dimensions (customUser:<name>), set by gtag's `user_properties` and so on every later event of
 * the user. A value is at most 36 characters.
 *   acq_source, acq_medium, acq_campaign, acq_content   the latest non-direct landing's utm_source,
 *       utm_medium, utm_campaign and utm_content, or an external referrer's host (medium referral, campaign
 *       (referral)): taken from a landing that has one and kept in localStorage (makefun:acq:v1), so a
 *       later direct landing restores them and GA Realtime can show a fresh ad visitor
 *   signed_in   'true' | 'false'
 *   theme       the resolved color mode: light | dark | night
 */
export const GA4_USER_PROPERTIES = {
  acq_source: { since: SINCE, where: 'src/main.tsx#startInstall' },
  acq_medium: { since: SINCE, where: 'src/main.tsx#startInstall' },
  acq_campaign: { since: SINCE, where: 'src/main.tsx#startInstall' },
  acq_content: { since: SINCE, where: 'src/main.tsx#startInstall' },
  signed_in: { since: SINCE, where: 'src/lib/useApi.ts#useMe' },
  theme: { since: SINCE, where: 'src/main.tsx#subscribeTheme' },
} as const satisfies Record<string, { readonly since: string; readonly where: string }>;

export type Ga4UserProperty = keyof typeof GA4_USER_PROPERTIES;

/**
 * The primary CTAs: the buttons and links that start an entry (data-track=<id>, so cta_click's cta_id is
 * the id and not the button's text). The ids are the AgentEntryBar's testIds with `-` as `_`: its home-hero
 * band (hero-agent-copy, its Copy for your agent; hero-agent-kit, the Download starter kit in that split's chevron
 * menu, whose agent guide and brief links carry none; hero-submit, its Submit an entry), the bounty page's door
 * (bounty-agent-copy, bounty-agent-kit, bounty-submit-cta), the sponsor wizard's (sponsor-prompt-copy) and a guide's Quick start's
 * (guide-agent-copy), plus two ids that are a data-track and no bar's testId: home_earn_agent_copy,
 * the copy icon of the home Ways to earn band's prompt chip (src/components/board/HomeEarnBand.tsx), and sponsor_start, the
 * link that starts a bounty proposal: the header's Create a bounty and the sponsor list's Start one. One action is one id
 * wherever it appears: the bounty page's action dock (Copy for your agent, bounty_agent_copy, its chevron menu
 * holding the kits, bounty_agent_kit, and 'Kit, phases and digest'; a listing that takes no entries keeps Download
 * kit, bounty_agent_kit, in its place; then Submit an entry, bounty_submit_cta) and the entry dialog's Download kit
 * (bounty_agent_kit) reuse the bar's ids, and so does every other link that opens a bounty's
 * entry form (a board card's Submit, the live entries' empty-state Submit an entry, the next-step bar's submit and
 * resubmit, a profile entry's Fix and resubmit, the standings' two Submit links: tests/unit/web-ga4-sites.test.ts
 * finds them in src/ and fails one without it), as does every kit download on the bounty page's body. link_area, the
 * nearest data-track-area, tells the placements apart: bounty_dock | entry_steps | bounty_card | live_entries |
 * next_step | profile_entries | leaderboard | bounty_kits | bounty_page | header | sponsor_list | quick_tour | full_tour (the tutorial's two tours,
 * src/components/tutorial/, whose Copy prompt and prompt copy icon carry home_earn_agent_copy: the same prompt copied is
 * one action), and live_band, the
 * board's live band, whose cards hold no primary CTA (its title links' cta_click). beta_welcome, the beta
 * welcome dialog, holds none either: its Join our Discord is beta_welcome_discord, its Let's make some fun and X
 * beta_welcome_close; nor does quest_offer, the Discord quest (its quest_* ids, cta_click); nor first_win_bonus, the
 * first-win bonus band (src/components/quests/FirstWinBand.tsx): the band holds no primary CTA, its Sign up, Find a
 * bounty, Claim $10 and X being first_win_sign_up, first_win_find_bounty, first_win_claim and first_win_dismiss
 * (cta_click). A tour's other controls carry
 * no primary CTA either: tutorial_skip, tutorial_close, tutorial_next, tutorial_pasted, tutorial_back,
 * tutorial_find_bounty, tutorial_discord, tutorial_trustpilot and tutorial_app_claude_code | tutorial_app_codex |
 * tutorial_app_cursor (cta_click). `handoff_events` are the events that follow a
 * primary click with the thing itself done.
 */
export const GA4_PRIMARY_CTA = {
  ids: [
    'hero_agent_copy', 'hero_agent_kit', 'hero_submit',
    'bounty_agent_copy', 'bounty_agent_kit', 'bounty_submit_cta',
    'sponsor_prompt_copy', 'sponsor_start',
    'guide_agent_copy', 'home_earn_agent_copy',
  ],
  handoff_events: ['agent_prompt_copy'],
} as const;

/**
 * page_view's page_type values: the route names of src/routes/match.ts (matchRoute, sponsorRouteOf's
 * sponsor and proposal, and signInErrorOf's sign-in-error) that are tracked. The admin desk and the styleguide are staff's and send nothing, and
 * neither does an email's unsubscribe page, whose path carries its token (GA4_UNTRACKED_PAGE_TYPES). `other`
 * is a path the app does not know (its 404).
 */
export const GA4_PAGE_TYPES = [
  'board', 'bounty', 'leaderboard', 'archive', 'tree', 'profile', 'rankings', 'how-it-works', 'press',
  'coin', 'terms', 'privacy', 'delegate', 'notifications', 'connect', 'agents', 'sponsor', 'proposal', 'other',
  // The invite landing, /r/<code>: the board under who invited you.
  'referral',
  // A guide, /guide/<slug> (src/components/help/Guide.tsx): no competition_slug (its route names the guide `guide`, not
  // `slug`, so ga4PageOf reads none); which guide is page_location's path.
  'guide',
  // Your Discord link and rank roles, /discord (src/components/discord/DiscordPage.tsx): signed-in and unlisted like
  // notifications and connect, and tracked like them; its ?linked, ?error and ?from are not in GA4_PAGE_LOCATION_ALLOW,
  // so page_location drops them.
  'discord',
  // What make.fun is and who runs it, /about (src/components/help/About.tsx): public, a reader's page like how-it-works.
  'about',
  // Every reward paid, /payouts (src/components/payouts/): public, the same for everyone, like rankings; its ?cursor is
  // not in GA4_PAGE_LOCATION_ALLOW, so page_location drops it.
  'payouts',
  // A failed sign-in's landing, the home page's address under ?sign-in=failed (src/routes/match.ts signInErrorOf): where
  // the server sends a provider's redirect it refused, and the app draws one sentence and Try again in the board's
  // place (src/components/auth/SignInError.tsx). Never `board`: the reader did not see the board. Its ?sign-in,
  // ?provider and ?error are not in GA4_PAGE_LOCATION_ALLOW, so page_location drops them and reads as the home page's:
  // page_type alone tells the two apart.
  'sign-in-error',
  // Your bets, /bets (src/components/market/BetsPage.tsx; src/routes/match.ts betsRouteOf): signed-in and unlisted like
  // notifications, connect and discord, and tracked like them; no competition_slug. Only where the server shows side
  // bets: elsewhere the path draws the not-found page and reads `other`.
  'bets',
] as const;
export const GA4_UNTRACKED_PAGE_TYPES = ['admin', 'admin-competition', 'admin-entry', 'admin-explore', 'styleguide', 'unsubscribe'] as const;

/** Ad click ids a landing keeps in page_location, and the network each marks. */
export const GA4_CLICK_IDS = {
  gclid: 'google',
  gbraid: 'google',
  wbraid: 'google',
  msclkid: 'microsoft',
  fbclid: 'meta',
  twclid: 'x',
  ttclid: 'tiktok',
  li_fat_id: 'linkedin',
  rdt_cid: 'reddit',
} as const;

/** The campaign tags a landing keeps in page_location. */
export const GA4_UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'] as const;

/**
 * The query keys a page_location may carry: the campaign tags, the ad click ids, and the keys the app's own
 * routes read (?tab= the profile and board tabs, ?sort= the board's order, ?order= the rankings', ?view= the
 * leaderboard's, ?examples= the board's examples switch). Every other key is dropped, as is the fragment.
 */
export const GA4_PAGE_LOCATION_ALLOW: readonly string[] = [
  ...GA4_UTM_KEYS,
  ...Object.keys(GA4_CLICK_IDS),
  'tab', 'sort', 'order', 'view', 'examples',
];

/**
 * Keys that are never allowed in, each a secret or a visitor's own text: the agent connect page's ?code=
 * (a device user code that approves an agent), the delegation page's ?message= (a payout delegation to
 * sign), the board's ?q= (what the visitor typed), ?claim= and ?merge= (ids of a claim and a merge).
 */
export const GA4_PAGE_LOCATION_DENY = ['code', 'message', 'q', 'claim', 'merge'] as const;

/**
 * A path prefix whose remainder is a person or a secret and is replaced whole: a profile's /u/<handle> reads
 * /u/:handle, an invite link's /r/<code> (the code names the account it credits) reads /r/:code, and an email's
 * unsubscribe link /email/unsubscribe/<token> (src/routes/match.ts UNSUBSCRIBE_PATH) reads
 * /email/unsubscribe/:token, so none reaches GA as a page_referrer or the error beacon's page either.
 */
export const GA4_PAGE_LOCATION_PATH_REWRITES = [
  { prefix: '/u/', to: '/u/:handle' },
  { prefix: '/r/', to: '/r/:code' },
  { prefix: '/email/unsubscribe/', to: '/email/unsubscribe/:token' },
] as const;

/**
 * The page_location to send for a page: its origin and path (a profile's handle or a token replaced), and only the
 * query keys GA4_PAGE_LOCATION_ALLOW names; the fragment dropped. The client's page_location and the
 * server's both come from here, so a /connect?code= or a /delegate?message= never leaves the browser or the
 * server. '' for a string that is not an absolute URL.
 */
export function ga4PageLocation(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return '';
  }
  let path = url.pathname;
  for (const rewrite of GA4_PAGE_LOCATION_PATH_REWRITES) if (path.startsWith(rewrite.prefix)) path = rewrite.to;
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) if (GA4_PAGE_LOCATION_ALLOW.includes(key)) kept.append(key, value);
  const query = kept.toString();
  return `${url.origin}${path}${query === '' ? '' : `?${query}`}`;
}
