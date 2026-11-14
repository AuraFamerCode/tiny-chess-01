// The house judge's model call: the only code that sends a judge request (a ProgramJudge heat).
//
// A heat opens (openJudgeHeat) in three steps, each of which can hold it before anything is spent:
//
//   preflight   judgePreflight: the heat's planned calls (judgeHeatCalls, the caller's figure), each
//               sent at most JUDGE_CALL_ATTEMPTS times, at the worst case of the dearest body any of
//               them can send (grader/gateway/policy.ts worstCaseMicroUsd, the gateway's own pricing:
//               body bytes / 3 input tokens at the dearest input class, an image by its pixels instead
//               (judgeImageTokens), a dossier's text by its bytes and each of its images by its pixels,
//               plus max_output_tokens): the heat's figures, and the request ledger
//               its calls are sent against (JudgeHeat.requestsLeft: the planned calls × JUDGE_CALL_ATTEMPTS).
//               The pinned model has no pricing row: the heat is held (JudgeHold `unpriced`) and nothing is
//               minted. No spend figure holds a heat: every heat (final, provisional or local) opens whatever
//               its worst case and sends every call its schedule plans, held by nothing but `unpriced` and
//               `vision`.
//   key        broker.mintJudgeKey (grader/gateway/masq.ts judgeKeyRequest): label
//               makefun/<slug>/judge/<phase>/<attempt>, the pinned model alone, for under 24 h, with no
//               dollar cap: its ledger, max_output_tokens, the one pinned model and its life bound it.
//               It resolves once masq answers the new key (masq.ts: a fresh key reads 401 for a few
//               seconds), with masq's model list (GET /v1/models) as the key read it: the live card.
//   vision      an image or dossier heat reads the pinned model's card (the mint's list; a broker that read none,
//               GET /v1/models on the key), else the card of an id masq routes it to (server/house-model.ts
//               masqAllowedModels: superbot's superbot-router/superbot): capabilities.supports_vision not
//               true (a stale router card reads null or false) holds the heat (JudgeHold `vision`), its key
//               retired with nothing spent on it. No card at all holds it too, but for the superbot family,
//               whose card masq does not list and whose routing catalog says it reads images
//               (SUPERBOT_FAMILY_VISION). A vendor capability precondition, never a content check.
//
// A held heat is the caller's to defer and page (judgeHoldPage; worker.ts holdJudgeHeat).
//
// Each call (JudgeHeat.call) sends one POST <MAKEFUN_LLM_GATEWAY_URL>/v1/chat/completions (a Claude model's
// /v1/messages: `dialect` below) on the heat's key with MASQ_REVIEW_HEADERS (x-masq-policy: off, no cross-vendor hop; x-masq-verbatim: 1, no
// request rewrite) and x-cosmos-side-spawn (JUDGE_SIDE_SPAWN: a one-shot request, so masq places no
// cache breakpoint of its own and writes no cache the chat answer could not report; see judgeUsageOf),
// modelled on server/entries/ai-review.ts masqProvider:
//
//   system      the HouseAgent prompt file, then JUDGE_VERDICT_INSTRUCTIONS (the house suffix): one JSON
//               object, reason first, {"reason": ≤ JUDGE_REASON_MAX characters, "winner": "A"|"B", "margin":
//               1..5} (verdict v2: the comparison written before the pick, then how far the winner is ahead,
//               1 by a hair to 5 overwhelmingly), never a tie, and nothing about the entries' content: what an
//               entry may say to the judge is the owner's prompt's to rule on. Verdict v1 ({"winner",
//               "reason"}: JUDGE_HOUSE_TEXT_V1, JUDGE_VERDICT_SCHEMA_V1) is what agent-fun/judge-heat/v1
//               records were sent in; it stays only so they rebuild byte for byte (judgeRequestBody's `verdict`,
//               judgeVerdictOf), and no heat asks it again.
//   user        "Entry A" then "Entry B", each under its heading (JUDGE_ENTRY_HEADING). A text artifact is
//               wrapped in a tag named after its own sha256 (entryDataTag) under one neutral line
//               (JUDGE_ENTRY_FRAME), framing only: nothing is filtered or rewritten. An image is its exact
//               bytes in an image_url part, a base64 data URL whose media type is read from its magic bytes
//               (judgeImageType), never re-encoded. A dossier (contracts/dossier.ts parseDossier) is its
//               images, each its exact bytes in an image_url part (its own base64 in a data URL of its
//               media_type), then its text framed as a text artifact is. The message ends with JUDGE_ANSWER_LINE.
//   house text  those four and the verdict tool's description (JUDGE_HOUSE_TEXT) are what a heat's setup
//               records (house_text), and a heat builds its requests from the text it is handed, so a
//               record is rebuilt from its own. The verdict's JSON schema and the tag are structure, not text.
//   answer      superbot-fast (masqSkipsJsonMode): a json_schema response_format with strict false
//               (strict answers HTTP 400) and reasoning_effort none unless the HouseAgent names one;
//               every other model: response_format json_object, as ai-review asks. Temperature only
//               when the HouseAgent sets one; never a seed (masq keeps it only between same-dialect hops).
//   dialect     a Claude model is asked on masq's POST /v1/messages in its own dialect (judgeWire,
//               server/entries/ai-review.ts masqWire: the key as x-api-key, anthropic-version), the body
//               grader/dialect.ts chatToMessages makes of the request above, its `answer` asking the
//               verdict's schema as structured output (output_config.format) where Chat asked json_object,
//               and the system prompt under one cache breakpoint; its answer read back as Chat Completions
//               (masqAnswerText). A request the dialect cannot say, and every superbot-family call, goes
//               on Chat Completions byte for byte as before. request_sha256 names the bytes sent either way.
//   retry       an answer that is not a verdict (unparseable, refused, cut at finish_reason length,
//               answered by another model, or an HTTP 400/413/422) is asked once more as a forced NAMED
//               tool call (tool_choice {type: function, function: {name: verdict}}: masq downgrades
//               any/required to auto on DeepSeek); still none, the call is recorded with verdict null.
//   no force    a model that takes no forced tool (its card's capabilities.reasoning.can_disable is
//               false: it always thinks, and Anthropic refuses a forced tool to a thinking model;
//               masq's json_object is a forced tool there too) is asked in the unforced pair instead
//               (judgeFormsOf): the answer with no response_format (the system prompt alone asks for
//               the JSON), then the verdict tool offered with tool_choice auto. A forced form masq
//               refuses so (HTTP 400 "tool_choice … not supported") is retried as tool_auto, and the
//               heat's later calls are asked in the unforced pair. Each attempt records its form.
//   fresh key   a 401 on a key minted less than MASQ_KEY_WARMUP_MS ago is re-sent, the same bytes,
//               after a wait (MASQ_KEY_WARMUP_GAP_MS, doubling): masq not yet knowing the key is no
//               attempt, neither stored nor recorded (masq refused it before any model saw it).
//   rate limit  a 429 (masq: no pooled capacity for the request), or a 503 naming its Retry-After, is
//               re-sent, the same bytes, after the Retry-After (capped at JUDGE_RETRY_AFTER_MAX_MS) or,
//               naming none, JUDGE_RATE_LIMIT_GAP_MS doubling, jittered ±25%: at most
//               JUDGE_RATE_LIMIT_RESENDS re-sends and JUDGE_RATE_LIMIT_WAIT_MS waited a call, past which the
//               last answer is the fault. A heat sends many calls at once (worker.ts JUDGE_HEAT_CONCURRENCY), and
//               a burst of 429s must not spend its one resend. Like a fresh key's 401, a rate-limited request
//               reached no model and masq bills none: no attempt, neither stored, recorded nor metered, so the
//               call's record is a serial run's. masq's 402 (the key's cap) is never re-sent. Each re-send is
//               the pool pushing back: the heat counts it (JudgeHeat.pushbacks, through onRateLimited), and
//               its sender narrows on it (worker.ts sendJudgeHeatCalls).
//   faults      masq unreachable, an answer whose body could not be read (the connection cut, the
//               timeout), or any other non-2xx status (a key, cap, rate or upstream fault, the rate limits
//               above once their re-sends are spent), throws JudgeCallFault: the platform's failure, never
//               the entries'.
//   scope       a 403 that is masq's scope refusal (`this key is not scoped for model <id>`: the minted key's
//               allowedModels, not the call) also pages a `[model-key] ALERT: ` line (server/house-model.ts
//               watchMasqScope), once for every heat's minted key until a judge call answers again, never the key.
//   timeout     each masq request is bounded by JUDGE_CALL_TIMEOUT_MS (240 s) unless the caller names another
//               (a router request's head alone: `router` below):
//               a judge's reasoning comes out of max_output_tokens, and a bundle's 12,100 takes ~220 s at
//               the ~55 tokens a second superbot/high streams. masq's model list keeps MASQ_TIMEOUT_MS.
//   router      a heat whose key superbot-router holds (routerOfKey(minted): server/superbot-router.ts judgeKeyBroker
//               mints there for superbot, superbot-fast, superbot-flash or a DeepSeek-V4.1-Flash id while
//               MAKEFUN_SUPERBOT_ROUTER_URL and _KEY are set) sends every call to the router instead, at its
//               origin, none of masq's headers, `x-sbr-speed: flex` (the owner's call, 2026-11-11), the Chat
//               Completions body above with the model as the router names it (routerWireModel), streamed
//               (Cloudflare cuts a silent answer at 125 s, and a judge's can take 220 s): on POST /v1/messages
//               (x-api-key, anthropic-version) as the Messages body server/superbot-router.ts routerMessagesBody
//               makes of it wherever it maps (the owner: "prefer anthropic dialect over openai where possible"),
//               else on POST /v1/chat/completions (Bearer) as before (routerWire). request_sha256 names those bytes
//               (judgeRequestJson ROUTER_MESSAGES_DIALECT or ROUTER_DIALECT rebuilds them); what is stored is the
//               document the stream assembles to (routerAnswerIn: a Messages document, read as the Chat
//               Completions answer it says as a masq Messages answer is; a Chat Completions one, read as chat). A
//               2xx stream that is no answer (an error frame, a cut, a frame that is not JSON) is
//               an answer that could not be read: a JudgeCallFault with no status, naming the answer's request-id,
//               nothing stored, no attempt, not metered (the heat's ledger counts it a request sent, as any fault
//               with no status).
//               A flex ask may park at the router for the batch lane's 600 s before its first token, so no total
//               bounds a router call (routerDial): the call's timeout holds the head alone, then the router's own
//               first-byte bound (x-sbr-ttft-budget-ms, moved by each `: queued` comment) and its idle cut do.
//               The judge call is the path's one retry layer, and its ladder is the router's own (clients.md §4.5 and
//               CL-2; ~/.cosmos/rules/superbot-router-client.mdc: a batch-lane key's ladder is still the path's only
//               layer): every refusal that names a wait the router allows re-sent — a 429, 503 or 529 (the Messages
//               façade's pool full) routerResendable allows with a retry-after (routerNamedWaitMs), or a 2xx stream
//               whose in-band error came before any content block, names retry_after and does not say retryable false
//               (routerInBandWaitMs) — is waited out whole, however long, and the same bytes sent again (a pushback,
//               no attempt), as many times as the router refuses so, for as long as the call's signal stands (a heat's
//               job bounds it: its expiry and heartbeat abort the signal, and an abort mid-wait ends the call, never
//               final). No count, no ceiling, no wait of our own: never one naming no wait, never x-should-retry: false
//               (permanent). A 401 is a fault at once (a
//               static key has no warm-up), and a scope refusal pages the router's fix. Its vision and forms cards are
//               the router's own list's, and a card whose max_output_tokens (the key's ceiling: the router clamps a
//               request past it) is under the HouseAgent's faults the opening with nothing sent. Every other heat, a
//               Claude judge's included, goes to masq as above, byte for byte.
//   final       on superbot-router nothing else is sent again by any layer (clients.md CL-2: one retry layer a path;
//               §4.5: "no layer re-sends a router 5xx that carries no router retry-after"; §4.7: a stream cut after the
//               head is one outcome no layer retries; CL-3: "Never on a reset, termination or overflow"): a fault the
//               router answered — any refused status, a 2xx stream that is no answer, a body cut mid-read, a dial that
//               timed out or reset — is JudgeCallFault.final, and the heat (JudgeHeat.call) refuses its fault re-send
//               of that call (the same ordered pair) unsent, a final fault with no attempt and no request of the ledger.
//               Only what the router never saw stays open to the heat's one fault re-send (clients.md §4.4, CL-3, "Re-dial
//               only when the router saw nothing"): a refused connect (routerRefusedConnect), Envoy's connect-failure 503
//               and the bare 403 `Access denied` (routerGatewayRedialable). A masq fault is never final.
//   served      a router heat logs one line as it retires (JudgeHeatOptions.log, default stderr), never a record field:
//               its answers' served tier (usage.speed, or service_tier on Chat), x-sbr-lane and every x-sbr-ignored value,
//               tallied (server/superbot-router.ts routerServedOf, routerServedWords).
//   openrouter  a heat whose key OpenRouter's broker minted (openRouterOfKey(minted): server/openrouter-judge.ts
//               openRouterJudgeBroker, a static key) is opened on the pin it is handed (JudgeHeatOptions.pin, a
//               JudgePin): no model list is read, its forms are the pin's, an image or dossier heat on a pin whose model reads
//               no images is the `vision` hold, a judge asking past the pin's max_output_tokens or an effort it
//               does not list faults the opening with nothing sent, and its preflight never holds for a missing
//               price (its dollar figures stay null). Each request POSTs openRouterRequestJson of the `messages`
//               body to <openRouterApiBase(origin)>/chat/completions with openRouterHeaders (Superbot's app attribution: the referer, title and categories), bounded
//               whole by the call's timeout as on masq, the stream read whole and stored as the document it
//               assembles to (openRouterAnswerOf). One named wait a call (openRouterNamedWaitMs, else the error
//               body's own: openRouterBodyWaitMs) is waited, at most JUDGE_RATE_LIMIT_WAIT_MS, and the same bytes
//               sent again: a pushback, no attempt. Everything else OpenRouter answered is final as on the router
//               (a 400, 413 or 422 stays answer-level; only a refused connect stays open to the heat's re-send),
//               a 2xx that is no answer is a fault with no attempt. An answer from another model, or from a
//               provider not the pin's (openRouterServedByPin), is no verdict. The attempt records the provider
//               the answer names (`provider`, its display name: two endpoints of one provider read alike and the
//               answer never names its quantization, so the endpoint's tag and quantization are the heat's
//               `judges`' to record) and usage.cost as micro_usd (else priceOf); the call sums what its answers'
//               usage.cost_details names by kind into micro_usd_by_kind (input: the prompt inference, output: the
//               completion), null when none names one.
//
// Every response body is stored as a blob (JudgeBlobs.put) before it is read, and each attempt's usage
// is priced by pricing/price.ts priceUsage at the attempt's instant: the heat's meter, which retire()
// hands to retireTrialKey so masq's settled spend is checked against it (its flags go in the record).
// The model that answered is checked on the x-masq-model header and the completion's `model`
// (isServedModel): a release-dated alias of the pinned model is the pinned model.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CassetteUsageT } from '../contracts/agent.ts';
import type { HouseAgentT } from '../contracts/competition.ts';
import { DossierRefused, parseDossier, type DossierT } from '../contracts/dossier.ts';
import { priceUsage } from '../pricing/price.ts';
import {
  answerJsonOf,
  entryDataTag,
  MASQ_REVIEW_HEADERS,
  MASQ_TIMEOUT_MS,
  masqAnswerText,
  masqAuthHeaders,
  masqMessagesBody,
  masqSkipsJsonMode,
  masqWire,
  SUPERBOT_UNNAMED_EFFORT,
  withoutThinking,
  type MasqDialect,
  type MasqWire,
} from '../server/entries/ai-review.ts';
import { setTimeout as delay } from 'node:timers/promises';
import {
  MASQ_KEY_WARMUP_GAP_MS,
  MASQ_KEY_WARMUP_MS,
  MASQ_MODELS_PATH,
  retireTrialKey,
  type BrokerCallOptions,
  type JudgeKeyPhase,
  type JudgeKeySpec,
  type MasqJudgeKeyBroker,
  type MasqModelCard,
  type RetiredTrialKey,
} from './gateway/masq.ts';
import { BYTES_PER_INPUT_TOKEN, worstCaseMicroUsd } from './gateway/policy.ts';
import { isServedModel, MASQ_MODEL_HEADER } from './gateway/upstream.ts';
import {
  ROUTER_DIALECT,
  ROUTER_MESSAGES_DIALECT,
  routerAnswerIn,
  routerCeilingFault,
  routerDial,
  routerFailureCode,
  routerGatewayRedialable,
  routerHeaders,
  routerInBandOf,
  routerInBandWaitMs,
  routerNamedWaitMs,
  routerOfKey,
  routerRefusedConnect,
  routerRequestJson,
  routerRequestJsonIn,
  routerRetryAfterMs,
  routerServedOf,
  routerServedWords,
  routerServesModel,
  routerWire,
  routerWireModel,
  type RouterAnswer,
  type RouterDial,
  type RouterDialect,
  type RouterServed,
} from '../server/superbot-router.ts';
import { isSuperbotFamily, masqAllowedModels, SUPERBOT_FAMILY_VISION, watchMasqScope } from '../server/house-model.ts';
import { countJudgeCall, type JudgeDoor, type JudgeTokenKind } from '../server/ops/metrics.ts';
import {
  OPENROUTER_CHAT_PATH,
  OPENROUTER_DIALECT,
  OPENROUTER_IN_FLIGHT_BUDGET,
  openRouterAnswerOf,
  openRouterApiBase,
  openRouterHeaders,
  openRouterNamedWaitMs,
  openRouterOfKey,
  openRouterRequestJson,
  openRouterServedByPin,
  openRouterServedOf,
  openRouterSpendSplitOf,
  type JudgePin,
  type OpenRouterAnswer,
  type OpenRouterServed,
} from '../server/openrouter-judge.ts';

/** The longest reason a verdict keeps, in characters; a longer one is cut here. */
export const JUDGE_REASON_MAX = 600;
/** The forced tool's name, and the json_schema's. */
export const JUDGE_VERDICT_TOOL = 'verdict';
/** Requests one call may send: the answer, then one forced-tool retry. */
export const JUDGE_CALL_ATTEMPTS = 2;
/**
 * One judge request's bound, ms (the header's `timeout`), unless the caller names another: a judge reasons before it
 * answers, and its reasoning is paid out of max_output_tokens. superbot at high effort as the judge (2026-11-09, 128
 * calls) reasoned to 7,921 tokens at p99 and streamed 51-59 tokens a second on its slow calls, so a bundle pins
 * max_output_tokens 12,100 (1.5 × p99), which at ~55 tokens a second takes ~220 s: past MASQ_TIMEOUT_MS (120 s, the
 * AI review's, shared by the house calls), which stays as it is. masq's model list keeps that shorter bound.
 */
export const JUDGE_CALL_TIMEOUT_MS = 240_000;
/**
 * The most times one call re-sends a rate-limited request (the header's `rate limit`): a heat sends up to
 * worker.ts JUDGE_HEAT_CONCURRENCY calls at once, and a burst of masq 429s must not spend the heat's one resend.
 */
export const JUDGE_RATE_LIMIT_RESENDS = 4;
/**
 * The most one masq call waits out rate limits, ms, its waits summed: past it the rate-limited answer is the fault. A
 * superbot-router call has no such bound: it waits every wait the router names, whole (the header's `router`).
 */
export const JUDGE_RATE_LIMIT_WAIT_MS = 120_000;
/** The first wait before a rate-limited request is re-sent when masq names none (Retry-After), ms: doubling, jittered ±25%. */
export const JUDGE_RATE_LIMIT_GAP_MS = 2_000;
/** The longest Retry-After a call waits, ms: a longer one is waited this long. */
export const JUDGE_RETRY_AFTER_MAX_MS = 30_000;

/**
 * A Retry-After header's wait, ms, read at `nowMs` (RFC 9110 §10.2.3: delay-seconds, or an HTTP-date), capped at
 * JUDGE_RETRY_AFTER_MAX_MS; null when there is none or it does not read.
 */
export function judgeRetryAfterMs(header: string | null, nowMs: number): number | null {
  if (header === null) return null;
  const v = header.trim();
  if (v === '') return null;
  let ms: number;
  if (/^[0-9]+$/.test(v)) ms = Number(v) * 1000;
  else {
    // An HTTP-date names its day and zone in letters; V8 reads bare numbers ("1.5") as dates.
    if (!/[a-z]/i.test(v)) return null;
    const at = Date.parse(v);
    if (Number.isNaN(at)) return null;
    ms = Math.max(0, at - nowMs);
  }
  return Math.min(ms, JUDGE_RETRY_AFTER_MAX_MS);
}

/** masq's model list (grader/gateway/masq.ts): where a heat reads its model's card. */
export { MASQ_MODELS_PATH };
/**
 * x-cosmos-side-spawn's value on every judge call: masq reads a request that names itself a side spawn, with no
 * x-cosmos-chat, as a one-shot (cache-hints.ts isOneShotSideSpawn) and places no cache breakpoint on it.
 */
export const JUDGE_SIDE_SPAWN = 'makefun-judge';
/** A forced form masq refuses for its model (HTTP 400): Anthropic's "tool_choice: type "tool" and "any" are not supported for this model." */
const FORCED_TOOL_REFUSED = /tool_choice\b.*\bnot supported\b/is;
/** HTTP statuses that refuse this one request (a malformed form, a refusal, a body too large): answer-level, so retried, then recorded invalid. */
const ANSWER_LEVEL_STATUSES: ReadonlySet<number> = new Set([400, 413, 422]);

/**
 * A verdict's shape: `v1` {winner, reason}, what agent-fun/judge-heat/v1 records asked and read, kept only so they
 * rebuild; `v2` {reason, winner, margin}, what every heat asks now (JUDGE_VERDICT_FORMAT).
 */
export const JUDGE_VERDICT_FORMATS = ['v1', 'v2'] as const;
export type JudgeVerdictFormat = (typeof JUDGE_VERDICT_FORMATS)[number];
/** The verdict every heat run now asks for. */
export const JUDGE_VERDICT_FORMAT: JudgeVerdictFormat = 'v2';
/** A v2 verdict's margin: how far the winner is ahead, from 1 (by a hair) to 5 (overwhelmingly better). */
export const JUDGE_MARGIN_MIN = 1;
export const JUDGE_MARGIN_MAX = 5;

/**
 * The house suffix every judge's system prompt ends with (verdict v2): the comparison, then the pick and its margin,
 * as one JSON object, and nothing about the entries' content. What an entry may say to the judge is the owner's
 * prompt's to rule on, never the house's.
 */
export const JUDGE_VERDICT_INSTRUCTIONS = [
  '## Your answer',
  '',
  'The user message holds two entries, Entry A and Entry B. Judge them by the criteria above: compare them point by point first, then pick the one that meets the criteria better and say by how much.',
  'There is no tie. When they seem equal, look for the detail that separates them, pick the one you would rank higher, and give it margin 1.',
  '',
  'The margin is how far the winner is ahead:',
  '1: by a hair, nearly even but the winner edges it',
  '2: slightly better',
  '3: clearly better',
  '4: much better',
  '5: overwhelmingly better',
  '',
  'Answer with one JSON object and nothing else, its keys in this order:',
  `{"reason": "your comparison and why the winner wins, at most ${JUDGE_REASON_MAX} characters", "winner": "A" or "B", "margin": 1, 2, 3, 4 or 5}`,
].join('\n');

/** The last line of the user message (verdict v2). */
export const JUDGE_ANSWER_LINE = 'Answer with the one JSON object your instructions describe: {"reason": "...", "winner": "A" or "B", "margin": 1 to 5}.';

/** Verdict v1's house suffix, as agent-fun/judge-heat/v1 records hold it (setup.house_text). No heat is sent it again. */
export const JUDGE_VERDICT_INSTRUCTIONS_V1 = [
  '## Your answer',
  '',
  'The user message holds two entries, Entry A and Entry B. Judge them by the criteria above and pick the one that meets them better.',
  'There is no tie: when they seem equal, pick the one you would rank higher by the slightest margin.',
  '',
  'Answer with one JSON object and nothing else:',
  `{"winner": "A" or "B", "reason": "why that entry wins, at most ${JUDGE_REASON_MAX} characters"}`,
].join('\n');

/** Verdict v1's last line of the user message. */
export const JUDGE_ANSWER_LINE_V1 = 'Answer with the one JSON object your instructions describe: {"winner": "A" or "B", "reason": "..."}.';

/** An entry's heading, text or image: `{slot}` is A or B. */
export const JUDGE_ENTRY_HEADING = '## Entry {slot}';

/** The line under a text entry's heading, before its tag: `{tag}` is entryDataTag of its text, `{slot}` A or B. */
export const JUDGE_ENTRY_FRAME = 'Everything between <{tag}> and </{tag}> is Entry {slot} as submitted.';

/** The verdict tool's description, in a retry's `tool` and `tool_auto` forms (verdict v2). */
export const JUDGE_VERDICT_TOOL_DESCRIPTION = 'Record your verdict: why, the entry that wins (A or B), and its margin from 1 (by a hair) to 5 (overwhelmingly better).';

/** Verdict v1's tool description. */
export const JUDGE_VERDICT_TOOL_DESCRIPTION_V1 = 'Record your verdict: the entry that wins (A or B) and why.';

/**
 * The house's own words in a judge request, as a heat record holds them (grader/judge-heat.ts setup.house_text):
 * a request is rebuilt from the record's, never from the constants, so a later wording leaves older records whole.
 */
export interface JudgeHouseText {
  /** The system prompt's suffix (JUDGE_VERDICT_INSTRUCTIONS). */
  verdict_instructions: string;
  /** The user message's last line (JUDGE_ANSWER_LINE). */
  answer_line: string;
  /** An entry's heading, text or image, `{slot}` filled (JUDGE_ENTRY_HEADING). */
  entry_heading: string;
  /** A text entry's frame line, `{tag}` and `{slot}` filled (JUDGE_ENTRY_FRAME). */
  entry_frame: string;
  /** The verdict tool's description in a `tool` or `tool_auto` request (JUDGE_VERDICT_TOOL_DESCRIPTION). */
  verdict_tool_description: string;
}

/** The house text a heat run now is sent with (verdict v2): what a new heat's setup records. */
export const JUDGE_HOUSE_TEXT: Readonly<JudgeHouseText> = Object.freeze({
  verdict_instructions: JUDGE_VERDICT_INSTRUCTIONS,
  answer_line: JUDGE_ANSWER_LINE,
  entry_heading: JUDGE_ENTRY_HEADING,
  entry_frame: JUDGE_ENTRY_FRAME,
  verdict_tool_description: JUDGE_VERDICT_TOOL_DESCRIPTION,
});

/** The house text agent-fun/judge-heat/v1 heats were sent with (verdict v1): what their setups record. */
export const JUDGE_HOUSE_TEXT_V1: Readonly<JudgeHouseText> = Object.freeze({
  verdict_instructions: JUDGE_VERDICT_INSTRUCTIONS_V1,
  answer_line: JUDGE_ANSWER_LINE_V1,
  entry_heading: JUDGE_ENTRY_HEADING,
  entry_frame: JUDGE_ENTRY_FRAME,
  verdict_tool_description: JUDGE_VERDICT_TOOL_DESCRIPTION_V1,
});

/**
 * The verdict's JSON schema (v2): the json_schema response_format's and the forced tool's parameters. Its keys in the
 * order the model writes them: the reason first, so the comparison comes before the pick, then the winner and margin.
 */
export const JUDGE_VERDICT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    reason: Object.freeze({ type: 'string', maxLength: JUDGE_REASON_MAX, description: `Your comparison and why the winner wins, at most ${JUDGE_REASON_MAX} characters.` }),
    winner: Object.freeze({ type: 'string', enum: Object.freeze(['A', 'B']), description: 'The entry that wins: A or B. Never a tie.' }),
    margin: Object.freeze({
      type: 'integer',
      minimum: JUDGE_MARGIN_MIN,
      maximum: JUDGE_MARGIN_MAX,
      description: 'How far the winner is ahead: 1 by a hair, 2 slightly, 3 clearly, 4 much, 5 overwhelmingly better.',
    }),
  }),
  required: Object.freeze(['reason', 'winner', 'margin']),
  additionalProperties: false,
});

/** Verdict v1's JSON schema, byte for byte what agent-fun/judge-heat/v1 requests carried. */
export const JUDGE_VERDICT_SCHEMA_V1 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    winner: Object.freeze({ type: 'string', enum: Object.freeze(['A', 'B']), description: 'The entry that wins: A or B. Never a tie.' }),
    reason: Object.freeze({ type: 'string', maxLength: JUDGE_REASON_MAX, description: `Why that entry wins, at most ${JUDGE_REASON_MAX} characters.` }),
  }),
  required: Object.freeze(['winner', 'reason']),
  additionalProperties: false,
});

/** The JSON schema a request in verdict `format` carries. */
export function judgeVerdictSchema(format: JudgeVerdictFormat): typeof JUDGE_VERDICT_SCHEMA | typeof JUDGE_VERDICT_SCHEMA_V1 {
  if (format === 'v1') return JUDGE_VERDICT_SCHEMA_V1;
  if (format === 'v2') return JUDGE_VERDICT_SCHEMA;
  throw new RangeError(`verdict format ${JSON.stringify(format)} is not one of ${JUDGE_VERDICT_FORMATS.join(', ')}`);
}

const Winner = z.string().trim().toUpperCase().pipe(z.enum(['A', 'B']));
const Reason = z.string().transform((s) => s.trim().slice(0, JUDGE_REASON_MAX));
/** A margin as an answer gives it: a JSON integer, or a string of one digit (trimmed); 1 to 5 either way. */
const Margin = z
  .union([z.int(), z.string().trim().regex(/^[0-9]$/, 'one digit').transform(Number)])
  .pipe(z.int().min(JUDGE_MARGIN_MIN).max(JUDGE_MARGIN_MAX));

/**
 * A v2 verdict as read from an answer: the winner A or B (any case, trimmed), the margin an integer 1 to 5 (a JSON
 * integer, or a string of one digit, trimmed), the reason cut at JUDGE_REASON_MAX. A margin missing or out of range is
 * no verdict.
 */
export const JudgeVerdictAnswer = z.object({
  reason: Reason,
  winner: Winner,
  margin: Margin,
});

/** A v1 verdict as read from an answer (agent-fun/judge-heat/v1): the winner A or B (any case, trimmed), the reason cut at JUDGE_REASON_MAX. */
export const JudgeVerdictAnswerV1 = z.object({
  winner: Winner,
  reason: Reason,
});

/** A verdict read off an answer: v1's carries margin null. */
export type JudgeVerdictRead = { ok: true; winner: 'A' | 'B'; reason: string; margin: number | null } | { ok: false; why: string };

/**
 * What an answer's text reads as in verdict `format` (default JUDGE_VERDICT_FORMAT): the verdict (a v1 verdict's margin
 * null), or why it is none. The one reading sendJudgeCall takes, and a record's verifier re-reads its bodies with.
 */
export function judgeVerdictOf(text: string, format: JudgeVerdictFormat = JUDGE_VERDICT_FORMAT): JudgeVerdictRead {
  if (!(JUDGE_VERDICT_FORMATS as readonly string[]).includes(format)) throw new RangeError(`verdict format ${JSON.stringify(format)} is not one of ${JUDGE_VERDICT_FORMATS.join(', ')}`);
  const read = answerJsonOf(text);
  if (!read.ok) return { ok: false, why: read.why };
  const notOne = (shape: string, error: z.ZodError): JudgeVerdictRead => ({
    ok: false,
    why: `not a verdict ${shape}: ${error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`.slice(0, 300),
  });
  if (format === 'v1') {
    const v1 = JudgeVerdictAnswerV1.safeParse(read.json);
    if (!v1.success) return notOne('{"winner": "A"|"B", "reason": string}', v1.error);
    return { ok: true, winner: v1.data.winner, reason: v1.data.reason, margin: null };
  }
  const v2 = JudgeVerdictAnswer.safeParse(read.json);
  if (!v2.success) return notOne('{"reason": string, "winner": "A"|"B", "margin": 1..5}', v2.error);
  return { ok: true, winner: v2.data.winner, reason: v2.data.reason, margin: v2.data.margin };
}

/** What a judge call sends of the HouseAgent (contracts/competition.ts). */
export type JudgeAgent = Pick<HouseAgentT, 'model' | 'max_output_tokens' | 'reasoning_effort' | 'temperature'>;

/** A heat's media (ProgramJudge.media, contracts/competition.ts PROGRAM_JUDGE_MEDIA). */
export type JudgeMedia = 'text' | 'image' | 'dossier';

/** Every media a heat may judge in, in PROGRAM_JUDGE_MEDIA's order. */
export const JUDGE_MEDIA: readonly JudgeMedia[] = Object.freeze(['text', 'image', 'dossier'] as const);

/** `media`, or a RangeError when it is no JudgeMedia (a record or caller naming another medium is judged in none). */
export function judgeMediaOf(media: string): JudgeMedia {
  if (!(JUDGE_MEDIA as readonly string[]).includes(media)) throw new RangeError(`judge media ${JSON.stringify(media)} is not one of ${JUDGE_MEDIA.join(', ')}`);
  return media as JudgeMedia;
}

/** A heat of `media`, in an admin's words ("a text heat", "an image heat", "a dossier heat"). */
export function judgeHeatNoun(media: JudgeMedia): string {
  switch (judgeMediaOf(media)) {
    case 'text':
      return 'a text heat';
    case 'image':
      return 'an image heat';
    case 'dossier':
      return 'a dossier heat';
  }
}

/** One entry's (or anchor's) artifact, as judged. */
export interface JudgeArtifact {
  /** The sha256 of `bytes` (lowercase hex): what a verdict and the record name. */
  sha256: string;
  /** Its exact bytes. */
  bytes: Uint8Array;
}

/** Where every response body is stored before it is read (server/blobstore.ts BlobStore fits). */
export interface JudgeBlobs {
  put(data: Uint8Array): Promise<{ sha256: string }>;
}

/**
 * Which request form an attempt sent (the header): the answer asked for as a response_format (`answer`) and the
 * forced-tool retry (`tool`), or, for a model that takes no forced tool, the answer the system prompt alone asks for
 * (`answer_plain`) and the retry that offers the verdict tool (`tool_auto`, tool_choice auto).
 */
export type JudgeForm = 'answer' | 'tool' | 'answer_plain' | 'tool_auto';

/** A call's two forms in the order sent: its answer, then its retry. */
export type JudgeForms = readonly [answer: JudgeForm, retry: JudgeForm];
/** The forms a call is asked in by default. */
export const JUDGE_FORCED_FORMS = Object.freeze(['answer', 'tool'] as const);
/** The forms a model that takes no forced tool is asked in (judgeFormsOf). */
export const JUDGE_UNFORCED_FORMS = Object.freeze(['answer_plain', 'tool_auto'] as const);
/** Every form a request can be sent in: the preflight weighs the dearest. */
const JUDGE_FORMS: readonly JudgeForm[] = [...JUDGE_FORCED_FORMS, ...JUDGE_UNFORCED_FORMS];

/** An artifact no judge request can carry: text that is not UTF-8, an image of a type masq does not take, or bytes that are no dossier. */
export class JudgeArtifactRefused extends Error {
  readonly sha256: string;
  constructor(sha256: string, message: string) {
    super(message);
    this.name = 'JudgeArtifactRefused';
    this.sha256 = sha256;
  }
}

/** masq unreachable, an answer whose body could not be read, or a status that is no answer (a key, cap, rate or upstream fault): the platform's failure. */
export class JudgeCallFault extends Error {
  /** The status masq answered; null when no answer was read (masq could not be reached, or its answer's body could not be read: a request sent, perhaps billed, with no attempt to show for it). */
  readonly status: number | null;
  /** The attempts of the call that did complete before the fault (each priced, its body stored). */
  readonly attempts: readonly JudgeAttempt[];
  /**
   * Whether no layer may send the call again (the header's `final`): superbot-router answered it, and its client contract
   * lets nothing re-send that answer past the call's one named wait (clients.md CL-2, §4.5, §4.7). False for every masq
   * fault, and on the router for a fault the router never saw (a refused connect, the Gateway's own connect-failure 503
   * or bare 403: clients.md §4.4, CL-3), which the heat's one fault re-send may dial again.
   */
  readonly final: boolean;
  constructor(message: string, status: number | null, attempts: readonly JudgeAttempt[], options?: { cause?: unknown; final?: boolean }) {
    super(message, options !== undefined && 'cause' in options ? { cause: options.cause } : undefined);
    this.name = 'JudgeCallFault';
    this.status = status;
    this.attempts = attempts;
    this.final = options?.final ?? false;
  }
}

// ------------------------------------------------------------------ the request

const sha256Hex = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** The media type an image's magic bytes name (PNG, JPEG, GIF, WebP: what masq's vendors take), or null. */
export function judgeImageType(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && (b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** ignoreBOM keeps a leading U+FEFF: the judge sees the entry as submitted, the character the gate counted included. */
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** A text artifact's text: its bytes as UTF-8, or JudgeArtifactRefused. */
function textOf(a: JudgeArtifact): string {
  try {
    return utf8.decode(a.bytes);
  } catch {
    throw new JudgeArtifactRefused(a.sha256, `artifact ${a.sha256} is not UTF-8 text, so a text heat cannot send it`);
  }
}

/** An image artifact's data URL: data:<type>;base64,<its exact bytes>, or JudgeArtifactRefused. */
function dataUrlOf(a: JudgeArtifact): string {
  const type = judgeImageType(a.bytes);
  if (type === null) throw new JudgeArtifactRefused(a.sha256, `artifact ${a.sha256} is not a PNG, JPEG, GIF or WebP image, so an image heat cannot send it`);
  return `data:${type};base64,${Buffer.from(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength).toString('base64')}`;
}

/** Each artifact's bytes' dossier once read: a heat builds the same artifact's content many times (the preflight, each call). */
const dossiers = new WeakMap<Uint8Array, DossierT>();

/** A dossier artifact's dossier (contracts/dossier.ts parseDossier), or JudgeArtifactRefused naming why its bytes are none. */
function dossierOf(a: JudgeArtifact): DossierT {
  const known = dossiers.get(a.bytes);
  if (known !== undefined) return known;
  let dossier: DossierT;
  try {
    dossier = parseDossier(a.bytes);
  } catch (err) {
    if (err instanceof DossierRefused) throw new JudgeArtifactRefused(a.sha256, `artifact ${a.sha256} cannot be sent in a dossier heat: ${err.message}`);
    throw err;
  }
  dossiers.set(a.bytes, dossier);
  return dossier;
}

/** A dossier artifact's image `part`'s data URL: data:<its media_type>;base64,<its own canonical base64>, its bytes as written. */
function dossierUrlOf(a: JudgeArtifact, part: number): string {
  const image = dossierOf(a).images[part];
  if (image === undefined) throw new RangeError(`dossier ${a.sha256} has no image ${part}`);
  return `data:${image.media_type};base64,${image.base64}`;
}

/** Image part `part`'s URL of an artifact (its image parts in order; an image artifact is one part, 0). */
type PartUrlOf = (art: JudgeArtifact, part: number) => string;

/** The data URL of each image part of an artifact in `media`: an image's own bytes, a dossier's images[part]; a text has none. */
function partUrlOf(media: JudgeMedia): PartUrlOf {
  switch (judgeMediaOf(media)) {
    case 'image':
      return (art) => dataUrlOf(art);
    case 'dossier':
      return dossierUrlOf;
    case 'text':
      return (art) => {
        throw new TypeError(`a text heat sends no image of artifact ${art.sha256}`);
      };
  }
}

/** The system prompt of a heat: the HouseAgent prompt file's text, then the house's verdict instructions (default JUDGE_VERDICT_INSTRUCTIONS). */
export function judgeSystemPrompt(prompt: string, house: Pick<JudgeHouseText, 'verdict_instructions'> = JUDGE_HOUSE_TEXT): string {
  return `${prompt.trimEnd()}\n\n${house.verdict_instructions}`;
}

export type JudgeContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/**
 * The user message of one call: Entry A (`a`), then Entry B (`b`), in the house text given (default
 * JUDGE_HOUSE_TEXT). Throws JudgeArtifactRefused on an artifact it cannot carry (in a dossier heat, one parseDossier
 * refuses), and RangeError on a media that is no JudgeMedia.
 */
export function judgeUserContent(media: JudgeMedia, a: JudgeArtifact, b: JudgeArtifact, house: JudgeHouseText = JUDGE_HOUSE_TEXT): string | JudgeContentPart[] {
  return userContentOf(media, a, b, partUrlOf(media), house);
}

/** An entry's heading: the template with `{slot}` filled. */
export function judgeEntryHeading(template: string, slot: 'A' | 'B'): string {
  return template.replace(/\{slot\}/g, () => slot);
}

/** A text entry's frame line: the template with `{tag}` and `{slot}` filled, in one pass (a filled value is never read again). */
export function judgeEntryFrame(template: string, tag: string, slot: 'A' | 'B'): string {
  return template.replace(/\{(tag|slot)\}/g, (_, k: string) => (k === 'tag' ? tag : slot));
}

/** A text framed for the judge: the frame line, then the text inside a tag named after it (entryDataTag), nothing filtered or rewritten. */
function framedText(house: JudgeHouseText, slot: 'A' | 'B', text: string): string {
  const tag = entryDataTag(text);
  return [judgeEntryFrame(house.entry_frame, tag, slot), `<${tag}>`, text, `</${tag}>`].join('\n');
}

/**
 * judgeUserContent with each image part's URL from `urlOf` (the preflight empties the ones it prices by their pixels):
 * an image heat's two images, each under its entry's heading; a dossier heat's entries each under its heading, its
 * images in order then its text framed as a text entry's; a text heat's one string. RangeError on any other media.
 */
function userContentOf(media: JudgeMedia, a: JudgeArtifact, b: JudgeArtifact, urlOf: PartUrlOf, house: JudgeHouseText): string | JudgeContentPart[] {
  const medium = judgeMediaOf(media);
  if (medium === 'image') {
    return [
      { type: 'text', text: judgeEntryHeading(house.entry_heading, 'A') },
      { type: 'image_url', image_url: { url: urlOf(a, 0) } },
      { type: 'text', text: judgeEntryHeading(house.entry_heading, 'B') },
      { type: 'image_url', image_url: { url: urlOf(b, 0) } },
      { type: 'text', text: house.answer_line },
    ];
  }
  if (medium === 'dossier') {
    const entry = (slot: 'A' | 'B', art: JudgeArtifact): JudgeContentPart[] => {
      const dossier = dossierOf(art);
      return [
        { type: 'text', text: judgeEntryHeading(house.entry_heading, slot) },
        ...dossier.images.map((_, part): JudgeContentPart => ({ type: 'image_url', image_url: { url: urlOf(art, part) } })),
        { type: 'text', text: framedText(house, slot, dossier.text) },
      ];
    };
    return [...entry('A', a), ...entry('B', b), { type: 'text', text: house.answer_line }];
  }
  const block = (slot: 'A' | 'B', art: JudgeArtifact): string => {
    const text = textOf(art);
    const tag = entryDataTag(text);
    return [judgeEntryHeading(house.entry_heading, slot), judgeEntryFrame(house.entry_frame, tag, slot), `<${tag}>`, text, `</${tag}>`].join('\n');
  };
  return [block('A', a), '', block('B', b), '', house.answer_line].join('\n');
}

/** The verdict tool a retry names (`tool`) or offers (`tool_auto`), under the house text's description, its parameters `schema`. */
function verdictTool(description: string, schema: ReturnType<typeof judgeVerdictSchema>): Record<string, unknown> {
  return { type: 'function', function: { name: JUDGE_VERDICT_TOOL, description, parameters: schema } };
}

/**
 * The chat-completions body of one request (deterministic: the same input gives the same bytes, so a
 * record's request_sha256 can be checked against its artifacts): the two messages and max_tokens,
 * temperature when the HouseAgent sets one, reasoning_effort when it names one (none on superbot-fast
 * otherwise), then by form (the header): `answer` asks for the verdict as a response_format, `tool`
 * forces the named verdict tool, `answer_plain` adds nothing (the system prompt asks for the JSON), and
 * `tool_auto` offers the verdict tool with tool_choice auto. The tool is described in `house`'s words
 * (default JUDGE_HOUSE_TEXT): the heat setup's house_text, as the user message is. The verdict's schema
 * (the json_schema's and the tool's) is `verdict`'s (default JUDGE_VERDICT_FORMAT): a record's own
 * (grader/judge-heat.ts judgeHeatVerdictFormat of its format), so an agent-fun/judge-heat/v1 record's
 * requests rebuild in v1's schema. `dialect` `messages` is the body the Messages request is made of (the
 * header's `dialect`): its `answer` asks the verdict's json_schema of every model, as structured output.
 */
export function judgeRequestBody(
  agent: JudgeAgent,
  system: string,
  user: string | JudgeContentPart[],
  form: JudgeForm,
  house: Pick<JudgeHouseText, 'verdict_tool_description'> = JUDGE_HOUSE_TEXT,
  verdict: JudgeVerdictFormat = JUDGE_VERDICT_FORMAT,
  dialect: MasqDialect = 'chat',
): Record<string, unknown> {
  const schema = judgeVerdictSchema(verdict);
  const superbot = masqSkipsJsonMode(agent.model);
  const effort = agent.reasoning_effort ?? (superbot ? SUPERBOT_UNNAMED_EFFORT : undefined);
  const base: Record<string, unknown> = {
    model: agent.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: agent.max_output_tokens,
    ...(agent.temperature !== undefined ? { temperature: agent.temperature } : {}),
    ...(effort !== undefined ? { reasoning_effort: effort } : {}),
  };
  if (form === 'tool') return { ...base, tools: [verdictTool(house.verdict_tool_description, schema)], tool_choice: { type: 'function', function: { name: JUDGE_VERDICT_TOOL } } };
  if (form === 'tool_auto') return { ...base, tools: [verdictTool(house.verdict_tool_description, schema)], tool_choice: 'auto' };
  if (form === 'answer_plain') return base;
  return {
    ...base,
    response_format: superbot || dialect === 'messages' ? { type: 'json_schema', json_schema: { name: JUDGE_VERDICT_TOOL, strict: false, schema } } : { type: 'json_object' },
  };
}

/**
 * The request one attempt sends (the header's `dialect`): on Messages when grader/dialect.ts can say judgeRequestBody's
 * `messages` body (a Claude model's, its images as data URLs), else judgeRequestBody's body on Chat Completions, the
 * bytes every judge request was before. Deterministic, as judgeRequestBody is.
 */
export function judgeWire(
  agent: JudgeAgent,
  system: string,
  user: string | JudgeContentPart[],
  form: JudgeForm,
  house: Pick<JudgeHouseText, 'verdict_tool_description'> = JUDGE_HOUSE_TEXT,
  verdict: JudgeVerdictFormat = JUDGE_VERDICT_FORMAT,
): MasqWire {
  return masqWire(judgeRequestBody(agent, system, user, form, house, verdict), judgeRequestBody(agent, system, user, form, house, verdict, 'messages'));
}

/**
 * The bytes a stored request sent in `dialect` rebuilds to (a verifier's: a record holds no dialect, its request_sha256
 * tells which it was): Chat Completions' judgeRequestBody, the Messages body judgeWire sends, or
 * superbot-router's streamed body of the Chat Completions one, on Chat Completions (ROUTER_DIALECT) or on Messages
 * (ROUTER_MESSAGES_DIALECT: routerRequestJsonIn; the header's `router`), or OpenRouter's on `pin` (OPENROUTER_DIALECT:
 * the header's `openrouter`); null when the request cannot be said on Messages.
 */
export function judgeRequestJson(
  dialect: MasqDialect | typeof ROUTER_DIALECT | typeof ROUTER_MESSAGES_DIALECT | typeof OPENROUTER_DIALECT,
  agent: JudgeAgent,
  system: string,
  user: string | JudgeContentPart[],
  form: JudgeForm,
  house: Pick<JudgeHouseText, 'verdict_tool_description'> = JUDGE_HOUSE_TEXT,
  verdict: JudgeVerdictFormat = JUDGE_VERDICT_FORMAT,
  /** OPENROUTER_DIALECT's pin (the header's `openrouter`): the bytes openRouterRequestJson makes of the `messages` body on it. */
  pin?: Pick<JudgePin, 'providers'>,
): string | null {
  if (dialect === OPENROUTER_DIALECT) {
    if (pin === undefined) throw new TypeError('an OpenRouter request rebuilds on its pin');
    return openRouterRequestJson(judgeRequestBody(agent, system, user, form, house, verdict, 'messages'), pin);
  }
  if (dialect === 'chat') return JSON.stringify(judgeRequestBody(agent, system, user, form, house, verdict));
  if (dialect === ROUTER_DIALECT || dialect === ROUTER_MESSAGES_DIALECT) return routerRequestJsonIn(dialect, judgeRequestBody(agent, system, user, form, house, verdict));
  return masqMessagesBody(judgeRequestBody(agent, system, user, form, house, verdict, 'messages'));
}

// ------------------------------------------------------------------ an image's tokens
//
// The preflight prices an image by its pixels, never by its data URL's bytes (a 1 MiB 1024 × 1024 PNG is
// ~466,000 tokens at BYTES_PER_INPUT_TOKEN, and bills ~1,400): at the most that any vendor rule masq can
// bill the pinned model by charges an image of its size. The rules as published (read 2026-11-06):
//
//   anthropic  ⌈w/28⌉ × ⌈h/28⌉ visual tokens, after a downscale to fit the model's tier (high-resolution,
//              Claude 4.7 and later: 2,576 px and 4,784 tokens; standard: 1,568 px and 1,568), so at most
//              4,784. https://platform.claude.com/docs/en/build-with-claude/vision
//   openai     patches: ⌈w/32⌉ × ⌈h/32⌉ (auto keeps an image's size on the newest models; past 30,000
//              patches the request is refused) × the model's multiplier (1.2, or OPENAI_PATCH_MULTIPLIERS);
//              tiles: fit 2048 × 2048, the shortest side to 768, base + each 512-px tile (85 + 170, or
//              gpt-4o-mini's 2,833 + 5,667). The larger of the two.
//              https://developers.openai.com/api/docs/guides/images-vision
//   google     ≤ 384 px both ways 258; larger, 258 a 768 × 768 tile; Gemini 3 and 4 allot an image 1,120
//              at the default media resolution. The larger of the two.
//              https://ai.google.dev/gemini-api/docs/tokens, https://ai.google.dev/gemini-api/docs/media-resolution
//
// masq's own image estimate (masq src/token-mix.ts imageVisualTokens) reads the same constants for its
// token mix; it estimates, where these bound (it keeps OpenAI to a 6,144-patch budget, auto does not).
// A judge request is never sent across vendors (x-masq-policy: off), so a claude-*, gpt-* / o<n> or
// gemini-* model is bounded by its own vendor's rule, and any other id (superbot-fast, an alias) by all three.

/** An image's size in pixels. */
export interface JudgeImageSize {
  width: number;
  height: number;
}

type ImageFamily = 'anthropic' | 'openai' | 'google';

/** OpenAI's patch multipliers other than its 1.2, by model id prefix. */
const OPENAI_PATCH_MULTIPLIERS: readonly (readonly [RegExp, number])[] = [
  [/^gpt-4\.1-nano/, 2.46],
  [/^o4-mini/, 1.72],
  [/^gpt-4\.1-mini/, 1.62],
  [/^gpt-5-nano/, 1.5],
];

const sizeOf = (width: number, height: number): JudgeImageSize | null => (width >= 1 && height >= 1 ? { width, height } : null);

/** A JPEG's frame size: its first SOFn segment's, walking the segments from SOI (null at SOS or EOI first, or a broken segment). */
function jpegSize(b: Buffer): JudgeImageSize | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    if (m === 0xff) {
      i += 1; // a fill byte
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
      i += 2; // TEM, RSTn, SOI: no length
      continue;
    }
    if (m === 0xd9 || m === 0xda) return null;
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    // SOF0–SOF15, but DHT (C4), JPG (C8) and DAC (CC): length, precision, then height and width.
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return i + 9 <= b.length ? sizeOf(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)) : null;
    i += 2 + len;
  }
  return null;
}

/** A WebP's canvas size: its VP8 frame header's, VP8L's, or VP8X's. */
function webpSize(b: Buffer): JudgeImageSize | null {
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return sizeOf(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21);
    return sizeOf((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X' && b.length >= 30) return sizeOf(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
  return null;
}

/** An image's pixel size as its header gives it (PNG IHDR, JPEG SOFn, GIF's logical screen, WebP VP8/VP8L/VP8X), or null when it does not read. */
export function judgeImageSize(bytes: Uint8Array): JudgeImageSize | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (judgeImageType(b)) {
    case 'image/png':
      return b.length >= 24 && b.readUInt32BE(8) === 13 && b.toString('latin1', 12, 16) === 'IHDR' ? sizeOf(b.readUInt32BE(16), b.readUInt32BE(20)) : null;
    case 'image/jpeg':
      return jpegSize(b);
    case 'image/gif':
      return b.length >= 10 ? sizeOf(b.readUInt16LE(6), b.readUInt16LE(8)) : null;
    case 'image/webp':
      return webpSize(b);
    default:
      return null;
  }
}

/** The most one w × h image bills on `model` under `family`'s rule (the section header). */
function familyImageTokens(family: ImageFamily, model: string, w: number, h: number): number {
  switch (family) {
    case 'anthropic':
      return Math.min(Math.ceil(w / 28) * Math.ceil(h / 28), 4784);
    case 'openai': {
      const multiplier = OPENAI_PATCH_MULTIPLIERS.find(([re]) => re.test(model))?.[1] ?? 1.2;
      const patches = Math.ceil(Math.min(Math.ceil(w / 32) * Math.ceil(h / 32), 30_000) * multiplier);
      // Fit 2048 × 2048, then the shortest side to 768; pixels rounded up, so no rounding of OpenAI's counts more tiles.
      let s = Math.min(1, 2048 / Math.max(w, h));
      s *= Math.min(1, 768 / Math.min(w * s, h * s));
      const tiles = Math.ceil(Math.ceil(w * s) / 512) * Math.ceil(Math.ceil(h * s) / 512);
      const [base, tile] = model.startsWith('gpt-4o-mini') ? [2833, 5667] : [85, 170];
      return Math.max(patches, base + tile * tiles);
    }
    case 'google':
      return Math.max(258 * (w <= 384 && h <= 384 ? 1 : Math.ceil(w / 768) * Math.ceil(h / 768)), 1120);
  }
}

/**
 * The most input tokens one image of `size` bills on `model`: the largest of the vendor rules masq can
 * bill it by (the section header), its own vendor's for a claude-*, gpt-* / o<n> or gemini-* id, all three
 * for any other.
 */
export function judgeImageTokens(model: string, size: JudgeImageSize): number {
  const id = model.toLowerCase();
  const families: readonly ImageFamily[] = id.startsWith('claude') ? ['anthropic'] : /^(gpt|chatgpt|o\d)/.test(id) ? ['openai'] : id.startsWith('gemini') ? ['google'] : ['anthropic', 'openai', 'google'];
  return Math.max(...families.map((f) => familyImageTokens(f, id, size.width, size.height)));
}

// ------------------------------------------------------------------ the holds

/** Why a heat does not start: its model is unpriced, or masq's card says it cannot see images. */
export interface JudgeHold {
  kind: 'unpriced' | 'vision';
  /** What holds it, in an admin's words. */
  why: string;
}

/** The preflight's figures (µUSD). */
export interface JudgeBudget {
  /** The heat's planned calls (judgeHeatCalls). */
  calls: number;
  /** calls × JUDGE_CALL_ATTEMPTS: the most requests the heat sends. */
  requests: number;
  /** The largest request body any call can send, bytes (the two largest artifacts, the larger form). */
  bodyBytes: number;
  /**
   * The most input tokens any call's request can carry (the two dearest artifacts, the larger form): its
   * text and JSON at BYTES_PER_INPUT_TOKEN bytes a token, each image at judgeImageTokens of its size (one
   * whose size does not read, judgeImageSize null, at its data URL's bytes).
   */
  inputTokens: number;
  /** worstCaseMicroUsd of inputTokens and max_output_tokens; null for an unpriced model. */
  requestMicroUsd: bigint | null;
  /** requests × requestMicroUsd; null for an unpriced model. */
  worstMicroUsd: bigint | null;
}

export interface JudgePreflightInput {
  agent: JudgeAgent;
  /** judgeSystemPrompt's text. */
  system: string;
  media: JudgeMedia;
  /** The house text the user messages are framed in (default JUDGE_HOUSE_TEXT): the heat setup's house_text. */
  house?: JudgeHouseText;
  /** Every artifact a call of the heat may carry. */
  artifacts: readonly JudgeArtifact[];
  /** The heat's planned calls (judgeHeatCalls). */
  calls: number;
  /** The pricing instant, ISO 8601. */
  at: string;
  /** `allow`: an unpriced model is no hold, its dollar figures null (an OpenRouter heat: the header's `openrouter`). Default `hold`. */
  unpriced?: 'hold' | 'allow';
  /** An OpenRouter heat's pin: its bodies (openRouterRequestJson) are weighed beside the others. */
  pin?: Pick<JudgePin, 'providers'>;
}

// ------------------------------------------------------------------ the preflight's sizes
//
// The preflight weighs every body a call can send (each form, each wire) for the heat's largest and dearest pair, and
// ranks every artifact by its user content's size: built whole, each a JSON of megabytes of base64 images, that held a
// grader's event loop 275-557 ms a heat (2026-11-13). It never builds them whole. An image part's URL is
// `data:<type>;base64,<payload>`, and every body says that payload verbatim some fixed number of times (a JSON string
// escapes none of base64's characters; Messages' image block takes the payload as it is), so a body's bytes are linear
// in the payload's length: the same content built twice with a short stand-in payload of each part (STAND_IN_FILLS
// `A`s, valid base64 every wire takes as the real one) gives the line, and the real payloads' lengths (an image's
// 4 * ceil(bytes / 3), a dossier image's canonical base64's) give each body's bytes, exactly. A pair of stand-ins that
// does not give a whole number of copies per part is no line: that body is built whole.

/** The two stand-in payload lengths, in base64 characters (each a whole number of quanta). */
const STAND_IN_FILLS = [4, 8] as const;

/** An image part's URL as the preflight sizes it: its prefix (`data:<type>;base64,`) and its payload's length. */
interface SizedPart {
  prefix: string;
  payload: number;
}

/** An image part's SizedPart, or null for a part whose URL is used as it is (a priced part's empty one). */
type SizedPartOf = (art: JudgeArtifact, part: number) => SizedPart | null;

/** An image artifact's SizedPart: its data URL's prefix and its base64's length, the image never encoded. JudgeArtifactRefused as dataUrlOf. */
function imageSizedPart(a: JudgeArtifact): SizedPart {
  const type = judgeImageType(a.bytes);
  if (type === null) throw new JudgeArtifactRefused(a.sha256, `artifact ${a.sha256} is not a PNG, JPEG, GIF or WebP image, so an image heat cannot send it`);
  return { prefix: `data:${type};base64,`, payload: 4 * Math.ceil(a.bytes.byteLength / 3) };
}

/** A dossier artifact's image `part`'s SizedPart: its canonical base64 (parseDossier checks it) is the payload. */
function dossierSizedPart(a: JudgeArtifact, part: number): SizedPart {
  const image = dossierOf(a).images[part];
  if (image === undefined) throw new RangeError(`dossier ${a.sha256} has no image ${part}`);
  return { prefix: `data:${image.media_type};base64,`, payload: image.base64.length };
}

/**
 * The byte lengths `lengths` gives the content `build` makes with each image part's real URL (`urlOf`), where
 * `sized` names a part's SizedPart (the section header): from two stand-in builds, else from the real one.
 */
function sizedLengths(build: (urlOf: PartUrlOf) => string | JudgeContentPart[], urlOf: PartUrlOf, sized: SizedPartOf | null, lengths: (user: string | JudgeContentPart[]) => number[]): number[] {
  if (sized === null) return lengths(build(urlOf));
  const probe = (fill: number) => {
    const stub = 'A'.repeat(fill);
    let parts = 0;
    let payload = 0;
    const user = build((art, part) => {
      const p = sized(art, part);
      if (p === null) return urlOf(art, part);
      parts++;
      payload += p.payload;
      return p.prefix + stub;
    });
    return { parts, payload, lengths: lengths(user) };
  };
  const [lo, hi] = STAND_IN_FILLS;
  const a = probe(lo);
  if (a.parts === 0) return a.lengths;
  const b = probe(hi);
  const step = (hi - lo) * a.parts;
  const out: number[] = [];
  for (let i = 0; i < a.lengths.length; i++) {
    const rise = b.lengths[i]! - a.lengths[i]!;
    // each part said `copies` times in this body; a rise that is no whole number of copies is no line: build it whole
    if (b.parts !== a.parts || b.payload !== a.payload || rise < 0 || rise % step !== 0) return lengths(build(urlOf));
    const copies = rise / step;
    out.push(a.lengths[i]! + copies * (a.payload - lo * a.parts));
  }
  return out;
}

/** How much of a dossier image's base64 the preflight decodes first to read its size: 64 KiB of bytes (a multiple of 4 characters). */
const SIZE_PREFIX_CHARS = 4 * Math.ceil((64 * 1024) / 3);

/**
 * A dossier image's pixel size (judgeImageSize of its bytes), decoding only the start of its canonical base64 when the
 * size reads there (a header reads the same bytes in the same order on a prefix, and answers no size where it would
 * read past it), else all of it.
 */
function dossierImageSize(base64: string): JudgeImageSize | null {
  if (base64.length > SIZE_PREFIX_CHARS) {
    const size = judgeImageSize(Buffer.from(base64.slice(0, SIZE_PREFIX_CHARS), 'base64'));
    if (size !== null) return size;
  }
  return judgeImageSize(Buffer.from(base64, 'base64'));
}

/**
 * The heat's worst case (the header): its figures, and the hold when the model is unpriced (null otherwise, and with
 * `unpriced: 'allow'`). Throws JudgeArtifactRefused on an artifact no call can carry.
 */
export function judgePreflight(input: JudgePreflightInput): { budget: JudgeBudget; hold: JudgeHold | null } {
  if (!Number.isSafeInteger(input.calls) || input.calls < 0) throw new RangeError(`a heat's planned calls are a whole number from 0, got ${input.calls}`);
  const requests = input.calls * JUDGE_CALL_ATTEMPTS;
  // An image part whose size reads (an image artifact, or each image of a dossier) is priced by its pixels: its URL is
  // emptied from the body, and its tokens enter the gateway's pricing as BYTES_PER_INPUT_TOKEN bytes each. Everything
  // else (a text, a dossier's text, the framing) prices by its bytes. Each artifact's parts' tokens, null where unread.
  const media = judgeMediaOf(input.media);
  const partTokens = new Map<JudgeArtifact, readonly (number | null)[]>();
  const tokensOf = (size: JudgeImageSize | null): number | null => (size === null ? null : judgeImageTokens(input.agent.model, size));
  if (media === 'image') {
    for (const a of input.artifacts) partTokens.set(a, [tokensOf(judgeImageSize(a.bytes))]);
  } else if (media === 'dossier') {
    for (const a of input.artifacts) partTokens.set(a, dossierOf(a).images.map((image) => tokensOf(dossierImageSize(image.base64))));
  }
  const urlOf = partUrlOf(media);
  const priced = (art: JudgeArtifact, part: number): boolean => (partTokens.get(art)?.[part] ?? null) !== null;
  const pricedUrl = (art: JudgeArtifact, part: number): string => (priced(art, part) ? '' : urlOf(art, part));
  // Each part's URL sized, never encoded (the section above): every part for the bodies as sent, the unpriced ones for the priced bodies.
  const sizedPart: SizedPartOf | null = media === 'image' ? (art) => imageSizedPart(art) : media === 'dossier' ? dossierSizedPart : null;
  const sizedUnpriced: SizedPartOf | null = sizedPart === null ? null : (art, part) => (priced(art, part) ? null : sizedPart(art, part));
  const contentBytes = (user: string | JudgeContentPart[]): number[] => [Buffer.byteLength(JSON.stringify(user))];
  const pixelBytes = (...arts: JudgeArtifact[]): number => arts.reduce((n, art) => n + (partTokens.get(art) ?? []).reduce<number>((m, t) => m + (t ?? 0), 0) * BYTES_PER_INPUT_TOKEN, 0);
  // A body is its framing plus each artifact's part, so the largest (and the dearest) is the two largest
  // (dearest) parts' in either order and either form.
  const two = (n: (a: JudgeArtifact) => number): [JudgeArtifact, JudgeArtifact] | null => {
    const ranked = input.artifacts.map((a) => ({ a, n: n(a) })).sort((x, y) => y.n - x.n);
    const first = ranked[0]?.a;
    return first === undefined ? null : [first, ranked[1]?.a ?? first];
  };
  const house = input.house ?? JUDGE_HOUSE_TEXT;
  // Either dialect's body, whichever is larger (a superbot request has the one), and superbot-router's streamed one for a
  // model the router serves (the header's `router`: which broker mints the key is not known before the mint).
  const routed = routerServesModel(input.agent.model);
  const bodyLengths = (user: string | JudgeContentPart[]): number[] =>
    JUDGE_FORMS.flatMap((form) => [
      Buffer.byteLength(JSON.stringify(judgeRequestBody(input.agent, input.system, user, form, house))),
      Buffer.byteLength(judgeWire(input.agent, input.system, user, form, house).body),
      ...(routed ? [Buffer.byteLength(routerRequestJson(judgeRequestBody(input.agent, input.system, user, form, house))), Buffer.byteLength(routerWire(judgeRequestBody(input.agent, input.system, user, form, house)).body)] : []),
      ...(input.pin !== undefined ? [Buffer.byteLength(openRouterRequestJson(judgeRequestBody(input.agent, input.system, user, form, house, JUDGE_VERDICT_FORMAT, 'messages'), input.pin))] : []),
    ]);
  const bodyOf = (build: (urlOf: PartUrlOf) => string | JudgeContentPart[], urls: PartUrlOf, sized: SizedPartOf | null): number => Math.max(...sizedLengths(build, urls, sized, bodyLengths));
  // JSON.stringify(judgeUserContent(media, a, a, house)) and the priced content's bytes, sized the same way
  const largest = two((a) => sizedLengths((u) => userContentOf(input.media, a, a, u, house), urlOf, sizedPart, contentBytes)[0]!);
  const dearest = two((a) => sizedLengths((u) => userContentOf(input.media, a, a, u, house), pricedUrl, sizedUnpriced, contentBytes)[0]! + pixelBytes(a, a));
  const bodyBytes = largest === null ? 0 : bodyOf((u) => userContentOf(input.media, ...largest, u, house), urlOf, sizedPart);
  const inputBytes = dearest === null ? 0 : bodyOf((u) => userContentOf(input.media, ...dearest, u, house), pricedUrl, sizedUnpriced) + pixelBytes(...dearest);
  const inputTokens = Math.ceil(inputBytes / BYTES_PER_INPUT_TOKEN);
  const budget: JudgeBudget = { calls: input.calls, requests, bodyBytes, inputTokens, requestMicroUsd: null, worstMicroUsd: null };
  let one: bigint;
  try {
    one = worstCaseMicroUsd({ model: input.agent.model, at: input.at, body_bytes: inputBytes, output_tokens: input.agent.max_output_tokens }).micro_usd;
  } catch (err) {
    if (input.unpriced === 'allow') return { budget, hold: null };
    return {
      budget,
      hold: { kind: 'unpriced', why: `the judge model ${input.agent.model} cannot be priced (${err instanceof Error ? err.message : String(err)}), so no worst case bounds the heat` },
    };
  }
  budget.requestMicroUsd = one;
  budget.worstMicroUsd = one * BigInt(requests);
  return { budget, hold: null };
}

// The model list masq answers (openai dialect): each card's id and capabilities, read leniently.
const ModelList = z.object({
  data: z.array(z.object({ id: z.string(), capabilities: z.object({ supports_vision: z.unknown().optional() }).loose().nullable().optional() }).loose()),
});

/** Where a heat's key and calls are: masq, superbot-router dialled directly (the header's `router`), or OpenRouter (`openrouter`). */
export type JudgeUpstream = 'masq' | 'superbot-router' | 'openrouter';

export interface JudgeVisionOptions {
  /** masq's origin (MAKEFUN_LLM_GATEWAY_URL), or superbot-router's for a key it holds (`upstream`). */
  origin: string;
  /** Who answers at `origin`, as a fault names it (default masq). */
  upstream?: JudgeUpstream;
  /** The heat's judge key. */
  apiKey: string;
  /** The pinned model. */
  model: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** The model list read's bound, ms (default MASQ_TIMEOUT_MS). */
  timeoutMs?: number;
}

/** The pinned model's card in masq's model list: its exact id, else a release-dated alias of it (isServedModel); null when masq lists none. */
export function judgeModelCard(cards: readonly MasqModelCard[], model: string): MasqModelCard | null {
  return cards.find((m) => m.id === model) ?? cards.find((m) => isServedModel(model, m.id)) ?? null;
}

/** A card's capability `name` as masq's card spells it; undefined when the card carries none. */
function capabilityOf(card: MasqModelCard, name: string): unknown {
  return isRecord(card.capabilities) ? card.capabilities[name] : undefined;
}

/**
 * The card an image heat's vision is read from (the header): the pinned model's (judgeModelCard), else the card of the
 * first id masq routes it to that masq lists (server/house-model.ts masqAllowedModels, the model itself first); null
 * when masq lists none of them.
 */
export function judgeVisionCard(cards: readonly MasqModelCard[], model: string): MasqModelCard | null {
  for (const id of masqAllowedModels(model)) {
    const card = judgeModelCard(cards, id);
    if (card !== null) return card;
  }
  return null;
}

/**
 * The vision hold of an image (or dossier) heat on its model's card (the header; judgeVisionCard): null when the card says
 * supports_vision true, or when there is no card and the model is of the superbot family (SUPERBOT_FAMILY_VISION). Its
 * sentence names `upstream`, the list the card was read from (default masq), and the heat's `media` (default image).
 */
export function judgeVisionHoldOf(card: MasqModelCard | null, model: string, upstream: JudgeUpstream = 'masq', media: Exclude<JudgeMedia, 'text'> = 'image'): JudgeHold | null {
  if (card === null && isSuperbotFamily(model) && SUPERBOT_FAMILY_VISION) return null;
  if (card === null) return { kind: 'vision', why: `${upstream} lists no model card for ${model}, so whether it reads images cannot be told` };
  const vision = capabilityOf(card, 'supports_vision');
  if (vision === true) return null;
  return { kind: 'vision', why: `${upstream}'s model card for ${card.id} says supports_vision ${JSON.stringify(vision ?? null)}, not true, so ${judgeHeatNoun(media)} cannot be judged on it` };
}

/**
 * The forms a call on the model `card` describes is asked in (the header): the unforced pair when the card
 * says capabilities.reasoning.can_disable false (the model always thinks, so takes no forced tool), else the
 * forced pair, as with no card at all. The same card always gives the same forms.
 */
export function judgeFormsOf(card: MasqModelCard | null): JudgeForms {
  const reasoning = card === null ? undefined : capabilityOf(card, 'reasoning');
  return isRecord(reasoning) && reasoning.can_disable === false ? JUDGE_UNFORCED_FORMS : JUDGE_FORCED_FORMS;
}

/**
 * The vision hold of an image heat (the header): null when masq's live card for the pinned model (or for an id masq
 * routes it to) says supports_vision true, or masq lists none and the model is of the superbot family; a JudgeHold when
 * the card says anything else or masq lists no card for another model. masq unreachable, a list whose body could not
 * be read, or a list that is not one, throws JudgeCallFault.
 */
export async function judgeVisionHold(opts: JudgeVisionOptions): Promise<JudgeHold | null> {
  return judgeVisionHoldOf(judgeVisionCard(await judgeModelCards(opts), opts.model), opts.model);
}

/**
 * masq's model list read on the heat's key (GET /v1/models; superbot-router's, `upstream`, for a key it holds): for a heat
 * whose broker handed none on with the key. masq unreachable, a list whose body could not be read, or a list that is not
 * one, throws JudgeCallFault.
 */
export async function judgeModelCards(opts: Omit<JudgeVisionOptions, 'model'>): Promise<MasqModelCard[]> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? MASQ_TIMEOUT_MS);
  const signal = opts.signal === undefined ? timeout : AbortSignal.any([opts.signal, timeout]);
  const quote = (text: string): string => (opts.apiKey === '' ? text : text.split(opts.apiKey).join('[the judge key]')).slice(0, 300);
  const who = opts.upstream ?? 'masq';
  let res: Response;
  try {
    res = await doFetch(new URL(MASQ_MODELS_PATH, opts.origin).href, { method: 'GET', headers: { authorization: `Bearer ${opts.apiKey}`, accept: 'application/json' }, signal });
  } catch (err) {
    throw new JudgeCallFault(`${who} could not be reached for its model list: ${quote(err instanceof Error ? err.message : String(err))}`, null, [], { cause: err });
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw new JudgeCallFault(`${who}'s model list (${res.status}) could not be read: ${quote(err instanceof Error ? err.message : String(err))}`, null, [], { cause: err });
  }
  if (!res.ok) throw new JudgeCallFault(`${who} answered ${res.status} for its model list: ${quote(text)}`, res.status, []);
  let list: z.infer<typeof ModelList>;
  try {
    list = ModelList.parse(JSON.parse(text));
  } catch {
    throw new JudgeCallFault(`${who}'s model list is not {data: [{id, capabilities}]}: ${quote(text)}`, res.status, []);
  }
  return list.data;
}

/**
 * The page of a held heat, in an admin's words: what did not start and
 * why, what happens meanwhile (`until`: when the caller weighs it again; null: never), and the ways out.
 */
export function judgeHoldPage(input: { slug: string; phase: JudgeKeyPhase; attempt: number; hold: JudgeHold; until: Date | null }): string {
  const meanwhile =
    input.until === null
      ? 'The competition is resolved, so nothing is sent again: the heat stays unjudged.'
      : `The heat is weighed again at ${input.until.toISOString()}, so it starts on its own once nothing holds it.`;
  const fix = {
    unpriced: 'add the model to pricing/ or pin a priced model in judge.agent.model',
    vision: "pin a model that reads images in judge.agent.model, or wait for masq's card to say supports_vision true (a stale router card reads null)",
  }[input.hold.kind];
  return (
    `[grade] ALERT: ${input.slug}: the ${input.phase === 'local' ? 'local' : `${input.phase}-phase`} judge heat (try ${input.attempt}) waits: it did not start, since ${input.hold.why}. ` +
    `Nothing was sent to the judge model and nothing was spent. ${meanwhile} Fix: ${fix}`
  );
}

// ------------------------------------------------------------------ the answer

/** One request of a call, as the record keeps it. */
export interface JudgeAttempt {
  form: JudgeForm;
  /** sha256 of the exact body bytes sent (judgeRequestBody, deterministic). */
  request_sha256: string;
  request_bytes: number;
  /** When it was sent, ISO 8601: its pricing instant. */
  at: string;
  /** The HTTP status masq answered. */
  status: number;
  /** sha256 of the response body: the blob it was stored as, before it was read. */
  response_body_sha256: string;
  /** The model that answered (the completion's `model`, else x-masq-model); null when neither names one. */
  model_answered: string | null;
  finish_reason: string | null;
  /** Its usage in the cassette's token classes; null when the answer carried none. */
  usage: CassetteUsageT | null;
  /** Its price (priceUsage at `at`), µUSD; '0' for a refused status with no usage; null when a 2xx answer carried no usage it could be priced by. */
  micro_usd: string | null;
  /** Why it gave no verdict; null for the attempt that did. */
  invalid: string | null;
  /**
   * On OpenRouter (the header's `openrouter`): the provider the answer names (openRouterServedOf), its display name
   * (`Z.AI`), never an endpoint's tag; absent when it names none, and on masq and superbot-router.
   */
  provider?: string;
}

/** One call: the verdict on Entry A (`a_sha256`) against Entry B (`b_sha256`), and every request it took. */
export interface JudgeCallResult {
  a_sha256: string;
  b_sha256: string;
  /** The slot that won; null when no attempt gave a verdict. */
  verdict: 'A' | 'B' | null;
  /** How far the winner is ahead, JUDGE_MARGIN_MIN (1, by a hair) to JUDGE_MARGIN_MAX (5); null exactly when verdict is. */
  margin: number | null;
  /** The sha256 of the winning artifact (the slot mapped back); null with verdict. */
  winner_sha256: string | null;
  reason: string | null;
  /** Why the last attempt gave no verdict; null when one did. */
  invalid: string | null;
  /** The last attempt's request, response blob and answering model. */
  request_sha256: string;
  response_body_sha256: string;
  model_answered: string | null;
  /** Every attempt's usage summed; null when none carried any. */
  usage: CassetteUsageT | null;
  /** Every attempt's price summed, µUSD (an unpriced attempt adds nothing: see JudgeAttempt.micro_usd). */
  micro_usd: string;
  /**
   * What its answers split their own cost by kind, µUSD (OpenRouter's usage.cost_details: the prompt inference and the
   * completion inference), summed over the attempts that named it; absent when none did, as on router and masq. It sits
   * on the call, never the attempt: a heat's record keeps attempts in grader/judge-heat.ts JudgeHeatAttempt's shape.
   */
  micro_usd_by_kind?: Record<JudgeTokenKind, bigint> | null;
  attempts: JudgeAttempt[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const tokenCount = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);

/**
 * A chat completion's usage in the cassette's classes: prompt_tokens is masq's input + cache reads +
 * cache writes (its openai-chat adapter), cached_tokens the reads; reasoning is inside completion_tokens.
 * The writes are what the usage names in Anthropic's words beside them (cache_creation_input_tokens, split
 * by cache_creation's ephemeral_5m_input_tokens and ephemeral_1h_input_tokens; a part the split does not
 * name is a 1-hour write, the dearer, as masq's own breakpoints are), and input is the rest. masq's
 * openai-chat answer names no writes, so a write there would read as input: a judge call is a one-shot
 * (JUDGE_SIDE_SPAWN), on which masq writes none. A Messages answer (the header's `dialect`, whose system
 * prompt carries its own breakpoint) names them, carried beside by masqAnswerText. Null when it names no
 * prompt and completion count.
 */
export function judgeUsageOf(usage: unknown): CassetteUsageT | null {
  if (!isRecord(usage)) return null;
  const prompt = tokenCount(usage.prompt_tokens);
  const completion = tokenCount(usage.completion_tokens);
  if (prompt === null || completion === null) return null;
  const pd = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const cd = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
  const cc = isRecord(usage.cache_creation) ? usage.cache_creation : {};
  const cached = Math.min(tokenCount(pd.cached_tokens) ?? 0, prompt);
  const split5m = tokenCount(cc.ephemeral_5m_input_tokens) ?? 0;
  const split1h = tokenCount(cc.ephemeral_1h_input_tokens) ?? 0;
  // Never more writes than the prompt holds past its reads: the 5-minute part first, the dearer rest as 1-hour writes.
  const written = Math.min(Math.max(tokenCount(usage.cache_creation_input_tokens) ?? 0, split5m + split1h), prompt - cached);
  const write5m = Math.min(split5m, written);
  const reasoning = Math.min(tokenCount(cd.reasoning_tokens) ?? tokenCount(usage.reasoning_tokens) ?? 0, completion);
  return { input: prompt - cached - written, output: completion, cache_read: cached, cache_write_5m: write5m, cache_write_1h: written - write5m, reasoning };
}

/** The price of `usage` at `at`: on the model that answered when it has a pricing row, else on the model asked for. */
function priceOf(asked: string, answered: string | null, at: string, usage: CassetteUsageT): bigint | null {
  for (const model of answered !== null && answered !== asked ? [answered, asked] : [asked]) {
    const priced = priceUsage({ model, at, format: 'tokens', usage });
    if (priced.microUsd !== null) return priced.microUsd;
  }
  return null;
}

// The completion masq answers with, or the one superbot-router's stream assembles to, read leniently: only what a
// verdict needs.
const ChatCompletion = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.union([z.string(), z.null()]).optional(),
            refusal: z.union([z.string(), z.null()]).optional(),
            tool_calls: z.array(z.object({ function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional() })).nullable().optional(),
          })
          .optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
  usage: z.unknown().optional(),
  error: z.unknown().optional(),
});

export interface JudgeSendOptions {
  /** masq's origin (MAKEFUN_LLM_GATEWAY_URL), or superbot-router's (`router`). */
  origin: string;
  /** The heat's judge key. */
  apiKey: string;
  /**
   * The key is superbot-router's (the header's `router`: routerOfKey(minted)): each request goes on the router's wire, streamed,
   * the answer it assembles to stored and read, the rate-limit re-send only where routerResendable says. Unset: masq's.
   */
  router?: boolean;
  /** On superbot-router: ROUTER_DIALECT keeps every request on Chat Completions (routerWire's pin); unset, Messages where the body maps. */
  routerWire?: RouterDialect;
  /**
   * The key is OpenRouter's (the header's `openrouter`: openRouterOfKey(minted), `origin` its bare origin): every request
   * goes on OpenRouter's wire pinned to `pin`, `label` (the heat key's label) its x-session-id. Never with `router`.
   */
  openrouter?: { pin: JudgePin; label: string };
  agent: JudgeAgent;
  system: string;
  media: JudgeMedia;
  /** The house text the user message is framed in (default JUDGE_HOUSE_TEXT): the heat setup's house_text. */
  house?: JudgeHouseText;
  blobs: JudgeBlobs;
  fetch?: typeof fetch;
  /** Each request's bound, ms (default JUDGE_CALL_TIMEOUT_MS); on superbot-router its head's alone (the header's `router`). */
  timeoutMs?: number;
  now?: () => number;
  signal?: AbortSignal;
  /** The forms the call is asked in (judgeFormsOf), default JUDGE_FORCED_FORMS. */
  forms?: JudgeForms;
  /** When the key was minted (ms, `now`'s clock): a 401 within MASQ_KEY_WARMUP_MS of it is re-sent (the header). Unset: a 401 is a fault at once. */
  keyMintedAt?: number;
  /** The wait before a fresh key's 401 or a rate-limited request is re-sent (default a timer); it rejects when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  /** The jitter on a rate limit's wait when masq names none, in [0, 1) (default Math.random). */
  random?: () => number;
  /** Called with each attempt as it completes (a heat's meter). */
  onAttempt?: (attempt: JudgeAttempt) => void;
  /** Called when masq refuses a forced form for the model (the header): the heat asks its later calls unforced. */
  onForcedToolRefused?: () => void;
  /**
   * Called with the status each time a rate-limited request (a 429, or a 503 naming its Retry-After: the header's
   * `rate limit`; on superbot-router each wait it names, the header's `router`) is to be re-sent, before its wait; never
   * for a fresh key's 401, nor for the answer that spends masq's re-sends. The heat counts them (JudgeHeat.pushbacks): the pool's pushback its sender narrows on. What it throws is
   * swallowed: the re-send goes on as before.
   */
  onRateLimited?: (status: number) => void;
  /**
   * On superbot-router: called with what each answer read said of how it was served (routerServedOf: its status, the
   * served tier, x-sbr-lane, x-sbr-ignored), a refused or dropped one's included. A heat tallies them into its one log
   * line (the header's `served`). What it throws is swallowed.
   */
  onRouterServed?: (served: RouterServed) => void;
  /** Where a scope refusal's `[model-key] ALERT: ` page goes (default console.error: the alert forwarder reads stderr). */
  page?: (line: string) => void;
}

/**
 * The scope page's words for a judge key masq refuses its model (the header's `scope`, server/house-model.ts
 * watchMasqScope): what fails, the key, and the episode every heat's minted key shares, so one refused mint
 * configuration pages once, not once a heat.
 */
const JUDGE_SCOPE_FAILS = 'the house judge (every judge call of a heat on that model faults with HTTP 403, so no judged heat finishes)';
const JUDGE_SCOPE_KEYS = "the judge key minted per heat, makefun/<slug>/judge/<phase>/<attempt>: its allowedModels are grader/gateway/masq.ts judgeKeyRequest's";
const JUDGE_SCOPE_EPISODE = 'minted judge keys';
/** The scope page's key and episode for a heat on superbot-router's one static key (the header's `router`). */
const JUDGE_ROUTER_SCOPE_KEYS = 'MAKEFUN_SUPERBOT_ROUTER_KEY';
const JUDGE_ROUTER_SCOPE_EPISODE = 'superbot-router judge key';

const sleepFor = (ms: number, signal: AbortSignal | undefined): Promise<void> => delay(ms, undefined, signal === undefined ? {} : { signal });

/**
 * The wait a refused OpenRouter answer names in its body, ms, read at `nowMs` (the header's `openrouter`): on a status
 * that waits (a 429, a 503, or a 402 whose error.metadata.limit_source is OPENROUTER_IN_FLIGHT_BUDGET), its
 * error.metadata.retry_after_seconds, else its error.metadata.headers' Retry-After (routerRetryAfterMs); null otherwise.
 * An overloaded provider's 429 may name it there and send no Retry-After header. Read only when openRouterNamedWaitMs
 * reads none; it belongs beside that header read in server/openrouter-judge.ts.
 */
export function openRouterBodyWaitMs(status: number, text: string, nowMs: number): number | null {
  let meta: Record<string, unknown> | null;
  try {
    const doc: unknown = JSON.parse(text);
    const err = isRecord(doc) && isRecord(doc.error) ? doc.error : null;
    meta = err !== null && isRecord(err.metadata) ? err.metadata : null;
  } catch {
    return null;
  }
  if (meta === null) return null;
  if (!(status === 429 || status === 503 || (status === 402 && meta.limit_source === OPENROUTER_IN_FLIGHT_BUDGET))) return null;
  const seconds = meta.retry_after_seconds;
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const named = isRecord(meta.headers) ? Object.entries(meta.headers).find(([k]) => k.toLowerCase() === 'retry-after')?.[1] : undefined;
  return typeof named === 'string' || typeof named === 'number' ? routerRetryAfterMs(String(named), nowMs) : null;
}

/**
 * One judge call: Entry A `a` against Entry B `b`, the answer form first and, when it gives no verdict,
 * the retry form once (the header; a forced form masq refuses for its model is retried as tool_auto).
 * Throws JudgeCallFault on a platform fault and JudgeArtifactRefused on an artifact it cannot carry; every
 * other outcome is a result, verdict null when no attempt gave one.
 *
 * Each call that sends is counted once at its settle (server/ops/metrics.ts countJudgeCall): its door, model and
 * outcome in makefun_judge_requests_total, its first send to its verdict in makefun_judge_request_seconds, and, when it
 * settled on an answer, its attempts' tokens in makefun_judge_tokens_total, their prices in
 * makefun_judge_spend_micro_usd_total, and the cost their answers split by kind (OpenRouter's usage.cost_details) in
 * makefun_judge_spend_by_kind_micro_usd_total. The count never changes the call.
 */
export async function sendJudgeCall(opts: JudgeSendOptions, a: JudgeArtifact, b: JudgeArtifact): Promise<JudgeCallResult> {
  const clock: SendJudgeCallClock = { sentAtMs: null };
  const door: JudgeDoor = opts.openrouter !== undefined ? 'openrouter' : opts.router === true ? 'router' : 'masq';
  const now = opts.now ?? Date.now;
  try {
    const result = await sendJudgeCallOnce(opts, a, b, clock);
    countJudgeCall({
      door,
      model: opts.agent.model,
      provider: result.attempts.at(-1)?.provider ?? '',
      outcome: 'ok',
      seconds: clock.sentAtMs === null ? 0 : (now() - clock.sentAtMs) / 1000,
      micro_usd: judgeMeterMicroUsd(result.attempts),
      micro_usd_by_kind: result.micro_usd_by_kind ?? null,
      tokens: judgeTokensOf(result.attempts),
    });
    return result;
  } catch (err) {
    if (err instanceof JudgeCallFault && clock.sentAtMs !== null) {
      countJudgeCall({
        door,
        model: opts.agent.model,
        provider: '',
        outcome: 'fault',
        seconds: (now() - clock.sentAtMs) / 1000,
        micro_usd: 0n,
        tokens: { input: 0n, output: 0n },
      });
    }
    throw err;
  }
}

/**
 * The tokens a call's attempts took, by kind: input is everything the model was sent (its prompt, cache reads and cache
 * writes), output its completion tokens (reasoning inside them, as judgeUsageOf's). An attempt with no usage adds nothing.
 */
function judgeTokensOf(attempts: readonly JudgeAttempt[]): { input: bigint; output: bigint } {
  let input = 0n;
  let output = 0n;
  for (const attempt of attempts) {
    const usage = attempt.usage;
    if (usage === null) continue;
    input += BigInt(usage.input + usage.cache_read + usage.cache_write_5m + usage.cache_write_1h);
    output += BigInt(usage.output);
  }
  return { input, output };
}

/** When a judge call's first request went out (ms, the caller's clock); null until then. */
interface SendJudgeCallClock {
  sentAtMs: number | null;
}

async function sendJudgeCallOnce(opts: JudgeSendOptions, a: JudgeArtifact, b: JudgeArtifact, clock: SendJudgeCallClock): Promise<JudgeCallResult> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? Date.now;
  const quote = (text: string, max: number): string => (opts.apiKey === '' ? text : text.split(opts.apiKey).join('[the judge key]')).slice(0, max);
  // A transport failure in words: its message, and the code undici names (`fetch failed (UND_ERR_SOCKET)`) when its message does not.
  const failed = (err: unknown): string => {
    const text = quote(err instanceof Error ? err.message : String(err), 300);
    const code = routerFailureCode(err);
    return code === null || text.includes(code) ? text : `${text} (${code})`;
  };
  const user = judgeUserContent(opts.media, a, b, opts.house ?? JUDGE_HOUSE_TEXT);
  const sleep = opts.sleep ?? sleepFor;
  // superbot-router's key (the header's `router`): its wire, its name for the model, its name in every sentence.
  const router = opts.router === true;
  // OpenRouter's key (the header's `openrouter`): its wire on its pin, its one named wait, its name in every sentence.
  const openRouter = opts.openrouter ?? null;
  if (router && openRouter !== null) throw new TypeError('a judge call goes to one upstream: superbot-router or OpenRouter, not both');
  const who = router ? 'superbot-router' : openRouter !== null ? 'OpenRouter' : 'masq';
  let openRouterWaited = false;
  const wireModel = router ? routerWireModel(opts.agent.model) : opts.agent.model;
  const attempts: JudgeAttempt[] = [];
  // OpenRouter's own cost split (usage.cost_details), by kind, summed over the answers that name one: null when none does.
  const spendByKind: Record<JudgeTokenKind, bigint> = { input: 0n, output: 0n };
  let splitSeen = false;
  let taken: { winner: 'A' | 'B'; reason: string; margin: number } | null = null;
  let forms: JudgeForms = opts.forms ?? JUDGE_FORCED_FORMS;
  // A fresh key's 401s waited out across the call (by the clock, and by the waits summed should the clock stand still).
  let waited = 0;
  let gap = MASQ_KEY_WARMUP_GAP_MS;
  // masq's rate limits waited out across the call: the re-sends, the waits summed, and the next wait when masq names none
  // (superbot-router's are counted by nothing: the header's `router`).
  const random = opts.random ?? Math.random;
  let rateResends = 0;
  let rateWaited = 0;
  let rateGap = JUDGE_RATE_LIMIT_GAP_MS;
  for (let i = 0; i < JUDGE_CALL_ATTEMPTS; i++) {
    const form = forms[i === 0 ? 0 : 1];
    // Sent as this string, which fetch writes as its UTF-8 bytes: the bytes request_sha256 names. On superbot-router's key
    // its wire, streamed, on Messages where the body maps (the header's `router`); on masq's, judgeWire's dialect.
    const routerWireOf = router ? routerWire(judgeRequestBody(opts.agent, opts.system, user, form, opts.house ?? JUDGE_HOUSE_TEXT), opts.routerWire) : null;
    // On OpenRouter's key the `messages` body on its pin (the header's `openrouter`; judgeRequestJson OPENROUTER_DIALECT).
    const openRouterJson = openRouter !== null ? openRouterRequestJson(judgeRequestBody(opts.agent, opts.system, user, form, opts.house ?? JUDGE_HOUSE_TEXT, JUDGE_VERDICT_FORMAT, 'messages'), openRouter.pin) : null;
    const wire = routerWireOf !== null || openRouterJson !== null ? null : judgeWire(opts.agent, opts.system, user, form, opts.house ?? JUDGE_HOUSE_TEXT);
    const json = openRouterJson ?? (wire === null ? routerWireOf!.body : wire.body);
    const endpoint = openRouterJson !== null ? `${openRouterApiBase(opts.origin)}${OPENROUTER_CHAT_PATH}` : new URL(wire === null ? routerWireOf!.path : wire.path, opts.origin).href;
    const headers =
      openRouterJson !== null
        ? openRouterHeaders(opts.apiKey, openRouter!.label)
        : wire === null
        ? routerHeaders(opts.apiKey, routerWireOf!.dialect)
        : { ...masqAuthHeaders(wire.dialect, opts.apiKey), 'content-type': 'application/json', accept: 'application/json', ...MASQ_REVIEW_HEADERS, 'x-cosmos-side-spawn': JUDGE_SIDE_SPAWN };
    let at: string;
    let res: Response;
    let raw: Uint8Array;
    // On superbot-router: the document the answer's stream assembles to (the header's `router`); null on masq.
    let routed: RouterAnswer | null = null;
    // On OpenRouter: the document a 2xx answer assembles to (openRouterAnswerOf); null for a refused status, and elsewhere.
    let assembled: OpenRouterAnswer | null = null;
    for (;;) {
      const sentAt = now();
      at = new Date(sentAt).toISOString();
      clock.sentAtMs ??= sentAt;
      // On the router the call's bound holds its head alone, then the router's own (the header's `router`); on masq the whole call.
      const dial: RouterDial | null = router ? routerDial({ headMs: opts.timeoutMs ?? JUDGE_CALL_TIMEOUT_MS, ...(opts.signal === undefined ? {} : { signal: opts.signal }) }) : null;
      const timeout = dial === null ? AbortSignal.timeout(opts.timeoutMs ?? JUDGE_CALL_TIMEOUT_MS) : null;
      const signal = dial !== null ? dial.signal : opts.signal === undefined ? timeout! : AbortSignal.any([opts.signal, timeout!]);
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers,
          body: json,
          signal,
        });
      } catch (err) {
        dial?.done();
        // On the router and OpenRouter only a refused connect is no answer of theirs (the header's `final`).
        throw new JudgeCallFault(`${who} could not be reached: ${failed(err)}`, null, attempts, { cause: err, ...(router || openRouter !== null ? { final: !routerRefusedConnect(err) } : {}) });
      }
      try {
        // A stream is read whole, under the same bound (on the router, the router's).
        raw = dial === null ? new Uint8Array(await res.arrayBuffer()) : await dial.read(res);
      } catch (err) {
        // A body cut off (the connection dropped, the timeout) is a transport fault, never an empty answer: it would read as no verdict.
        throw new JudgeCallFault(`${who}'s answer (${res.status}) could not be read: ${failed(err)}`, null, attempts, { cause: err, ...(router || openRouter !== null ? { final: true } : {}) });
      } finally {
        dial?.done();
      }
      routed = router ? routerAnswerIn(routerWireOf!.dialect, raw) : null;
      if (routed !== null) {
        try {
          opts.onRouterServed?.(routerServedOf(res.status, res.headers, routed.text));
        } catch {
          // The hook only tallies: it never changes the call.
        }
      }
      assembled = openRouter !== null && res.ok ? openRouterAnswerOf(raw) : null;
      // Each re-send below is no attempt: masq refused the request before any model saw it, so it is neither stored,
      // recorded nor metered, and the call's attempts are a serial run's whatever was waited out.
      let wait: number;
      let why: string;
      if (res.status === 401 && opts.keyMintedAt !== undefined) {
        const age = Math.max(now() - opts.keyMintedAt, waited);
        if (age >= MASQ_KEY_WARMUP_MS) break;
        // masq does not know the key yet (the header).
        wait = Math.min(gap, MASQ_KEY_WARMUP_MS - age);
        waited += wait;
        gap *= 2;
        why = 'masq did not yet know the fresh key';
      } else if (openRouter !== null) {
        // OpenRouter's one named wait a call (the header's `openrouter`): its Retry-After, else its error body's, waited at
        // most JUDGE_RATE_LIMIT_WAIT_MS and the same bytes sent again; a second refusal, or one naming no wait, is final.
        if (res.ok || openRouterWaited) break;
        const body = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
        const named = openRouterNamedWaitMs(res.status, res.headers, body, now()) ?? openRouterBodyWaitMs(res.status, body, now());
        if (named === null) break;
        openRouterWaited = true;
        wait = Math.min(named, JUDGE_RATE_LIMIT_WAIT_MS);
        why = `${who} rate-limited it (${res.status})`;
        try {
          opts.onRateLimited?.(res.status);
        } catch {
          // The hook only counts: it never changes a re-send.
        }
      } else if (routed !== null) {
        // superbot-router's ladder (the header's `router`): every wait it names — a 429, 503 or 529 routerResendable allows
        // with its retry-after, or an in-band error before any content naming retry_after and not retryable false — waited
        // whole, however long, and the same bytes sent again, as often as it refuses so while the call's signal stands; no
        // count, no ceiling, never a wait it does not name. x-should-retry: false is permanent.
        const band = res.ok && routed.fault !== null ? routerInBandOf(routerWireOf!.dialect, routed.text) : null;
        const named = band !== null ? routerInBandWaitMs(band) : res.ok ? null : routerNamedWaitMs(res.status, res.headers, now());
        if (named === null) break;
        wait = named;
        why = band !== null ? `${who} shed it in band (${band.shed ?? 'an error frame'})` : `${who} rate-limited it (${res.status})`;
        try {
          opts.onRateLimited?.(res.status);
        } catch {
          // The hook only counts: it never changes a re-send.
        }
      } else {
        // Rate limited (the header's `rate limit`): a 429, or a 503 naming its Retry-After.
        const after = res.status === 429 || res.status === 503 ? judgeRetryAfterMs(res.headers.get('retry-after'), now()) : null;
        if (res.status !== 429 && after === null) break;
        if (rateResends >= JUDGE_RATE_LIMIT_RESENDS || rateWaited >= JUDGE_RATE_LIMIT_WAIT_MS) break;
        wait = Math.min(after ?? Math.round(rateGap * (0.75 + 0.5 * random())), JUDGE_RATE_LIMIT_WAIT_MS - rateWaited);
        rateWaited += wait;
        rateGap *= 2;
        rateResends++;
        why = `${who} rate-limited it (${res.status})`;
        try {
          opts.onRateLimited?.(res.status);
        } catch {
          // The hook only counts: it never changes a re-send.
        }
      }
      // Slept on the call's signal: an abort mid-wait ends the call with the signal's reason (never a final fault, never
      // slept on), and nothing more is sent.
      try {
        await sleep(wait, opts.signal);
      } catch (err) {
        if (opts.signal?.aborted) throw new JudgeCallFault(`the judge call was aborted while ${why}`, null, attempts, { cause: opts.signal.reason ?? err });
        throw err;
      }
      if (opts.signal?.aborted) throw new JudgeCallFault(`the judge call was aborted while ${why}`, null, attempts, { cause: opts.signal.reason });
    }
    // superbot-router's answer is the document its stream assembles to (the header's `router`): those bytes are what is
    // stored and read, a Messages one as a masq Messages answer is, a Chat Completions one as a chat answer.
    const readAs: MasqDialect = wire !== null ? wire.dialect : routerWireOf?.dialect === ROUTER_MESSAGES_DIALECT ? 'messages' : 'chat';
    if (assembled !== null && assembled.fault !== null) {
      // OpenRouter's 2xx that is no answer (an error document or chunk, finish_reason error, a cut): final, as the router's
      // is, with nothing stored, recorded or metered (the header's `openrouter`).
      const generation = res.headers.get('x-generation-id');
      throw new JudgeCallFault(`${who}'s answer (${res.status}) could not be read: ${quote(assembled.fault, 300)}${generation === null ? '' : ` (generation ${quote(generation, 100)})`}`, null, attempts, { final: true });
    }
    if (routed !== null && res.ok && routed.fault !== null) {
      // A 2xx stream that is no answer (an in-band error frame, a cut, a frame that is not JSON) is an answer that could not
      // be read, as a body cut off is: the platform's failure, never the entries', with nothing stored, recorded or metered.
      // It named no wait the router allows re-sent (none, retryable false, or after content): final (the header's `final`).
      const requestId = res.headers.get('request-id');
      throw new JudgeCallFault(`${who}'s answer (${res.status}) could not be read: ${quote(routed.fault, 300)}${requestId === null ? '' : ` (request-id ${quote(requestId, 100)})`}`, null, attempts, { final: true });
    }
    // Stored before it is read: the record names the blob, and a verdict is never taken from a body the house does not keep.
    const assembledText = routed?.text ?? assembled?.text ?? null;
    const stored = await opts.blobs.put(assembledText === null ? raw : Buffer.from(assembledText, 'utf8'));
    const text = assembledText === null ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8') : assembledText;
    // A key masq (or superbot-router) refuses its model pages once an episode (the header's `scope`); an answer re-arms it.
    // OpenRouter's key has no masq scope.
    if (openRouter === null) {
      watchMasqScope({
        url: endpoint,
        model: wireModel,
        key: opts.apiKey,
        episode: router ? JUDGE_ROUTER_SCOPE_EPISODE : JUDGE_SCOPE_EPISODE,
        status: res.status,
        body: text,
        fails: JUDGE_SCOPE_FAILS,
        keyNames: router ? JUDGE_ROUTER_SCOPE_KEYS : JUDGE_SCOPE_KEYS,
        ...(router ? { upstream: 'superbot-router' as const } : {}),
        ...(opts.page ? { page: opts.page } : {}),
      });
    }
    let doc: z.infer<typeof ChatCompletion> | null = null;
    try {
      // A Messages answer is read as the Chat Completions answer it says (the header's `dialect`).
      const parsed = ChatCompletion.safeParse(JSON.parse(masqAnswerText(readAs, text)));
      if (parsed.success) doc = parsed.data;
    } catch {
      doc = null;
    }
    // superbot-router sends no x-masq-model: the body's model is the one that answered.
    const header = router || openRouter !== null ? null : res.headers.get(MASQ_MODEL_HEADER);
    // A model masq swapped in (x-masq-model) is the one that answered and billed, whatever the body names.
    const swapped = header !== null && !isServedModel(opts.agent.model, header) ? header : null;
    const answered = swapped ?? (doc?.model !== undefined && doc.model.trim() !== '' ? doc.model : header);
    const usage = judgeUsageOf(doc?.usage);
    // On OpenRouter who served it and what it cost (usage.cost) are the answer's own (the header's `openrouter`).
    const served: OpenRouterServed | null = openRouter !== null ? openRouterServedOf(text) : null;
    const priced = served?.micro_usd != null ? BigInt(served.micro_usd) : usage === null ? null : priceOf(opts.agent.model, answered, at, usage);
    // OpenRouter's own split of that cost by kind: each kind an answer names is summed; an answer with no
    // cost_details (every router and masq answer) adds nothing, and a refused status bills nothing.
    const split = openRouter !== null && res.ok ? openRouterSpendSplitOf(text) : null;
    if (split !== null) {
      if (split.input !== null) {
        spendByKind.input += BigInt(split.input);
        splitSeen = true;
      }
      if (split.output !== null) {
        spendByKind.output += BigInt(split.output);
        splitSeen = true;
      }
    }
    const attempt: JudgeAttempt = {
      form,
      request_sha256: sha256Hex(json),
      request_bytes: Buffer.byteLength(json),
      at,
      status: res.status,
      response_body_sha256: stored.sha256,
      model_answered: answered,
      finish_reason: doc?.choices?.[0]?.finish_reason ?? null,
      usage,
      micro_usd: priced !== null ? priced.toString() : res.ok ? null : '0',
      invalid: null,
      ...(served?.provider != null ? { provider: served.provider } : {}),
    };
    if (!res.ok && !ANSWER_LEVEL_STATUSES.has(res.status)) {
      attempts.push(attempt);
      opts.onAttempt?.(attempt);
      // On the router every refused answer is final but the Gateway's own, on OpenRouter every one (the header's `final`).
      throw new JudgeCallFault(`${who} answered ${res.status}: ${quote(text, 300)}`, res.status, attempts, router ? { final: !routerGatewayRedialable(res.status, res.headers, text) } : openRouter !== null ? { final: true } : undefined);
    }
    attempt.invalid = res.ok ? null : quote(`${who} refused the request (${res.status}): ${text}`, 300);
    // masq refuses a forced tool to a model that always thinks: the retry offers it instead (the header).
    if (res.status === 400 && (form === 'answer' || form === 'tool') && FORCED_TOOL_REFUSED.test(text)) {
      forms = [form, 'tool_auto'];
      opts.onForcedToolRefused?.();
    }
    if (attempt.invalid === null) {
      const choice = doc?.choices?.[0];
      const message = choice?.message;
      const call = message?.tool_calls?.find((t) => t.function?.name === JUDGE_VERDICT_TOOL)?.function?.arguments;
      const content = call ?? message?.content ?? '';
      if (doc === null) attempt.invalid = quote(`${who} answered ${res.status} with a body that is not a chat completion: ${text}`, 300);
      else if (doc.error !== undefined) attempt.invalid = quote(`${who} answered an error: ${JSON.stringify(doc.error)}`, 300);
      else if (swapped !== null) attempt.invalid = `masq answered with ${swapped} (${MASQ_MODEL_HEADER}), not ${opts.agent.model}, the judge's pinned model`;
      else if (!isServedModel(wireModel, doc.model ?? ''))
        attempt.invalid = `${who}'s answer ${doc.model === undefined || doc.model.trim() === '' ? 'names no model' : `was served by ${doc.model}`}, not ${wireModel}, the judge's pinned model${wireModel === opts.agent.model ? '' : ` (${opts.agent.model}) as superbot-router names it`}`;
      else if (openRouter !== null && !openRouterServedByPin(served?.provider ?? null, openRouter.pin))
        attempt.invalid = quote(
          `${who}'s answer ${served?.provider == null ? 'names no provider' : `was served by ${served.provider}`}, not one of the pin's endpoints (${openRouter.pin.providers.map((p) => `${p.name}, ${p.tag}`).join('; ')})`,
          300,
        );
      else if (choice?.finish_reason === 'length') attempt.invalid = `the answer was cut off at the ${opts.agent.max_output_tokens}-token budget (finish_reason length): a cut answer is never read as a verdict`;
      else if (typeof message?.refusal === 'string' && message.refusal.trim() !== '') attempt.invalid = quote(`the model refused: ${message.refusal}`, 300);
      else if (choice?.finish_reason === 'content_filter' || choice?.finish_reason === 'refusal') attempt.invalid = `the model refused (finish_reason ${choice?.finish_reason})`;
      else if (withoutThinking(content) === '') attempt.invalid = `the answer holds no content${call === undefined && (form === 'tool' || form === 'tool_auto') ? ' and no verdict tool call' : ''} (finish_reason ${choice?.finish_reason ?? 'none'})`;
      else {
        const verdict = judgeVerdictOf(content, JUDGE_VERDICT_FORMAT);
        if (!verdict.ok) attempt.invalid = verdict.why;
        else if (verdict.margin === null) throw new Error('a v2 verdict reads with its margin');
        else taken = { winner: verdict.winner, reason: verdict.reason, margin: verdict.margin };
      }
    }
    attempts.push(attempt);
    opts.onAttempt?.(attempt);
    if (taken !== null) break;
  }
  const last = attempts.at(-1);
  if (last === undefined) throw new Error('a judge call sends at least one request');
  return {
    a_sha256: a.sha256,
    b_sha256: b.sha256,
    verdict: taken?.winner ?? null,
    margin: taken?.margin ?? null,
    winner_sha256: taken === null ? null : taken.winner === 'A' ? a.sha256 : b.sha256,
    reason: taken?.reason ?? null,
    invalid: taken === null ? last.invalid : null,
    request_sha256: last.request_sha256,
    response_body_sha256: last.response_body_sha256,
    model_answered: last.model_answered,
    usage: sumUsage(attempts.map((t) => t.usage)),
    micro_usd: judgeMeterMicroUsd(attempts).toString(),
    micro_usd_by_kind: splitSeen ? spendByKind : null,
    attempts,
  };
}

function sumUsage(all: readonly (CassetteUsageT | null)[]): CassetteUsageT | null {
  let sum: CassetteUsageT | null = null;
  for (const u of all) {
    if (u === null) continue;
    sum ??= { input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, reasoning: 0 };
    for (const k of Object.keys(sum) as (keyof CassetteUsageT)[]) sum[k] += u[k];
  }
  return sum;
}

/**
 * The house meter of a heat's requests, µUSD: every attempt's price summed (`attempts` of each call, or
 * the attempts themselves), an unpriced one adding nothing. What retireTrialKey checks masq's spend against.
 */
export function judgeMeterMicroUsd(items: readonly (JudgeAttempt | Pick<JudgeCallResult, 'attempts'>)[]): bigint {
  let sum = 0n;
  for (const item of items) {
    const attempts = 'attempts' in item ? item.attempts : [item];
    for (const t of attempts) if (t.micro_usd !== null) sum += BigInt(t.micro_usd);
  }
  return sum;
}

// ------------------------------------------------------------------ the heat

export interface JudgeHeatOptions {
  /** Where the heat's key is minted and retired: masq's broker, or server/superbot-router.ts judgeKeyBroker's (masq's or the router's by model). */
  broker: MasqJudgeKeyBroker;
  /** The key's label: the competition, phase and heat attempt. Every heat's key is minted with no dollar cap. */
  key: Pick<JudgeKeySpec, 'slug' | 'phase' | 'attempt'>;
  agent: JudgeAgent;
  /** The HouseAgent prompt file's text. */
  prompt: string;
  media: JudgeMedia;
  /**
   * The house text its requests are built from: the heat setup's house_text (grader/judge-heat.ts), default
   * JUDGE_HOUSE_TEXT, which is what judgeHeatSetup records.
   */
  house?: JudgeHouseText;
  /** Every artifact the heat's calls may carry: a call names two of them by sha256. */
  artifacts: readonly JudgeArtifact[];
  /** The heat's planned calls (judgeHeatCalls): the most it may send. */
  calls: number;
  blobs: JudgeBlobs;
  fetch?: typeof fetch;
  /** Each call's request bound and the model list read's, ms (default: JUDGE_CALL_TIMEOUT_MS for a call, MASQ_TIMEOUT_MS for the list). */
  timeoutMs?: number;
  /** The clock (ms), default Date.now. */
  now?: () => number;
  /** The wait before a fresh key's 401 or a rate-limited request is re-sent (sendJudgeCall), default a timer. */
  sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  /** The jitter on a rate limit's wait when masq names none (sendJudgeCall), default Math.random. */
  random?: () => number;
  signal?: AbortSignal;
  /** Where a router heat's one served line goes as it retires (the header's `served`), default console.warn (a report, not an error: server/ops/errors.ts counts every console.error as a server error). */
  log?: (line: string) => void;
  /**
   * An OpenRouter heat's pin (the header's `openrouter`; server/openrouter-judge.ts JudgePin, as the judge-overflow
   * setting's `pins` hold it): its forms, vision, ceilings and the endpoints every call is pinned to. Given exactly when
   * `broker` mints an OpenRouter key (openRouterJudgeBroker): either without the other retires the key and throws a
   * TypeError, nothing sent. Its preflight never holds for a missing price.
   */
  pin?: JudgePin;
}

/** A heat that started: its key, and its calls. */
export interface JudgeHeat {
  /** The judge key as minted, never its secret (dailyLimitUsd absent: a key with no dollar cap). */
  readonly key: { id: string; prefix: string; label: string; expiresAt: number; dailyLimitUsd?: number };
  readonly system: string;
  readonly budget: JudgeBudget;
  /** The forms its next call is asked in (judgeFormsOf on the model's card; unforced from the first forced form masq refused). */
  forms(): JudgeForms;
  /** The heat's meter so far: every attempt's price (judgeMeterMicroUsd). */
  meterMicroUsd(): bigint;
  /**
   * One call, Entry A the artifact `aSha256`, Entry B `bSha256` (sendJudgeCall). The heat may send its
   * planned calls × JUDGE_CALL_ATTEMPTS requests, what the preflight weighed: a call holds
   * JUDGE_CALL_ATTEMPTS of them while it runs and gives back those it did not send (a request that
   * faulted unanswered counts as sent; a fresh key's 401 or a rate limit, re-sent, counts as none: no model saw it), and
   * a call with too few left is refused, as is one after retire or on an artifact not the heat's. On a superbot-router
   * key a call whose fault was final (JudgeCallFault.final) is never sent again: calling it once more throws a final
   * JudgeCallFault at once, nothing sent and no request spent (the header's `final`); so on an OpenRouter key. `judge`
   * is a pool heat's index of the judge to send it to (the schedule's planned call's `judge`); a single heat ignores it.
   */
  call(aSha256: string, bSha256: string, opts?: { signal?: AbortSignal; judge?: number }): Promise<JudgeCallResult>;
  /**
   * The requests the heat may still send: planned calls × JUDGE_CALL_ATTEMPTS, less what the calls flying hold and
   * the settled calls sent (call's ledger). A call needs JUDGE_CALL_ATTEMPTS of them to start. Optional on the type, as
   * `pushbacks` is: an opened heat always has both (OpenedJudgeHeat); a hand-made one (a test's) may keep neither, and
   * grader/worker.ts sendJudgeHeatCalls then holds no backup back for the ledger and never narrows.
   */
  requestsLeft?(): number;
  /**
   * The rate-limited requests its calls have re-sent so far (sendJudgeCall's onRateLimited, across every call of the
   * heat): masq's pool pushing back, which grader/worker.ts sendJudgeHeatCalls narrows the heat's width on. A re-send is
   * still no attempt and no request of the ledger.
   */
  pushbacks?(): number;
  /** Retire the key against the heat's meter (retireTrialKey): its flags go in the record. Again: masq's disable is idempotent. */
  retire(opts?: BrokerCallOptions): Promise<RetiredTrialKey>;
}

/**
 * Why judge `agent` cannot be sent on OpenRouter's `pin` as asked (the header's `openrouter`), or null: a
 * max_output_tokens past the pin's (its endpoints' least max_completion_tokens), an effort the model does not list, or
 * no effort where it lists some (glm-5.3-flash reasons at `max` when unasked: server/judging/pool.ts judgeEffortFor
 * names one).
 */
export function openRouterOpeningFault(pin: Pick<JudgePin, 'providers' | 'efforts' | 'max_output_tokens'>, agent: JudgeAgent): string | null {
  const on = `OpenRouter's pin of ${agent.model} (${pin.providers.map((p) => p.tag).join(', ')})`;
  if (agent.max_output_tokens > pin.max_output_tokens) {
    return `the judge asks max_output_tokens ${agent.max_output_tokens}, past the ${pin.max_output_tokens} ${on} takes; nothing was sent`;
  }
  const effort = agent.reasoning_effort;
  if (effort !== undefined && !pin.efforts.includes(effort)) {
    return `the judge asks reasoning_effort ${effort}, which ${on} does not list (${pin.efforts.join(', ') || 'none'}); nothing was sent`;
  }
  if (effort === undefined && pin.efforts.length > 0) {
    return `the judge names no reasoning_effort, and ${on} lists ${pin.efforts.join(', ')}: an unasked effort runs at the model's own; nothing was sent`;
  }
  return null;
}

/** A heat openJudgeHeat opened: its ledger (requestsLeft) and its pushback count are always there. */
export type OpenedJudgeHeat = JudgeHeat & Required<Pick<JudgeHeat, 'requestsLeft' | 'pushbacks'>>;

export type JudgeHeatOpening =
  | { held: JudgeHold; budget: JudgeBudget; /** The key a vision hold retired (nothing spent on it); null for a hold before the mint. */ retired: RetiredTrialKey | null }
  | { held: null; heat: OpenedJudgeHeat };

/**
 * Open a heat (the header): the preflight, the key, for an image or dossier heat the vision check, and the forms its
 * calls are asked in (judgeFormsOf on the model's card, the mint's list; the forced pair when the broker
 * handed none on and the heat read none). A hold answers `held` and mints nothing (a vision hold retires
 * the key it read the card with); otherwise the heat, whose calls the caller sends and whose key it
 * retires when the heat ends. Throws JudgeArtifactRefused on an artifact no call can carry (before
 * anything is minted), JudgeCallFault when masq's model list cannot be read, and the broker's own error
 * when the mint fails (masq never answering the new key included). A key superbot-router holds (routerOfKey(minted), the
 * header's `router`) sends its calls to the router's origin on its wire, its cards read under routerWireModel in the
 * router's list (read on the key when the broker handed none on), and opens only when that card names no
 * max_output_tokens under the judge's (server/superbot-router.ts routerCeilingFault: else a JudgeCallFault, its key retired, nothing sent).
 * A key OpenRouter's broker minted (openRouterOfKey(minted)) opens on `pin`, reading no list (the header's `openrouter`).
 */
export async function openJudgeHeat(opts: JudgeHeatOptions): Promise<JudgeHeatOpening> {
  const now = opts.now ?? Date.now;
  const artifacts = new Map<string, JudgeArtifact>();
  for (const a of opts.artifacts) {
    if (sha256Hex(a.bytes) !== a.sha256) throw new JudgeArtifactRefused(a.sha256, `artifact ${a.sha256}'s bytes hash to ${sha256Hex(a.bytes)}, not its name`);
    artifacts.set(a.sha256, a);
  }
  const house = opts.house ?? JUDGE_HOUSE_TEXT;
  const system = judgeSystemPrompt(opts.prompt, house);
  const pre = judgePreflight({
    agent: opts.agent,
    system,
    media: opts.media,
    house,
    artifacts: [...artifacts.values()],
    calls: opts.calls,
    at: new Date(now()).toISOString(),
    // An OpenRouter heat (the header's `openrouter`): its bodies weighed too, and no hold for a missing price.
    ...(opts.pin !== undefined ? { unpriced: 'allow' as const, pin: opts.pin } : {}),
  });
  if (pre.hold !== null) return { held: pre.hold, budget: pre.budget, retired: null };

  const signalOpt = opts.signal !== undefined ? { signal: opts.signal } : {};
  const minted = await opts.broker.mintJudgeKey({ slug: opts.key.slug, phase: opts.key.phase, attempt: opts.key.attempt, model: opts.agent.model }, { now: now(), ...signalOpt });
  const mintedAt = now();
  // A key superbot-router holds (the header's `router`): its calls go to the router's origin, and its cards are read in the
  // router's list under the router's name for the model.
  const routerKey = routerOfKey(minted);
  const router = routerKey !== null;
  // A key OpenRouter's broker minted (the header's `openrouter`): its calls go to the key's origin on the heat's pin, and
  // no model list is read. The pin comes with such a key and no other.
  const openRouterKey = openRouterOfKey(minted);
  const pin = opts.pin ?? null;
  if ((openRouterKey !== null) !== (pin !== null)) {
    await retireTrialKey(opts.broker, minted.id, 0n, signalOpt).catch(() => undefined);
    throw new TypeError(
      openRouterKey !== null
        ? `judge heat ${minted.label}: its key is OpenRouter's, and an OpenRouter heat is opened on its pin (JudgeHeatOptions.pin); nothing was sent`
        : `judge heat ${minted.label}: a pin is an OpenRouter heat's, and its key is ${router ? "superbot-router's" : "masq's"}; nothing was sent`,
    );
  }
  const origin = openRouterKey?.origin ?? routerKey?.origin ?? opts.broker.origin;
  const upstream: JudgeUpstream = router ? 'superbot-router' : pin !== null ? 'openrouter' : 'masq';
  const cardModel = router ? routerWireModel(opts.agent.model) : opts.agent.model;
  let cards: readonly MasqModelCard[] | null = minted.models ?? null;
  if (pin !== null) {
    // A judge the pin cannot serve as asked is the platform's to fix: a fault, its key retired, nothing sent.
    const fault = openRouterOpeningFault(pin, opts.agent);
    if (fault !== null) {
      await retireTrialKey(opts.broker, minted.id, 0n, signalOpt).catch(() => undefined);
      throw new JudgeCallFault(fault, null, []);
    }
    // An image or a dossier heat sends images (the header's `vision`).
    if (opts.media !== 'text' && !pin.vision) {
      const why = `OpenRouter's pin of ${opts.agent.model} (${pin.providers.map((p) => p.tag).join(', ')}) says vision false: the model's input modalities hold no image, so ${judgeHeatNoun(opts.media)} cannot be judged on it`;
      return { held: { kind: 'vision', why }, budget: pre.budget, retired: await retireTrialKey(opts.broker, minted.id, 0n, signalOpt) };
    }
  } else if (opts.media !== 'text' || router) {
    let vision: JudgeHold | null = null;
    let ceiling: string | null = null;
    try {
      cards ??= await judgeModelCards({ origin, apiKey: minted.key, fetch: opts.fetch, timeoutMs: opts.timeoutMs, ...(router ? { upstream } : {}), ...signalOpt });
      if (opts.media !== 'text') vision = judgeVisionHoldOf(router ? judgeModelCard(cards, cardModel) : judgeVisionCard(cards, opts.agent.model), cardModel, upstream, opts.media);
      if (router) ceiling = routerCeilingFault(judgeModelCard(cards, cardModel), opts.agent.model, opts.agent.max_output_tokens);
    } catch (err) {
      await retireTrialKey(opts.broker, minted.id, 0n, signalOpt).catch(() => undefined);
      throw err;
    }
    // The key's output ceiling under the judge's budget: the platform's to fix, so a fault, with nothing sent.
    if (ceiling !== null) {
      await retireTrialKey(opts.broker, minted.id, 0n, signalOpt).catch(() => undefined);
      throw new JudgeCallFault(ceiling, null, []);
    }
    // Nothing was sent on the key: its meter is truly 0.
    if (vision !== null) return { held: vision, budget: pre.budget, retired: await retireTrialKey(opts.broker, minted.id, 0n, signalOpt) };
  }
  let forms: JudgeForms = pin !== null ? (pin.forms === 'unforced' ? JUDGE_UNFORCED_FORMS : JUDGE_FORCED_FORMS) : judgeFormsOf(cards === null ? null : judgeModelCard(cards, cardModel));

  const attempts: JudgeAttempt[] = [];
  let requestsLeft = opts.calls * JUDGE_CALL_ATTEMPTS;
  let pushbacks = 0;
  let retired = false;
  // On superbot-router (the header's `final` and `served`): the calls whose fault was final, by their ordered pair, so the
  // heat's fault re-send of one is refused unsent; and what each answer said of how it was served, for the one log line.
  const finalFaults = new Map<string, JudgeCallFault>();
  const served: RouterServed[] = [];
  let servedLogged = false;
  const pairOf = (aSha256: string, bSha256: string): string => `${aSha256}>${bSha256}`;
  const heat: OpenedJudgeHeat = {
    key: { id: minted.id, prefix: minted.prefix, label: minted.label, expiresAt: minted.expiresAt },
    system,
    budget: pre.budget,
    forms: () => forms,
    meterMicroUsd: () => judgeMeterMicroUsd(attempts),
    requestsLeft: () => requestsLeft,
    pushbacks: () => pushbacks,
    async call(aSha256, bSha256, callOpts = {}) {
      if (retired) throw new Error(`judge heat ${minted.label}: its key is retired, so it sends no more calls`);
      const a = artifacts.get(aSha256);
      const b = artifacts.get(bSha256);
      if (a === undefined || b === undefined) throw new TypeError(`judge heat ${minted.label}: artifact ${a === undefined ? aSha256 : bSha256} is not one of the heat's, whose worst case the preflight weighed`);
      // A call superbot-router answered finally is never sent again (the header's `final`): the heat's fault re-send of it
      // faults at once, nothing sent, no request of the ledger spent.
      const before = finalFaults.get(pairOf(aSha256, bSha256));
      if (before !== undefined) {
        throw new JudgeCallFault(
          (pin !== null
            ? `OpenRouter's answer to this call was final, so it is not sent again (one named wait a call, and nothing re-sends what OpenRouter answered); nothing was sent. It was: ${before.message}`
            : `superbot-router's answer to this call was final, so it is not sent again (clients.md CL-2, §4.5: one retry layer, and nothing re-sends what the router answered but the waits it names); nothing was sent. It was: ${before.message}`
          ).slice(0, 600),
          before.status,
          [],
          { final: true },
        );
      }
      if (requestsLeft < JUDGE_CALL_ATTEMPTS) {
        throw new RangeError(
          `judge heat ${minted.label}: its ${opts.calls} planned calls' ${opts.calls * JUDGE_CALL_ATTEMPTS} requests are sent but ${requestsLeft}, and a call may take ${JUDGE_CALL_ATTEMPTS}; the preflight weighed no more`,
        );
      }
      requestsLeft -= JUDGE_CALL_ATTEMPTS;
      const signal = callOpts.signal ?? opts.signal;
      let result: JudgeCallResult;
      try {
        result = await sendJudgeCall(
          {
            origin,
            apiKey: minted.key,
            agent: opts.agent,
            system,
            media: opts.media,
            house,
            blobs: opts.blobs,
            fetch: opts.fetch,
            timeoutMs: opts.timeoutMs,
            now,
            ...(opts.sleep !== undefined ? { sleep: opts.sleep } : {}),
            ...(opts.random !== undefined ? { random: opts.random } : {}),
            ...(signal !== undefined ? { signal } : {}),
            forms,
            // A static router key has no warm-up: its 401 is a fault at once.
            ...(router ? { router: true } : pin !== null ? { openrouter: { pin, label: minted.label } } : { keyMintedAt: mintedAt }),
            onAttempt: (t) => attempts.push(t),
            onForcedToolRefused: () => {
              forms = JUDGE_UNFORCED_FORMS;
            },
            onRateLimited: () => {
              pushbacks++;
            },
            ...(router ? { onRouterServed: (s: RouterServed) => void served.push(s) } : {}),
          },
          a,
          b,
        );
      } catch (err) {
        // A fault's answered attempts were sent; so may an unanswered request have been (masq may bill it).
        if (err instanceof JudgeCallFault) requestsLeft += JUDGE_CALL_ATTEMPTS - Math.min(JUDGE_CALL_ATTEMPTS, err.attempts.length + (err.status === null ? 1 : 0));
        if ((router || pin !== null) && err instanceof JudgeCallFault && err.final) finalFaults.set(pairOf(aSha256, bSha256), err);
        throw err;
      }
      requestsLeft += JUDGE_CALL_ATTEMPTS - result.attempts.length;
      return result;
    },
    async retire(retireOpts = {}) {
      retired = true;
      // A router heat's one served line (the header's `served`): never a record field, so the heat's record is as it was.
      if (router && !servedLogged) {
        servedLogged = true;
        (opts.log ?? ((line: string) => console.warn(line)))(`[judge] heat ${minted.label} on superbot-router (${cardModel}): ${routerServedWords(served)}`);
      }
      return retireTrialKey(opts.broker, minted.id, judgeMeterMicroUsd(attempts), retireOpts);
    },
  };
  return { held: null, heat };
}
