// The competition bundle: what competitions/<slug>/competition.yaml holds, shaped after Codabench's
// competition.yaml (phases, a leaderboard of typed columns, a submission rule) plus what makefun
// adds (harness, prizes, sandbox limits, the authorship gate, the board's resolution panel).
//
//   competition       slug, copy, board facts, window, resolution panel; optional `demand`, one
//                     sentence on who wants the winning artifact; optional `rehost` (Rehost below), the
//                     upstream GitHub issue bounty a patch/v1 competition rehosts; optional
//                     `prerequisites` (Prerequisites below), what an agent needs to take the bounty on
//   harness           pumpfun-replay/v2 (the protocol in protocol.ts; optional `counterparties: true`
//                     opts in to the distinct-counterparties metric) | program/v1 (Codabench-style:
//                     the entrant writes outputs, a separate scorer writes scores.json keyed by
//                     leaderboard column keys; optional `generator` draws each instance, or optional
//                     `pack` with `gate`, `cases`, `size` and `timing` grades a code bounty on a hidden
//                     test pack) |
//                     bars-replay/v1 (the causal OHLC bars replay: bars-protocol.ts BarsReplayHarness) |
//                     clmm-replay/v1 (one concentrated-liquidity position over a recorded pool's
//                     state, hour by hour: clmm-protocol.ts ClmmReplayHarness) |
//                     agent/v1 (an LLM agent entry graded on K beacon-drawn instances, each a metered
//                     live trial against the bundle's env, then its replay: AgentHarness below,
//                     contracts/agent.ts) |
//                     scrape/v1 (an entry that reads live web data the fastest, timed over a heat of
//                     drand-ordered rounds, every request through the house's recording TLS gateway,
//                     each trial's output checked by the bundle's sealed scorer against that trial's
//                     own cassette: ScrapeHarness below, contracts/scrape.ts) |
//                     patch/v1 (a unified diff to an upstream repo's sealed tree, graded by the repo's
//                     own tests, published on dev and hidden on final: contracts/patch.ts) |
//                     referral/v1 (an ad page and its image at the entry's repository root, checked by
//                     the referral contest's rules rather than run: ReferralHarness below). The three replays
//                     (isReplayKind) drive a bot in lockstep over a frozen dataset and score its
//                     action log, so their columns read the score JSON by source path
//   phases            dev, then final: sequential, non-overlapping
//   leaderboard       columns with sorting / precision / hidden / computation (avg | avg_rank over
//                     other columns' indexes, never over a baseline_margin or speedup column;
//                     baseline_margin | speedup over one raw column, measured against the gate
//                     baseline) and optional public significant_figures; primary_index
//                     names the rank column; optional tie_break_index the column an exact tie on
//                     the rank key is ordered by before the earlier receipt; optional placements
//                     whether scores and places show while the competition runs (PLACEMENTS below:
//                     absent, hidden from all but admins until the ranking phase is finalized)
//   submission_rule   Codabench rule + per-day cap + makefun's entry requirements
//   prizes            placement prizes and the efficiency prize; competition.reward_usd is their sum
//   build_meter       optional (BuildMeter): the sponsor's build allowance, which pays each entrant's
//                     make.fun-issued, house-metered masq build key, its per-entrant share and the
//                     models a key may call, so a program/v1 bundle ranked on build cost
//                     (cost.micro_usd, with prize_requires_efficiency) ranks on what the house's meter
//                     saw (buildMeterIssues); not a prize, so no part of reward_usd
//   entry_fee         optional (EntryFee): a fixed USDC fee an account pays once per bounty, into the
//                     bounty's escrow vault, where it joins the pot; absent, entry is free
//   limits            sandbox cpus, memory_mb, pids, wall_budget_sec
//   min_authored_coverage   the efficiency prize's authorship gate (0..1)
//   prize_requires_beating_hold_cash   optional (pumpfun-replay/v2 and bars-replay/v1 only): a
//                     placement prize needs a net PnL above holding cash (> 0 after every fee); absent,
//                     beating hold-cash gates a pump replay's efficiency view alone, and a bars replay's
//                     nothing
//   prize_requires_beating_baseline   optional (any harness, pumpfun-replay/v2 and agent/v1 included;
//                     never beside prize_requires_beating_hold_cash, nor on a bars-replay/v1 universe of
//                     one symbol, the loader's barsBaselineUniverseIssue): a placement prize needs a
//                     rank value better than every published house baseline's
//   house_holds_places   optional (any harness): a house entry or a baseline that would place as an
//                     entrant holds that place, and the place pays nothing (its prize unawarded), so
//                     the entrants behind it keep the places they finished in; absent or false, a
//                     house entry or baseline takes no place and the next entrant takes the place it
//                     would have (server/routes/competitions/ranking.ts holdsHousePlace)
//   prize_requires_efficiency   optional (any harness): a placement prize needs the entry to be
//                     efficiency-eligible (a priced, authored build), for a competition ranked on build
//                     cost. A prize bar (beating hold-cash or the baseline) is each harness's to name,
//                     never required: a sponsored program/v1 code bundle, graded on a hidden test pack
//                     with no house baseline to beat, carries none
//   prize_gate        optional (PRIZE_GATES below, each gate its own harness's: PRIZE_GATE_HARNESS):
//                     'rehearsal' (pumpfun-replay/v2) lists no prize until a passing rehearsal of the
//                     hindsight check binds this competition's sealed pool, and a bundle that lists a
//                     prize beside a sealed-window.yaml must name it; 'accord' (patch/v1, exactly the
//                     bundles with competition.rehost) lists no prize until the upstream owner has
//                     accepted the accord rehost.accord_sha256 names (contracts/rehost.ts)
//   automation        optional (Automation): `lifecycle: true` opts the competition in to the
//                     automation job, which locks the ranking phase at the deadline, settles the gates
//                     resolve needs, plays its reveal and resolves it; `payouts` 'auto' lets the prize
//                     hot wallet pay each screened manual-rail claim, 'manual' (the default) leaves
//                     every payout to an admin
//   phases[].reveal   optional, on the ranking phase only, one of two shapes told apart by their keys
//                     (PHASE_REVEAL below): on a replay harness PhaseReveal, the running phase, a
//                     replay of the sealed phase's stored traces after its lock at `speed` times the
//                     window's pace; on program/v1 and agent/v1 PhaseCheckReveal, the freeze-and-
//                     resolve reveal of the sealed phase's scored parts (server/live/resolver.ts
//                     revealPlan) over `duration_sec`
//   phases[].race     optional, on a bars-replay/v1 or pumpfun-replay/v2 ranking phase only (PhaseRace
//                     below): the live race, every racer run over its window (raceWindowOf: a bars race
//                     the phase's [starts_at, ends_at] bar by bar as the recording `recording` takes
//                     them, a pump race [starts_at, starts_at + hours] minute by minute as the tap
//                     `recording` takes the chain), a provisional third execution beside the official
//                     grade of the frozen window, which alone ranks and pays; raceOf reads it
//   phases[].practice_windows   optional, on the dev phase of a pumpfun-replay/v2 bundle only (PracticeWindows
//                     below): `count` (odd, 3..9) masked practice windows of `hours` each replace the
//                     phase's one dataset, the dev score is the median window's net PnL, and the optional
//                     `stress` is the block-surrogate runs per dev entry (shown, never ranked); the phase's
//                     `dataset` stays null
//   market            retired (RetiredMarket): the deleted play-credit market's terms, parsed only so a
//                     bundle stored with them still parses and hashes as stored; a repo bundle never
//                     names it (server/competitions/load.ts refuses one that does)
//
// Every optional key above has no default: absent, it adds no key to the parsed bundle, so a bundle
// that does not use it keeps its hash. Inside a block that is present (automation, a reveal) the
// block's own defaults fill in, and are part of the hash. What the contract cannot weigh on one block
// alone (a reveal off the ranking phase) the loader refuses: server/competitions/load.ts
// automationIssues; a race against the harness, the phase, the deadline, the bar grid and the
// automation, raceIssues; a sealed window's revealed final phase that ends, its directory rules (unknownWindowIssues). A
// check reveal's own rules against the rest of the bundle (its harness, its parts against the
// leaderboard's columns, the tie-break column) are the bundle's refinement's (checkRevealIssues).
//
// Sealed digests (program/v1, optional): harness.scorer_sha256, reference_sha256, input_sha256 and
// generator_sha256 fix the scorer directory, the reference data, the input data and the generator
// directory by content, so the bundle's own hash (rules_sha256 when it has no sidecar) covers the
// files beside it too. Each is a tree digest (SEALED_DIGEST_KEYS); server/competitions/load.ts
// treeSha256 computes it and directoryIssues checks it. Sealed is all or nothing: the scorer, and
// the reference, the input and the generator exactly when the harness names one; a sealed scorer
// lives in a directory of its own (its digest cannot cover competition.yaml). The input data is never
// the reference data: the same path, one inside the other, or one tree digest for both would mount the
// answer key at /input (programDataApartIssues). Absent, no key
// appears, so every unsealed bundle keeps its hash. A sponsored competition is scored by a house
// template (contracts/sponsor-proposal.ts, server/proposals/templates.ts) and uploads no scorer or
// data: what seals one is the house's alone (a code bundle's pack and scorer, below).
//
// A pack program/v1 harness (ProgramHarness.pack, ProgramPack: house-set, a code bounty's) grades each
// phase on a test pack the make.fun team attaches at setup, kept in the house's store by tree digest,
// never in the competition directory: dev input and reference (the public examples), final input and
// reference (the hidden cases) and the oracle (the reference solution), each fixed by its tree digest,
// so the bundle's hash (an escrow's rules_sha256) binds the cases. Like an instance-drawn harness it
// names no input or reference data of its own (input_data and scorer.reference_data null) and is
// always sealed (scorer_sha256, the scorer in a directory of its own); it never has a generator. Beside
// it, house-set too: `gate`, the key of a scored 0/1 column an entry must score 1 in to rank among the
// passing entries and take a prize (eligibility `failed_tests`); `pass_count`, on a harness with no
// gate, the key of a scored column counting the cases an entry passes, a prize needing at least one
// (eligibility `failed_tests` at 0, its rank kept); `cases: per-file`, required, one run per case with
// only that case's input mounted, so the entry never reads the other cases or the pack's salt;
// `size` (ProgramSize), the entry's code counted in bytes; `timing` (ProgramTiming), a CPU-time heat.
// A size count or a timing heat ranks the entries that pass, in one language: each needs the gate and
// exactly one runtime (programGateIssues). Any program/v1 harness may name `max_entry_bytes`, the most
// bytes the entry's repository holds, all its regular files together and every one counted
// (programEntryCapOf; a timed code bounty's is 1 MiB, to bound lookup tables: server/proposals/
// compose.ts); intake refuses a larger tree (server/repos/intake.ts entryRepoVerdict, entry_size).
// Absent, no cap. Any program/v1 harness may name `entry_link` (ProgramEntryLink), a file of the entry's
// repository that names a public link to what it built ('roblox': the experience's place; 'pumpfun': the
// coin's mint and the signature of the transaction that created it), which the house looks up before
// grading (the entry_link intake check); absent, no key appears.
//
// A judge program/v1 harness (ProgramHarness.judge, ProgramJudge) ranks the artifact each passing entry
// writes (`artifact`: a text, an image or a dossier, PROGRAM_JUDGE_MEDIA) by a house model's verdicts on
// pairs of them (JudgeAgent: an
// exact model id, a weighted pool of them or the house's pool, its prompt a file of the judge
// directory): Swiss rounds over the entries and the house
// anchors (at least PROGRAM_JUDGE_MIN_ANCHORS artifacts under the judge directory's anchors/), then a
// playoff among the top places, each entry's result at performance.judge (contracts/score.ts
// ProgramJudgeScore). Its judge directory is sealed (judge_sha256, a tree digest: a directory of its own,
// apart from the scorer's and the data, and the harness is sealed with it). It needs the gate (the scorer
// says whether an artifact is valid) and resolution.method 'judges', ranks on JUDGE_WIN_RATE_SOURCE
// descending, and names no timing, size, pass_count or generator, nor prize_requires_beating_baseline
// (programJudgeIssues). No spend cap holds a heat: the max_total_usd and dev_daily_usd an opened
// bundle still names parse, keep its hash, and are read by nothing. Its optional ladder
// (ProgramJudgeLadder) is the dev phase's calibrated ladder, a directory of its own sealed by
// ladder_sha256 (apart from the judge directory, the scorer's and the data), so a ladder's calibration
// or rungs never move judge_sha256; absent, no key appears. Its optional screened block
// (ProgramJudgeScreened) opts the final into the screened, raced heat (judge heat v4): it screens the field
// on the ladder's dev ratings, so it needs the ladder; absent, no key appears. A bundle naming contender_games above 0
// (default 0, off) also plays the dev phase's contender rounds: the top dev entries judged against one another by the
// bundle's own named judge into sealed records no one reads before the deadline, published with the final heat; they
// only add members to the house-only screen's shortlist and seed the final's first pairings, never cut a member the
// house-only screen keeps and never set a score. Its race reads the prize boundaries from placement prizes
// at places exactly 1 to K (grader/judge-race.ts judgeRaceTiers), so a screened bundle's places skip none. Its optional review
// (ProgramJudgeReview) holds the top places of the settled final heat for the make.fun team's review before
// results publish, for at most `minutes`; absent, no key appears, and nothing waits on a review.
// 'judges' itself is refused on a bundle without a house judge or a house target (AgentHarness.target).
//
// An instance-drawn program/v1 harness (one with a `generator`) has no input or reference data of
// its own: input_data and scorer.reference_data are null, and each instance (a practice one, and the
// scored one drawn from a public beacon round after the deadline) supplies both. It is always
// sealed, scorer and generator, and its generator lives in a directory of its own, apart from the
// competition root and the scorer's directory.
//
// A final-dataset program/v1 harness (ProgramHarness.final_dataset: true) grades its dev phase on the
// bundle's own sealed input_data and reference_data and its final phase on a dataset recorded after the
// deadline (contracts/program-dataset.ts), attached sealed as a replay's final window is: a forecast
// whose answer exists only once its time has come (roblox-trending-forecast-01). Its final is locked and
// graded only once that dataset is attached (gradesOnPhaseDataset), and it names no generator, pack,
// judge, timing heat or size count (programFinalDatasetIssues). It may name `cases: per-file`: each
// phase then runs an entry once per case of the data it grades on, the bundle's own on dev and the
// attached dataset's on final (its reference/manifest.json listing the cases: grader/program.ts
// executePerCase), as polymarket-nvidia-ceo-forecast-01's hourly checkpoints are run.
//
// An agent/v1 harness (AgentHarness) is always instance-drawn and always sealed: its generator, its
// env (the store simulator the agent works against) and its scorer each live in a directory of their
// own, apart from the competition root and from one another, and each is fixed by its tree digest
// (AGENT_SEALED_DIGEST_KEYS: generator_sha256, env_sha256, scorer_sha256). Its scorer takes no
// reference data of its own: each instance supplies it. Its leaderboard is what the run is
// aggregated on (agentLeaderboardIssues, the one rule grader/agent-score.ts agentColumns applies):
// a scored primary column and a scored `working` column (AGENT_WORKING_COLUMN), so a bundle that
// could not be aggregated is refused at load, before any trial spends inference money. Its
// limits.wall_budget_sec is at most AGENT_MAX_WALL_BUDGET_SEC (10 h), so each trial's masq key (2 × the
// wall budget + 1 h) lives under the 24 h masq allows. Its optional `entry` (AgentEntryCaps) caps the
// entry's tree, max_file_bytes for one regular file and max_tree_bytes for all of them, so an entry
// carries no model of its own; intake refuses a tree over either (entry_size). Absent, no cap. Its
// optional `target` (AgentTarget) is the house target: 1 to 4 exact model ids (the target and an
// optional referee) the env calls through the house lane (contracts/agent.ts AGENT_HOUSE_ENV), metered
// apart from the entry's own calls as `inference` meters those, with no prompt of its own (each
// instance's generator writes the persona). Absent, the env calls no model. Its optional `model_calls`
// takes one value, `optional` (AGENT_MODEL_CALLS_OPTIONAL): the competition does not require model
// calls, which waives the LLM agent floor for every entry (grader/agent-score.ts heldToFloor), so a
// scripted program that calls no model (a chess engine, a poker bot) is a legal entry and scored as
// any other; its `inference` stays, every model call an entry does make metered against it. Absent,
// each entry is an LLM agent, held to the floor unless a target waives it, and no key appears, so a
// bundle without it keeps its hash.
//
// A scrape/v1 harness (ScrapeHarness) is always sealed: its scorer lives in a directory of its own,
// apart from the competition root, fixed by its tree digest (scorer_sha256), and takes no reference
// data of its own: each trial's cassette is its reference, beside the heat's reference read (the
// house's own read at heat start, /reference/heat/). Its `network` (contracts/scrape.ts
// ScrapeNetwork) is what a trial may reach through the gateway, and its `heat` (ScrapeHeatConfig) how
// the heat runs; every number of the heat has a default, so a bundle names only what it changes.
//
// A patch/v1 harness (contracts/patch.ts PatchHarness) is always sealed by its shape: the upstream's
// tree at the bounty's commit, the test image, both phase trees, the oracle and the witness record each
// fixed by a digest, none of them in the competition directory. What the bundle around it must be is
// the bundle's refinement's: its phases exactly dev then final, the final's scores after_finalize (the
// final grades hidden tests, so no score shows before the phase is finalized); its leaderboard columns
// keys of PatchPerformance.scores (PATCH_SCORE_COLUMNS), one of them resolved, the gate; its
// limits.wall_budget_sec at most AGENT_MAX_WALL_BUDGET_SEC, as an agent/v1 trial's; and no prize_gate
// but 'accord', a rehosted bounty's. Its max_entry_bytes is the entry's repository cap
// (programEntryCapOf), as a program/v1 harness's.
//
// A referral/v1 harness (ReferralHarness) is an ad page (REFERRAL_PAGE_PATH) and its image
// (REFERRAL_IMAGE_PATH) at the entry's repository root, checked by the referral contest's rules rather than
// run: it names no runtimes, scorer, judge, heat, dataset or timing, and harnessRuntimesOf is empty for it.
// Its bundle runs exactly a dev phase (entries taken until the deadline) and a final phase that starts at or
// after the deadline: the 24-hour pause before the house checks the entries, whose verdict
// (server/db/schema.ts referralContestVerdict: verified, unverified or undecided, by the rules or an audit)
// is what its leaderboard columns read at performance.scores.<key> (contracts/score.ts ReferralPerformance).
// It lists placement prizes alone (no efficiency prize), never gates them on beating a baseline (no baseline
// is run), and every entry carries its transcripts (submission_rule.transcripts_required): the ad page is the
// thinking gate's entrypoint (server/entries/policy.ts HARNESS_THINKING_POLICY).
//
// A rehosted bounty (competition.rehost, Rehost below) is an open bounty on an upstream GitHub issue
// that the house runs as a patch/v1 competition: the winning patch goes upstream under the house's
// name, and the upstream bounty pays for it. The bundle names the upstream issue and its bounty, the
// sha256 of the accord the upstream owner ratifies (contracts/rehost.ts RehostAccord, accordSha256:
// the grader, the review window, the grounds a patch may be rejected on), when the house submits
// upstream and how long the owner reviews. Its refinement ties it to the rest of the bundle: a
// patch/v1 harness grading the upstream's repo, prize_gate 'accord', exactly one placement prize, place
// 1 (the entry the owner accepts), and leaderboard.placements absent or after_finalize. Absent, no key
// appears, so a bundle without it keeps its hash; ops_cost_usd has a default only inside it.
//
// A bundle's prerequisites (competition.prerequisites, Prerequisites below) tell an agent, before it
// starts, what it needs to realistically complete the bounty: the software the person's machine must run
// (its platforms, and a version when it matters), the MCP servers that integrate the agent with that
// software (each a stdio launch line per platform or a streamable-http URL, its MCP Registry name, and the
// tool names that show it is connected), and the accounts on other sites the work needs (the provider and
// what the account must be able to do). Each item is required or recommended and says why, how an agent
// checks it has it (prose or a tool name, never a command to run), what the agent can fix itself and what
// it tells the person it works for; `if_unmet` says what to do when a required item is missing, `label` is
// the card's pill and `as_of` the date the block was last checked. No item carries a credential. Not
// `requirements`: that name is an entry's submission checklist (server/entries/requirements.ts, GET
// /requirements). Absent, no key appears, and no key inside the block has a default, so a bundle without
// it keeps its hash.

import { z } from 'zod';
import { BarsReplayHarness } from './bars-protocol.ts';
import { ClmmReplayHarness } from './clmm-protocol.ts';
import { isPatchRepoUrl, PATCH_HARNESS_KIND, PATCH_PHASES, PATCH_SCORE_COLUMNS, PatchHarness } from './patch.ts';
import { Fixed9, FIXED9_SCALE, IsoDateTime, parseFixed9, Sha256Hex, Slug, U64 } from './primitives.ts';
import { Caps, Capital, Fees, PROTOCOL } from './protocol.ts';
import { SCRAPE_HARNESS_KIND, SCRAPE_INTERVAL_LEVEL, ScrapeHeatConfig, ScrapeNetwork, StagedHeat } from './scrape.ts';

export const COMPETITION_BUNDLE_VERSION = 1;

export const HARNESS_KINDS = ['pumpfun-replay/v2', 'program/v1', 'bars-replay/v1', 'agent/v1', 'clmm-replay/v1', 'scrape/v1', 'patch/v1', 'referral/v1'] as const;
export const HarnessKind = z.enum(HARNESS_KINDS);
export type HarnessKindT = (typeof HARNESS_KINDS)[number];

/** referral/v1 (the header): an ad page and its image, checked by the referral contest's rules rather than run. */
export const REFERRAL_HARNESS_KIND = 'referral/v1';

/** The ad page a referral/v1 entry ships at its repository root: the entrypoint the thinking gate reads. */
export const REFERRAL_PAGE_PATH = 'index.html';

/** The ad image a referral/v1 entry ships at its repository root. */
export const REFERRAL_IMAGE_PATH = 'ad.png';

/** The replay harness kinds: a bot driven in lockstep over a frozen dataset, its action log scored (pump curves, OHLC bars, a CLMM pool's state). */
export const REPLAY_KINDS = ['pumpfun-replay/v2', 'bars-replay/v1', 'clmm-replay/v1'] as const satisfies readonly HarnessKindT[];
export type ReplayKindT = (typeof REPLAY_KINDS)[number];

/**
 * Whether a harness kind is a replay (REPLAY_KINDS): its leaderboard columns read the score JSON by
 * source path (there is no scores.json), and every phase grades on a frozen dataset.
 */
export function isReplayKind(kind: HarnessKindT): kind is ReplayKindT {
  return (REPLAY_KINDS as readonly HarnessKindT[]).includes(kind);
}

/**
 * The harness kinds a bundle may gate its prizes on beating hold-cash
 * (CompetitionBundle.prize_requires_beating_hold_cash): the replays that rank on a net PnL in cash,
 * which holding cash makes exactly 0 (the pump replay's lamports, the bars replay's quote units). The
 * clmm replay ranks on hedged PnL instead, and gates its prizes on its baseline.
 */
export const HOLD_CASH_KINDS = ['pumpfun-replay/v2', 'bars-replay/v1'] as const satisfies readonly ReplayKindT[];

export const PHASE_KEYS = ['dev', 'final'] as const;
export const PhaseKey = z.enum(PHASE_KEYS);

/** The board's category tabs (src/lib/bounty.ts BOUNTY_CATEGORIES). */
export const CATEGORIES = ['Trading', 'Forecasting', 'Security', 'Automation', 'Growth', 'Games', 'Code'] as const;
export const Category = z.enum(CATEGORIES);

export const COMPETITION_STATUSES = ['draft', 'open', 'closed', 'resolved'] as const;
export const CompetitionStatus = z.enum(COMPETITION_STATUSES);

export const VISIBILITIES = ['public', 'internal'] as const;
export const Visibility = z.enum(VISIBILITIES);

/**
 * Sandbox runtimes: node22 runs `node /bot/main.ts`, python3.13 runs `python3 -P -s /bot/main.py` with
 * PYTHONHASHSEED=0 in its environment (not -I: it implies -E, which would ignore PYTHONHASHSEED).
 */
export const RUNTIMES = ['node22', 'python3.13'] as const;
export const Runtime = z.enum(RUNTIMES);

/** A leaderboard column key (also the key in a program/v1 scores.json). */
export const ColumnKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'expected a snake_case column key');

/** A path inside the competition directory: relative, POSIX, no `..`, no dot-files. */
export const BundlePath = z
  .string()
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/, 'expected a relative path inside the competition directory');

/** A USD amount: a non-negative number with at most two decimals. */
export const UsdAmount = z
  .number()
  .nonnegative()
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'at most two decimals');
const usd = UsdAmount;

/** How a competition resolves (Resolution.method): 'judges' only on a bundle with a house judge or a house target (the header). */
export const ResolutionMethod = z.enum(['automated', 'judges', 'onchain', 'metric', 'first-valid']);

/** The bounty page's Resolution panel (src/lib/bounty.ts BountyResolution, snake_case). */
export const Resolution = z.strictObject({
  method: ResolutionMethod,
  summary: z.string().min(1),
  criteria: z.array(z.string().min(1)),
  source: z.string().min(1),
  verifier: z.string().min(1),
  tie_break: z.string().min(1),
  announce: z.string().min(1),
  metric: z
    .strictObject({
      name: z.string().min(1),
      unit: z.string(),
      better: z.enum(['higher', 'lower']),
    })
    .nullable()
    .default(null),
});

/** The longest competition.demand, in UTF-16 code units (CompetitionInfo.demand). */
export const MAX_DEMAND_CHARS = 240;

/** Run a refinement only on a value whose shape already parsed. */
const whenValid = { when: (payload: { issues: readonly unknown[] }): boolean => payload.issues.length === 0 };

/**
 * A USD amount as a canonical decimal string: whole dollars with no sign and no leading zero, then
 * exactly two decimals ('250.00', '0.50'), so an amount hashes one way (server/rehost/discovery.ts
 * formatUsd writes this form). At most 10 whole-dollar digits: the rehost row's amounts are
 * numeric(12,2) (server/db/schema.ts), so a larger amount is a contract issue here, not an overflow there.
 */
export const UsdDecimal = z.string().regex(/^(0|[1-9][0-9]{0,9})\.[0-9]{2}$/, { error: "expected a USD amount with exactly two decimals and at most 10 whole-dollar digits, such as '250.00'", abort: true });

/**
 * Whether `url` is an https URL in its normal form (URL.href writes it back unchanged, so it hashes one
 * way), with no credentials, on a host with a dot in its name (no localhost).
 */
export function isHttpsUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const u = new URL(url);
  return u.protocol === 'https:' && u.href === url && u.username === '' && u.password === '' && u.hostname.includes('.');
}

/** An https URL in its normal form (isHttpsUrl). */
export const HttpsUrl = z.string().refine(isHttpsUrl, 'expected an https URL in its normal form, as URL.href writes it');

/** The platforms a rehosted bounty is taken from (RehostUpstream.platform): GitHub issue bounties only. */
export const REHOST_PLATFORMS = ['github'] as const;
export const RehostPlatform = z.enum(REHOST_PLATFORMS);

/** The longest owner review a rehost names (Rehost.review_days), in days. */
export const REHOST_MAX_REVIEW_DAYS = 60;

/** The house's cost of running a rehost when its bundle names none (Rehost.ops_cost_usd). */
export const REHOST_OPS_COST_USD = '250.00';

/**
 * The upstream bounty a competition rehosts: the GitHub issue (its URL, and the owner/name and number
 * it is spelled from, as GitHub spells them), the bounty's amount in USD (above 0), and the URL of the
 * bounty program's written terms, null when the issue has none.
 */
export const RehostUpstream = z
  .strictObject({
    platform: RehostPlatform,
    /** https://github.com/<repo>/issues/<issue>, exactly. */
    url: z.string(),
    /** owner/name: https://github.com/<repo> is the harness's repo.url (isPatchRepoUrl). */
    repo: z.string().refine((r) => isPatchRepoUrl(`https://github.com/${r}`), 'expected owner/name of a GitHub repository: no .git, no trailing /'),
    issue: z.int().min(1),
    amount_usd: UsdDecimal.refine((s) => /[1-9]/.test(s), 'the upstream bounty pays more than 0.00'),
    terms_url: HttpsUrl.nullable(),
  })
  .superRefine((u, ctx) => {
    const want = `https://github.com/${u.repo}/issues/${u.issue}`;
    if (u.url !== want) ctx.addIssue({ code: 'custom', path: ['url'], message: `expected the upstream issue's URL, ${want}: https://github.com/<repo>/issues/<issue>` });
  }, whenValid);

/**
 * A rehosted bounty (CompetitionInfo.rehost): the upstream bounty, the sha256 of the accord its owner
 * ratifies (contracts/rehost.ts accordSha256 of the RehostAccord in competitions/<slug>/accord.json),
 * when the house submits the winning patch upstream by, how many days the owner reviews it, and the
 * house's cost of running it (default REHOST_OPS_COST_USD).
 */
export const Rehost = z.strictObject({
  upstream: RehostUpstream,
  accord_sha256: Sha256Hex,
  submit_by: IsoDateTime,
  review_days: z.int().min(1).max(REHOST_MAX_REVIEW_DAYS),
  ops_cost_usd: UsdDecimal.default(REHOST_OPS_COST_USD),
});
export type RehostT = z.infer<typeof Rehost>;
export type RehostUpstreamT = z.infer<typeof RehostUpstream>;

/** The most items each list of a prerequisites block holds (Prerequisites.software, mcp_servers, accounts). */
export const PREREQUISITES_MAX_ITEMS = 8;
/** The longest prerequisites label (the card pill's words), summary and if_unmet, in UTF-16 code units. */
export const PREREQUISITES_MAX_LABEL_CHARS = 28;
export const PREREQUISITES_MAX_SUMMARY_CHARS = 240;
export const PREREQUISITES_MAX_IF_UNMET_CHARS = 300;
/** The platforms a prerequisite runs on, as Node's process.platform names them (PrerequisiteSoftware.platforms, PrerequisiteMcpServer.config). */
export const PREREQUISITE_PLATFORMS = ['darwin', 'win32', 'linux'] as const;
export const PrerequisitePlatform = z.enum(PREREQUISITE_PLATFORMS);
/** How an agent reaches an MCP server (PrerequisiteMcpServer.transport): a local process it launches, or a remote URL. */
export const MCP_TRANSPORTS = ['stdio', 'streamable-http'] as const;
/** The most arguments an MCP server's launch line holds (PrerequisiteMcpLaunch.args) and the most tool names it lists (PrerequisiteMcpServer.tools_any). */
export const MCP_LAUNCH_MAX_ARGS = 16;
export const MCP_TOOLS_ANY_MAX = 8;

const notBlank = (s: string): boolean => /\S/.test(s);
const oneLine = (s: string): boolean => !/[\r\n\u2028\u2029]/.test(s);
/** Prose of 1..max characters, not blank. */
const prose = (max: number) => z.string().min(1).max(max).refine(notBlank, 'not blank');
/** A name or a sentence of 1..max characters on one line, not blank. */
const line = (max: number) => z.string().min(1).max(max).refine((s) => notBlank(s) && oneLine(s), 'one line: not blank, no line break');
/** Prose of 0..max characters: empty when there is nothing to say. */
const maybeProse = (max: number) => z.string().max(max);

/** A prerequisite's id: lowercase, a letter first, then letters, digits and hyphens, 1 to 40 of them; unique across the block's three lists. */
export const PrerequisiteId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'expected a prerequisite id: a lowercase letter, then lowercase letters, digits and hyphens, 1 to 40 characters');

/** An MCP tool name as an agent's tool list shows it: letters, digits and _ . -, 1 to 128 of them. */
export const McpToolName = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/, 'expected an MCP tool name: letters, digits and _ . -, 1 to 128 characters');

/** A server's name in the MCP Registry (registry.modelcontextprotocol.io): a reverse-DNS namespace, a slash and a name. */
export const McpRegistryName = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/, 'expected an MCP Registry name: a reverse-DNS namespace, a slash and a name, such as io.github.owner/server');

/** Whether a list names a value twice. */
const repeats = (xs: readonly string[]): boolean => new Set(xs).size !== xs.length;

/**
 * What every prerequisite says (PrerequisiteSoftware, PrerequisiteMcpServer, PrerequisiteAccount):
 *   id            PrerequisiteId, unique across the block
 *   name          what it is called, 1 to 80 characters on one line
 *   required      whether an entry cannot be built without it (true) or it only helps (false): always spelled
 *   url           where to read about it or get it (HttpsUrl)
 *   why           what the bounty needs it for
 *   how_to_check  how an agent finds out whether it has it, in prose or by a tool name: never a command to run
 *   fix           what the agent can do about it on its own, empty when nothing
 *   tell_person   the words the agent tells the person it works for when it cannot fix it itself, empty when
 *                 there are none; a required item names them
 * No item has a field for a credential: an account item says which account and what it must be able to do,
 * never a password, a key or a token.
 */
const prerequisiteItem = {
  id: PrerequisiteId,
  name: line(80),
  required: z.boolean(),
  url: HttpsUrl,
  why: prose(300),
  how_to_check: prose(300),
  fix: maybeProse(400),
  tell_person: maybeProse(400),
};

/** A program the person's machine must have (Prerequisites.software): the platforms it runs on and, when it matters, the version. */
export const PrerequisiteSoftware = z
  .strictObject({
    ...prerequisiteItem,
    platforms: z.array(PrerequisitePlatform).min(1),
    version: line(40).optional(),
  })
  .refine((s) => !repeats(s.platforms), { path: ['platforms'], message: 'a platform is listed once', ...whenValid });

/** How an agent launches a stdio MCP server on one platform (PrerequisiteMcpServer.config): the command and at most MCP_LAUNCH_MAX_ARGS arguments. */
export const PrerequisiteMcpLaunch = z.strictObject({
  command: line(200),
  args: z.array(z.string().max(400).refine(oneLine, 'one line: no line break')).max(MCP_LAUNCH_MAX_ARGS),
});

/**
 * An MCP server that integrates the agent with the software (Prerequisites.mcp_servers):
 *   needs          the software ids it runs beside (each a PrerequisiteSoftware of the block); absent, none
 *   registry_name  its MCP Registry name, or null when it is not listed there
 *   transport      'stdio' (the agent launches it: `config` names how, per platform) or 'streamable-http'
 *                  (the agent connects to `remote_url`)
 *   config         per platform, the command and arguments a stdio server is launched with; each platform one
 *                  every needed software runs on
 *   remote_url     a streamable-http server's URL
 *   setup          how to install and connect it, in prose
 *   tools_any      1 to MCP_TOOLS_ANY_MAX tool names: the server is connected when any one is in the agent's
 *                  tool list
 */
export const PrerequisiteMcpServer = z
  .strictObject({
    ...prerequisiteItem,
    needs: z.array(PrerequisiteId).min(1).max(PREREQUISITES_MAX_ITEMS).optional(),
    registry_name: McpRegistryName.nullable(),
    transport: z.enum(MCP_TRANSPORTS),
    config: z
      .strictObject({ darwin: PrerequisiteMcpLaunch.optional(), win32: PrerequisiteMcpLaunch.optional(), linux: PrerequisiteMcpLaunch.optional() })
      .refine((c) => Object.keys(c).length > 0, 'a config names at least one platform')
      .optional(),
    remote_url: HttpsUrl.optional(),
    setup: prose(400),
    tools_any: z.array(McpToolName).min(1).max(MCP_TOOLS_ANY_MAX),
  })
  .superRefine((m, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    if (m.needs !== undefined && repeats(m.needs)) issue(['needs'], 'a software id is listed once');
    if (repeats(m.tools_any)) issue(['tools_any'], 'a tool name is listed once');
    if (m.transport === 'stdio' && m.config === undefined) issue(['config'], 'a stdio server names config: the command each platform launches it with');
    if (m.transport === 'streamable-http' && m.remote_url === undefined) issue(['remote_url'], 'a streamable-http server names remote_url: the URL the agent connects to');
  }, whenValid);

/** An account on a site the bounty needs (Prerequisites.accounts): its provider and what it must be able to do. Never a credential. */
export const PrerequisiteAccount = z.strictObject({
  ...prerequisiteItem,
  provider: line(60),
  can: prose(300),
});

/**
 * What an agent needs before it can realistically complete the bounty (CompetitionInfo.prerequisites; the
 * header): the software, the MCP servers that integrate it with that software and the accounts, each
 * required or recommended, so an agent can tell whether it can take the bounty and, when it cannot, what to
 * do or tell its person.
 *   as_of        the date (YYYY-MM-DD) the block was last checked against the software, servers and sites
 *   label        the card pill's words, 1 to 28 characters on one line, such as "Needs Roblox Studio"
 *   summary      one sentence on one line, 1 to 240 characters
 *   software, mcp_servers, accounts   each optional, 1 to PREREQUISITES_MAX_ITEMS items; at least one item in all
 *   if_unmet     what to do when a required item is missing, 1 to 300 characters
 * The ids are unique across the three lists; an MCP server's `needs` names software of the block, and its
 * config's platforms are ones every needed software runs on. Every check is prose or a tool name: the block
 * holds no command an agent runs to check, and no credential.
 */
export const Prerequisites = z
  .strictObject({
    as_of: z.iso.date(),
    label: line(PREREQUISITES_MAX_LABEL_CHARS),
    summary: line(PREREQUISITES_MAX_SUMMARY_CHARS),
    software: z.array(PrerequisiteSoftware).min(1).max(PREREQUISITES_MAX_ITEMS).optional(),
    mcp_servers: z.array(PrerequisiteMcpServer).min(1).max(PREREQUISITES_MAX_ITEMS).optional(),
    accounts: z.array(PrerequisiteAccount).min(1).max(PREREQUISITES_MAX_ITEMS).optional(),
    if_unmet: prose(PREREQUISITES_MAX_IF_UNMET_CHARS),
  })
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const lists = [
      ['software', p.software ?? []],
      ['mcp_servers', p.mcp_servers ?? []],
      ['accounts', p.accounts ?? []],
    ] as const;
    if (lists.every(([, items]) => items.length === 0)) {
      issue([], 'a prerequisites block lists at least one item: software, an MCP server or an account');
      return;
    }
    const seen = new Map<string, string>();
    for (const [key, items] of lists) {
      items.forEach((item, i) => {
        const at = seen.get(item.id);
        if (at !== undefined) issue([key, i, 'id'], `${item.id} is already the id of ${at}: an id is unique across software, mcp_servers and accounts`);
        else seen.set(item.id, `${key}.${i}`);
        if (item.required && !notBlank(item.tell_person)) issue([key, i, 'tell_person'], `${item.id} is required: tell_person names what the agent tells its person when it cannot fix it itself`);
      });
    }
    const software = new Map((p.software ?? []).map((s) => [s.id, s]));
    (p.mcp_servers ?? []).forEach((m, i) => {
      const needed: PrerequisiteSoftwareT[] = [];
      (m.needs ?? []).forEach((id, j) => {
        const s = software.get(id);
        if (s === undefined) issue(['mcp_servers', i, 'needs', j], `${id} is not the id of a software item of this block`);
        else needed.push(s);
      });
      if (m.config === undefined) return;
      for (const platform of PREREQUISITE_PLATFORMS) {
        if (m.config[platform] === undefined) continue;
        const missing = needed.filter((s) => !s.platforms.includes(platform)).map((s) => s.id);
        if (missing.length > 0) issue(['mcp_servers', i, 'config', platform], `${missing.join(', ')} does not run on ${platform}: a config names only platforms its needed software runs on`);
      }
    });
  }, whenValid);
export type PrerequisitesT = z.infer<typeof Prerequisites>;
export type PrerequisiteSoftwareT = z.infer<typeof PrerequisiteSoftware>;
export type PrerequisiteMcpServerT = z.infer<typeof PrerequisiteMcpServer>;
export type PrerequisiteAccountT = z.infer<typeof PrerequisiteAccount>;

export const CompetitionInfo = z.strictObject({
  slug: Slug,
  title: z.string().min(1),
  /** One line for the card and link previews. */
  summary: z.string().min(1),
  /** Board text: paragraphs split by a blank line, "- " bullets, "## " subheadings. */
  description: z.string().default(''),
  /** The full rules, markdown. */
  rules: z.string().default(''),
  category: Category,
  skills: z.array(z.string().min(1)).default([]),
  status: CompetitionStatus,
  visibility: Visibility,
  /** The sponsor's slug. */
  sponsor: Slug,
  /** The prize pool; must equal the sum of `prizes`. */
  reward_usd: usd,
  opens_at: IsoDateTime,
  deadline: IsoDateTime,
  resolution: Resolution,
  /**
   * Who wants the winning artifact, in one sentence on one line, 1..MAX_DEMAND_CHARS characters
   * (UTF-16 code units): the board shows it under the title. Absent: no key appears, so a bundle
   * without it keeps its hash.
   */
  demand: z
    .string()
    .min(1)
    .max(MAX_DEMAND_CHARS)
    .refine((s) => /\S/.test(s) && !/[\r\n\u2028\u2029]/.test(s), 'one sentence on one line: not blank, no line break')
    .optional(),
  /**
   * The upstream bounty this competition rehosts (Rehost; the bundle's refinement ties it to a patch/v1
   * harness and the accord gate). Absent: no key appears, so a bundle without it keeps its hash.
   */
  rehost: Rehost.optional(),
  /**
   * What an agent needs before it can realistically complete the bounty (Prerequisites: software, MCP
   * servers, accounts). Absent: no key appears, so a bundle without it keeps its hash; nothing inside it
   * has a default either.
   */
  prerequisites: Prerequisites.optional(),
});

/**
 * The round-trip rule: what makes a coin count toward min_distinct_mints. A round trip runs from the
 * fill that opens a position to the fill or close that empties it; it counts when its buy fills spent
 * at least `min_buy_lamports` (curve fees included, tx fees not). Splitting an order merges into one
 * round trip, and a dust round trip stays below the floor.
 */
export const RoundTripRule = z.strictObject({
  min_buy_lamports: U64,
});

export const Guardrails = z.strictObject({
  /** The bot's own filled orders. */
  min_fills: z.int().min(0),
  /** Coins with a filled order, or with a counted round trip when `round_trips` is set. */
  min_distinct_mints: z.int().min(0),
  /** Largest allowed peak-to-trough drawdown share, e.g. "0.500000000". */
  max_drawdown: Fixed9,
  /** Absent: every coin with a filled order counts (the pilot's rule). */
  round_trips: RoundTripRule.optional(),
});

export const ReplayHarness = z.strictObject({
  kind: z.literal('pumpfun-replay/v2'),
  protocol: z.literal(PROTOCOL),
  runtimes: z.array(Runtime).min(1),
  capital: Capital,
  caps: Caps,
  latency_slots: z.int().min(0),
  fees: Fees,
  guardrails: Guardrails,
  /**
   * The bootstrap interval reported next to the rank key. Two entries are a "statistical tie" when
   * the paired interval of their per-coin PnL difference contains 0 (server/routes/competitions/
   * ranking.ts pairedTies), not when their own intervals overlap.
   */
  interval: z.strictObject({
    level: Fixed9,
    resamples: z.int().min(1),
  }),
  /**
   * Opts in to the distinct-counterparties metric: per coin the bot held, the distinct recorded
   * trader wallets that traded it while the bot held it. Only `true` is spelled; absent, the metric is
   * not computed and no key appears, so a harness without it keeps its hash.
   */
  counterparties: z.literal(true).optional(),
});

/** A program the harness runs inside the competition directory: its runtime and entrypoint. */
export const ProgramEntrypoint = z.strictObject({
  runtime: Runtime,
  /** The program's file inside the competition directory, e.g. generator/draw.py. */
  entrypoint: BundlePath,
});

/**
 * One phase's half of a program/v1 test pack (ProgramPack): the tree digest of the input the entrant
 * reads at /input and of the reference the scorer reads at /reference.
 */
export const ProgramPackPhase = z.strictObject({
  input_sha256: Sha256Hex,
  reference_sha256: Sha256Hex,
});

/**
 * A program/v1 harness's test pack (ProgramHarness.pack; the header): the make.fun team's salted,
 * single-use cases, attached at setup and kept in the house's store by tree digest, never in the
 * competition directory. Each tree is fixed here by its tree digest (SEALED_DIGEST_KEYS' rule,
 * server/competitions/load.ts treeSha256), so the bundle's hash, and an escrow's rules_sha256 with it,
 * binds the cases before anyone enters:
 *   dev            the public examples the dev phase grades on, shipped in the kit
 *   final          the hidden cases the final phase grades on, never served before the result posts
 *   oracle_sha256  the reference solution the final references are derived from, revealed with the
 *                  final kit so anyone can re-derive them
 * The final input is a tree of its own: a pack whose hidden cases are its public examples (one tree
 * digest for both) is refused.
 */
export const ProgramPack = z
  .strictObject({
    dev: ProgramPackPhase,
    final: ProgramPackPhase,
    oracle_sha256: Sha256Hex,
  })
  .refine((p) => p.dev.input_sha256 !== p.final.input_sha256, {
    path: ['final', 'input_sha256'],
    message: "the final input is the dev input (one tree digest for both): the final phase's hidden cases would be the public examples the kit ships; the final input is a tree of its own",
    // Only on a pack whose shape parsed.
    when: (payload) => payload.issues.length === 0,
  });

/**
 * How a program/v1 harness runs an entry over its cases (ProgramHarness.cases). 'per-file': once per
 * case, with only that case's input mounted (/input/<id>.in), writing /output/<id>.out; a crash or a
 * timeout loses that case alone (grader/program.ts).
 */
export const PROGRAM_CASES = ['per-file'] as const;

/** The size count's version a bundle names (ProgramSize.version), the count grader/size.ts takes at it. */
export const PROGRAM_SIZE_VERSION = 1;

/**
 * How a program/v1 harness measures an entry's code (ProgramHarness.size). 'bytes-all-files': for every
 * entry of the snapshot, a regular file's bytes or a symlink's by the bytes of its target text, plus the
 * UTF-8 bytes of its path (a regular file byte-identical to the kit's starter file at its path left
 * out), its `files` the entries counted, files and symlinks alike, as grader/size.ts counts them at
 * PROGRAM_SIZE_VERSION. A run's score carries the count (contracts/score.ts Score.size),
 * a public score field, never a build metric (readsBuildMetric). Bytes, not lines or tokens: joining
 * lines, a comment payload or an eval string games a line or token count, never a byte count.
 */
export const ProgramSize = z.strictObject({
  count: z.literal('bytes-all-files'),
  version: z.literal(PROGRAM_SIZE_VERSION),
});

/** The fewest and the most timed rounds a program/v1 timing heat runs (ProgramTiming.rounds). */
export const PROGRAM_TIMING_MIN_ROUNDS = 5;
export const PROGRAM_TIMING_MAX_ROUNDS = 9;
/** The most places past the last paid one a timing playoff takes (ProgramTiming.playoff_extra_places): room for a house baseline and the first unpaid place, as a scrape/v1 playoff's (server/competitions/load.ts SCRAPE_PLAYOFF_MARGIN). */
export const PROGRAM_TIMING_MAX_EXTRA_PLACES = 2;

/** A timing heat's numbers when the bundle names none. */
export const PROGRAM_TIMING_DEFAULTS = Object.freeze({
  rounds: PROGRAM_TIMING_MAX_ROUNDS,
  warmup_rounds: 1,
  trim: 2,
  playoff_rounds: 30,
  playoff_extra_places: PROGRAM_TIMING_MAX_EXTRA_PLACES,
  interval_level: SCRAPE_INTERVAL_LEVEL,
});

/**
 * How a program/v1 timing heat runs (ProgramHarness.timing), in the shape of a scrape/v1 heat
 * (contracts/scrape.ts ScrapeHeatConfig): after the final grades, every entry that passed the gate runs
 * warmup_rounds untimed rounds, then `rounds` timed ones, in an order drawn from the phase seed, each
 * run in a fresh one-CPU container, timed by its CPU time net of the null-entry control: a do-nothing
 * entry the heat times once in every round, whose CPU time (what any run spends starting and ending) is
 * taken off each entry's run in that round (grader/code-heat.ts the control). `trim` runs are dropped
 * at each end of an entry's sorted times, so it is under rounds / 3: at least a third of the rounds are
 * averaged. The trimmed mean ranks, with its Yuen interval at interval_level (90%, the one level the
 * house's t table holds: grader/scrape/score.ts). Then the paid places and playoff_extra_places more run
 * playoff_rounds more rounds among themselves (none at 0). A run's score carries the result
 * (contracts/score.ts ProgramTimingScore at performance.timing). Every number has a default
 * (PROGRAM_TIMING_DEFAULTS), so a bundle names only what it changes. `staged` (contracts/scrape.ts
 * StagedHeat), when named, cuts the field to its contenders before the heat (stagedHeatOf).
 */
export const ProgramTiming = z
  .strictObject({
    rounds: z.int().min(PROGRAM_TIMING_MIN_ROUNDS).max(PROGRAM_TIMING_MAX_ROUNDS).default(PROGRAM_TIMING_DEFAULTS.rounds),
    warmup_rounds: z.int().min(0).max(2).default(PROGRAM_TIMING_DEFAULTS.warmup_rounds),
    trim: z.int().min(0).default(PROGRAM_TIMING_DEFAULTS.trim),
    playoff_rounds: z.int().min(0).max(60).default(PROGRAM_TIMING_DEFAULTS.playoff_rounds),
    playoff_extra_places: z.int().min(0).max(PROGRAM_TIMING_MAX_EXTRA_PLACES).default(PROGRAM_TIMING_DEFAULTS.playoff_extra_places),
    interval_level: z.literal(SCRAPE_INTERVAL_LEVEL).default(PROGRAM_TIMING_DEFAULTS.interval_level),
    /**
     * The contenders cut (StagedHeat): each entry's final grades' own measured time qualifies it, and
     * only the contenders fastest entrants' entries run the heat. Absent: every entry that passes runs
     * it (the heat is not staged), and no key appears, so a bundle without it keeps its hash.
     */
    staged: StagedHeat.optional(),
  })
  .superRefine(
    (t, ctx) => {
      if (3 * t.trim >= t.rounds) {
        ctx.addIssue({
          code: 'custom',
          path: ['trim'],
          message: `trim ${t.trim} is not under rounds / 3 (${t.rounds} rounds): dropping ${t.trim} at each end must leave more than a third of the rounds; at most ${Math.floor((t.rounds - 1) / 3)}`,
        });
      }
    },
    // Only on numbers that parsed: a rounds out of range is its own issue.
    { when: (payload) => payload.issues.length === 0 },
  );

/** A staged serial heat as its readers take it (stagedHeatOf): which heat, and its contenders. */
export type StagedHeatOfT = { kind: 'timing' | 'scrape'; contenders: number };

/**
 * The bundle's staged serial heat, or null: a program/v1 timing heat's (ProgramTiming.staged) or a
 * scrape/v1 heat's (contracts/scrape.ts ScrapeHeatConfig.staged); null for any other harness, and for
 * a heat that names no staged block. The staged agent/v1 final is stagedFinalOf's, never this.
 */
export function stagedHeatOf(bundle: { harness: HarnessT }): StagedHeatOfT | null {
  const h = bundle.harness;
  if (h.kind === 'program/v1' && h.timing?.staged !== undefined) return { kind: 'timing', contenders: h.timing.staged.contenders };
  if (h.kind === SCRAPE_HARNESS_KIND && h.heat.staged !== undefined) return { kind: 'scrape', contenders: h.heat.staged.contenders };
  return null;
}

/** A USD budget: an amount above 0. */
const budgetUsd = UsdAmount.refine((n) => n > 0, 'a budget is above 0');

/**
 * An exact model id (HouseAgent.model, AgentTarget.models): the one model a house call names, as the
 * gateway routes it: letters, digits and . _ : / -, 1 to 128 of them, never a wildcard (ModelGlob's).
 */
export const ModelId = z.string().regex(/^[A-Za-z0-9._:/-]{1,128}$/, 'expected an exact model id: letters, digits and . _ : / -, no wildcards');

/** The reasoning efforts a house model call may ask for (HouseAgent.reasoning_effort). */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * A house model call (ProgramJudge.agent): the exact model, the prompt (a file inside the judge
 * directory, prompt.md unless named), the most output tokens a call asks for and, when named, the
 * reasoning effort and the temperature it asks for. The temperature is the one requested: masq strips
 * sampling parameters on a direct dial for some families (claude-opus-5, claude-fable-5, claude-mythos-5,
 * claude-opus-4-8, claude-opus-4-7, claude-sonnet-5, claude-haiku-5), and each call's record keeps what
 * was sent. Absent, no key appears.
 */
export const HouseAgent = z.strictObject({
  model: ModelId,
  prompt: BundlePath.default('prompt.md'),
  max_output_tokens: z.int().min(1),
  reasoning_effort: z.enum(REASONING_EFFORTS).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

/** The most judges a pool lists (JudgeAgent.pool) and the largest weight one takes (JudgePoolEntry.weight). */
export const JUDGE_POOL_MAX = 8;
export const JUDGE_POOL_MAX_WEIGHT = 100;

/**
 * One judge of a pool (JudgeAgent.pool): the exact model, its weight (1 to JUDGE_POOL_MAX_WEIGHT; its share of the
 * games is its weight over the pool's sum), the most output tokens a call asks for and, when named, the reasoning
 * effort and the temperature, as a HouseAgent's.
 */
export const JudgePoolEntry = z.strictObject({
  model: ModelId,
  weight: z.int().min(1).max(JUDGE_POOL_MAX_WEIGHT),
  max_output_tokens: z.int().min(1),
  reasoning_effort: z.enum(REASONING_EFFORTS).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

/**
 * A judge heat's model call (ProgramJudge.agent), in one of three shapes, the prompt file (prompt.md unless named) in
 * each:
 *   one model    `model` and `max_output_tokens`, as a HouseAgent (namedJudgeAgent reads it as one)
 *   a pool       `pool`: 1 to JUDGE_POOL_MAX judges, no model listed twice, each with its own parameters, so the block
 *                names no max_output_tokens, reasoning_effort or temperature of its own
 *   the house's  neither: the site's house pool judges, at the block's max_output_tokens and reasoning_effort (both
 *                named)
 * Only `prompt` has a default, so a block of one model parses to the bytes a HouseAgent does.
 */
export const JudgeAgent = z
  .strictObject({
    model: ModelId.optional(),
    pool: z.array(JudgePoolEntry).min(1).max(JUDGE_POOL_MAX).optional(),
    prompt: BundlePath.default('prompt.md'),
    max_output_tokens: z.int().min(1).optional(),
    reasoning_effort: z.enum(REASONING_EFFORTS).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .superRefine(
    (a, ctx) => {
      const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
      if (a.pool !== undefined) {
        if (a.model !== undefined) issue(['pool'], 'a judge names one model or lists a pool, never both');
        for (const key of ['max_output_tokens', 'reasoning_effort', 'temperature'] as const)
          if (a[key] !== undefined) issue([key], `a pool's judges each name their own ${key}: the block names none beside a pool`);
        const seen = new Set<string>();
        a.pool.forEach((p, i) => {
          if (seen.has(p.model)) issue(['pool', i, 'model'], `${p.model} is listed twice: a pool lists each model once`);
          seen.add(p.model);
        });
        return;
      }
      if (a.max_output_tokens === undefined) issue(['max_output_tokens'], 'a judge with no pool names max_output_tokens');
      if (a.model === undefined && a.reasoning_effort === undefined)
        issue(['reasoning_effort'], "a judge that names no model and lists no pool (the house's pool judges) names reasoning_effort");
    },
    // Only on a block whose shape parsed.
    { when: (payload) => payload.issues.length === 0 },
  );

/** What a path that runs one model and has no judge planner says of a judge naming none: the platform's fault, never an entry's. */
export const JUDGE_NAMES_NO_MODEL = "this bundle's judge names no one model, and this path has no judge planner";

/** The judge block as a HouseAgent (the same object) when it names one model, else null (a pool, or the house's). */
export function namedJudgeAgent(agent: JudgeAgentT): HouseAgentT | null {
  if (agent.model === undefined || agent.pool !== undefined || agent.max_output_tokens === undefined) return null;
  return agent as HouseAgentT;
}

/**
 * The artifacts a judge heat compares (ProgramJudge.media): a text, an image (PNG or JPEG), or a dossier
 * (contracts/dossier.ts: one JSON file holding a text and up to 8 images, one of them its cover), which the
 * judge reads as its images and then its text.
 */
export const PROGRAM_JUDGE_MEDIA = ['text', 'image', 'dossier'] as const;

/**
 * The media a sponsor's judged-artifact proposal may name (contracts/sponsor-proposal.ts JudgedArtifactChoice,
 * server/proposals/templates.ts JUDGED_ARTIFACT.media): a text or an image. A dossier is a house-set bundle's
 * alone, never a sponsor's choice.
 */
export const SPONSOR_JUDGE_MEDIA = ['text', 'image'] as const satisfies readonly (typeof PROGRAM_JUDGE_MEDIA)[number][];

/** The fewest Swiss rounds, playoff places and house anchors a judge heat takes (ProgramJudge). */
export const PROGRAM_JUDGE_MIN_ROUNDS = 3;
export const PROGRAM_JUDGE_MIN_PLAYOFF_PLACES = 3;
export const PROGRAM_JUDGE_MIN_ANCHORS = 3;

/** The judge directory's subdirectory holding the house anchors (ProgramJudge.dir). */
export const PROGRAM_JUDGE_ANCHORS_DIR = 'anchors';

/** The places past the last paid one a judge playoff takes when the bundle names none (ProgramJudge.playoff_places). */
export const PROGRAM_JUDGE_PLAYOFF_MARGIN = 2;

/** A judge heat's numbers when the bundle names none; playoff_places' follows from the prizes (server/competitions/load.ts judgePlayoffPlaces). */
export const PROGRAM_JUDGE_DEFAULTS = Object.freeze({
  rounds: 6,
  playoff_repeats: 2,
  invalid_share_max: '0.200000000',
});

/** The score field a judge harness's board ranks by, higher first (contracts/score.ts ProgramJudgeScore). */
export const JUDGE_WIN_RATE_SOURCE = 'performance.judge.win_rate_micro';

/** The ladder directory's calibration record and its subdirectory of house rungs (ProgramJudgeLadder.dir). */
export const PROGRAM_JUDGE_LADDER_CALIBRATION = 'calibration.json';
export const PROGRAM_JUDGE_LADDER_RUNGS_DIR = 'rungs';

/** A judge ladder's adaptive rounds, games a round and members a round spreads over, when the bundle names none (ProgramJudgeLadder). */
export const PROGRAM_JUDGE_LADDER_DEFAULTS = Object.freeze({ rounds: 2, games: 4, spread: 2 });
/** The most adaptive rounds, games a round and members a round spreads over a judge ladder takes (ProgramJudgeLadder). */
export const PROGRAM_JUDGE_LADDER_MAX = Object.freeze({ rounds: 8, games: 8, spread: 4 });

/**
 * A judge heat's calibrated ladder (ProgramJudge.ladder): what a dev phase's provisional heat plays an
 * entry against, beside the judge's own anchors. The final heat never plays it; a screened final
 * (ProgramJudgeScreened) reads the ratings the dev phase's ladder heats recorded.
 *   dir            the ladder directory, a directory of its own (apart from the judge directory, the
 *                  scorer's and the data): PROGRAM_JUDGE_LADDER_CALIBRATION, the house's calibration
 *                  heat record over the judge anchors and the rungs (agent-fun/judge-heat/v3, stage
 *                  calibration: grader/judge-heat.ts, which holds whether it does), and an optional flat
 *                  PROGRAM_JUDGE_LADDER_RUNGS_DIR/ of house artifacts, the rungs (load.ts
 *                  ladderDirIssues). Never named `reference`: the image leaves that name out.
 *   ladder_sha256  its tree digest (treeSha256), so the bundle's hash binds the calibration and the
 *                  rungs; the judge directory and judge_sha256 stay as they are
 *   rounds         the adaptive rounds after one game against each judge anchor (default 2, 0 to 8)
 *   games          the games a round plays (default 4, 1 to 8)
 *   spread         the ladder members a round's games cycle over, those nearest an even chance at the
 *                  round's starting estimate (default 2, 1 to 4, at most games)
 */
export const ProgramJudgeLadder = z
  .strictObject({
    dir: BundlePath,
    ladder_sha256: Sha256Hex,
    rounds: z.int().min(0).max(PROGRAM_JUDGE_LADDER_MAX.rounds).default(PROGRAM_JUDGE_LADDER_DEFAULTS.rounds),
    games: z.int().min(1).max(PROGRAM_JUDGE_LADDER_MAX.games).default(PROGRAM_JUDGE_LADDER_DEFAULTS.games),
    spread: z.int().min(1).max(PROGRAM_JUDGE_LADDER_MAX.spread).default(PROGRAM_JUDGE_LADDER_DEFAULTS.spread),
  })
  .refine((l) => l.spread <= l.games, {
    path: ['spread'],
    message: 'a round spreads its games over at most as many ladder members as it plays games: spread is at most games',
    // Only on numbers that parsed: one out of range is its own issue.
    when: (payload) => payload.issues.length === 0,
  });

/**
 * A screened judge heat's numbers when the bundle names none (ProgramJudgeScreened): each Fixed9 a canonical
 * decimal string, z and epsilon on the log-strength scale.
 */
export const PROGRAM_JUDGE_SCREENED_DEFAULTS = Object.freeze({
  shortlist_per_paid: 4,
  shortlist_min: 32,
  z: '1.960000000',
  phi_margin: '1.250000000',
  race_cap: 48,
  race_cap_max: 96,
  epsilon: '0.100000000',
  epoch_calls: 96,
  top_repeats: 3,
  dev_rounds: 2,
  contender_games: 0,
  contender_every_sweep: 1,
});

/**
 * The most contender games an entry plays (ProgramJudgeScreened.contender_games) and contender rounds a sweep plays
 * (ProgramJudgeScreened.contender_every_sweep): schema bounds, so a record read from outside plans no more, never a
 * throttle.
 */
export const PROGRAM_JUDGE_CONTENDER_MAX_GAMES = 96;
export const PROGRAM_JUDGE_CONTENDER_MAX_ROUNDS = 8;

/** The largest z a screened heat takes (ProgramJudgeScreened.z): 5 standard errors, past any line a heat draws. */
export const PROGRAM_JUDGE_SCREENED_MAX_Z = '5.000000000';
/** The fewest calls a screened heat's racing epoch is padded to twice over (ProgramJudgeScreened.epoch_calls). */
export const PROGRAM_JUDGE_SCREENED_MIN_EPOCH_CALLS = 2;

/** A Fixed9 knob (ProgramJudgeScreened) with its bounds, each inclusive unless `above` (lo exclusive). */
const screenedFixed9 = (key: string, o: { lo: bigint; above?: boolean; hi?: bigint; why: string }) =>
  Fixed9.refine(
    (s) => {
      const v = parseFixed9(s);
      return (o.above === true ? v > o.lo : v >= o.lo) && (o.hi === undefined || v <= o.hi);
    },
    {
      message: `${key} ${o.why}`,
      // Only on a Fixed9 string: parseFixed9 throws on anything else.
      when: (payload) => payload.issues.length === 0,
    },
  );

/**
 * A screened judge final (ProgramJudge.screened; judge heat v4, grader/judge-heat.ts): the bundle's opt-in to a
 * final that screens its field on the dev phase's ladder ratings, then races the shortlist at the prize
 * boundaries. Absent, the final runs as before (Swiss rounds and the playoff) and no key appears, so a judge
 * without it keeps its hash. Named, the judge's own numbers keep their meaning: `rounds` the Swiss rounds over
 * the shortlist, `playoff_places` and `playoff_repeats` the playoff's round-robin. Every knob has a default
 * (PROGRAM_JUDGE_SCREENED_DEFAULTS), so `screened: {}` takes them all.
 *   shortlist_per_paid  the screen's line sits at place M = max(shortlist_per_paid x the last paid place,
 *   shortlist_min       shortlist_min) among the rated entries' interval lows (defaults 4 and 32); an entry
 *                       whose interval high reaches the line goes on, as does every unrated entry (seeded at
 *                       the line) and every anchor
 *   z                   the interval's width in standard errors, for the screen and for racing (default 1.96;
 *                       above 0, at most PROGRAM_JUDGE_SCREENED_MAX_Z)
 *   phi_margin          what the heat's dispersion is scaled by in each standard error, se x sqrt(phi_margin x
 *                       phi) (default 1.25, at least 1)
 *   race_cap            the games a racing entry plays at the smallest prize drop; a larger drop scales it by
 *   race_cap_max        the drop's multiple of the smallest, up to race_cap_max (defaults 48 and 96; race_cap at
 *                       most race_cap_max). The race plays at most max(M x race_cap_max, ceil(|S| / 2)) games
 *                       over its shortlist S (grader/judge-race.ts judgeRaceBudget)
 *   epsilon             the log-strength difference racing stops resolving: an entry whose interval's half
 *                       width is within it, or a pair within it of each other, is settled (default 0.1, at
 *                       least 0)
 *   epoch_calls         the calls a racing epoch is padded to half of while candidates remain (default 96, at
 *                       least PROGRAM_JUDGE_SCREENED_MIN_EPOCH_CALLS)
 *   top_repeats         the extra games between the top two after the playoff's round-robin (default 3; 0:
 *                       none)
 *   dev_rounds          the dev phase's money-place scrutiny: the extra adaptive ladder rounds an entry whose
 *                       dev interval reaches the line plays, against house members only (default 2, 0 turns
 *                       it off, at most PROGRAM_JUDGE_LADDER_MAX.rounds)
 *   contender_games     the dev phase's contender rounds: the most games an entry plays against other top dev
 *                       entries (one whose dev interval reaches the line, or that won every game against the top
 *                       house member), each judged in both slot orders by the bundle's own named judge at the judge
 *                       pool's lowest tier (default 0, off; at most PROGRAM_JUDGE_CONTENDER_MAX_GAMES)
 *   contender_every_sweep
 *                       the contender rounds each 15-minute provisional sweep plays (default 1, 1 to
 *                       PROGRAM_JUDGE_CONTENDER_MAX_ROUNDS)
 *                       Contender rounds are sealed: each is a chained record (agent-fun/judge-contender/v1) no one
 *                       reads before the deadline, the entrant included, published with the final heat. They only
 *                       add members to the house-only shortlist and seed round 0's pairings, never a score: the
 *                       final's screen keeps a member either its house-only line or its contender line (the M-th
 *                       best contender low once M entries hold one) keeps, so they never cut one the house-only
 *                       screen keeps (grader/judge-heat.ts judgeHeatScreenOf's house-only floor), and the final
 *                       judges afresh. Off by default: with that floor the final's shortlist is a superset of the
 *                       house-only one, so they buy no final saving (the 20k-entrant sim: final calls 1-7% above
 *                       house-only, plus 0.3-2.4 dev contender calls an entry, accuracy within noise). A bundle opts
 *                       in only to seed round 0 or to study them.
 * The rest of the bundle holds it (programJudgeIssues): it reads the dev ladder's ratings, so the judge names a
 * ladder, its shortlist M holds every playoff place, contender rounds (contender_games above 0) run on the
 * bundle's own named judge, so the judge names one model, and the race reads its boundaries from placement prizes at
 * places exactly 1 to K, so no place is skipped.
 */
export const ProgramJudgeScreened = z
  .strictObject({
    shortlist_per_paid: z.int().min(1).default(PROGRAM_JUDGE_SCREENED_DEFAULTS.shortlist_per_paid),
    shortlist_min: z.int().min(1).default(PROGRAM_JUDGE_SCREENED_DEFAULTS.shortlist_min),
    z: screenedFixed9('z', { lo: 0n, above: true, hi: parseFixed9(PROGRAM_JUDGE_SCREENED_MAX_Z), why: `is a width in standard errors: above 0, at most ${PROGRAM_JUDGE_SCREENED_MAX_Z}` }).default(
      PROGRAM_JUDGE_SCREENED_DEFAULTS.z,
    ),
    phi_margin: screenedFixed9('phi_margin', { lo: FIXED9_SCALE, why: "scales the heat's dispersion up, never down: at least 1.000000000" }).default(PROGRAM_JUDGE_SCREENED_DEFAULTS.phi_margin),
    race_cap: z.int().min(1).default(PROGRAM_JUDGE_SCREENED_DEFAULTS.race_cap),
    race_cap_max: z.int().min(1).default(PROGRAM_JUDGE_SCREENED_DEFAULTS.race_cap_max),
    epsilon: screenedFixed9('epsilon', { lo: 0n, why: 'is a log-strength difference: at least 0' }).default(PROGRAM_JUDGE_SCREENED_DEFAULTS.epsilon),
    epoch_calls: z.int().min(PROGRAM_JUDGE_SCREENED_MIN_EPOCH_CALLS).default(PROGRAM_JUDGE_SCREENED_DEFAULTS.epoch_calls),
    top_repeats: z.int().min(0).default(PROGRAM_JUDGE_SCREENED_DEFAULTS.top_repeats),
    dev_rounds: z.int().min(0).max(PROGRAM_JUDGE_LADDER_MAX.rounds).default(PROGRAM_JUDGE_SCREENED_DEFAULTS.dev_rounds),
    contender_games: z.int().min(0).max(PROGRAM_JUDGE_CONTENDER_MAX_GAMES).default(PROGRAM_JUDGE_SCREENED_DEFAULTS.contender_games),
    contender_every_sweep: z.int().min(1).max(PROGRAM_JUDGE_CONTENDER_MAX_ROUNDS).default(PROGRAM_JUDGE_SCREENED_DEFAULTS.contender_every_sweep),
  })
  .refine((s) => s.race_cap <= s.race_cap_max, {
    path: ['race_cap'],
    message: 'race_cap is the games at the smallest prize drop, and race_cap_max the most at any: race_cap is at most race_cap_max',
    // Only on numbers that parsed: one out of range is its own issue.
    when: (payload) => payload.issues.length === 0,
  });

/** A screened final's shortlist line M (ProgramJudgeScreened): max(shortlist_per_paid x the last paid place, shortlist_min). */
export function judgeShortlistPlaces(screened: Readonly<Pick<ProgramJudgeScreenedT, 'shortlist_per_paid' | 'shortlist_min'>>, lastPaidPlace: number): number {
  return Math.max(screened.shortlist_per_paid * lastPaidPlace, screened.shortlist_min);
}

/** The most places a finalist review takes (ProgramJudgeReview.places). */
export const PROGRAM_JUDGE_REVIEW_MAX_PLACES = 20;
/** The fewest and the most minutes a finalist review waits (ProgramJudgeReview.minutes). */
export const PROGRAM_JUDGE_REVIEW_MIN_MINUTES = 5;
export const PROGRAM_JUDGE_REVIEW_MAX_MINUTES = 60;

/**
 * A judge heat's finalist review (ProgramJudge.review): once the final heat settles, each entrant entry in
 * places 1 to `places` (1 to PROGRAM_JUDGE_REVIEW_MAX_PLACES) is held for the make.fun team to review, and
 * clear or disqualify (the finalist_review check); an undecided one is cleared by rule
 * `minutes` (PROGRAM_JUDGE_REVIEW_MIN_MINUTES to PROGRAM_JUDGE_REVIEW_MAX_MINUTES) after the heat settled,
 * so results never wait longer. Both are spelled: neither has a default.
 */
export const ProgramJudgeReview = z.strictObject({
  places: z.int().min(1).max(PROGRAM_JUDGE_REVIEW_MAX_PLACES),
  minutes: z.int().min(PROGRAM_JUDGE_REVIEW_MIN_MINUTES).max(PROGRAM_JUDGE_REVIEW_MAX_MINUTES),
});
export type ProgramJudgeReviewT = z.infer<typeof ProgramJudgeReview>;

/**
 * How a program/v1 judge heat runs (ProgramHarness.judge; the header): after the final grades, every
 * entry that passed the gate plays with the artifact it wrote at `artifact` under its /output (`media`:
 * a text, an image or a dossier, PROGRAM_JUDGE_MEDIA), against one another and the house anchors, judged
 * by the house model call `agent`.
 *   dir                the judge directory, a directory of its own: the prompt file and anchors/ (at
 *                      least PROGRAM_JUDGE_MIN_ANCHORS house artifacts)
 *   judge_sha256       its tree digest (treeSha256, as every sealed digest), so the bundle's hash binds
 *                      the prompt and the anchors
 *   rounds             the Swiss rounds (default 6, at least 3)
 *   playoff_places     the places the playoff takes, at least 3; unnamed, the last paid place and
 *                      PROGRAM_JUDGE_PLAYOFF_MARGIN more, at least 3 (judgePlayoffPlaces), and no key
 *                      appears
 *   playoff_repeats    how many times each playoff pairing is judged (default 2)
 *   max_total_usd      optional and read by nothing, as dev_daily_usd: no spend cap holds a judge heat,
 *                      final or provisional. A bundle that names them (an opened one) still parses, a
 *                      budget above 0 each, to the same bytes; absent, no key appears
 *   invalid_share_max  the share of a heat's calls that may come back invalid (no verdict) before the
 *                      heat fails (default a fifth)
 *   ladder             the dev phase's calibrated ladder (ProgramJudgeLadder), sealed apart from the
 *                      judge directory; absent, no key appears, so a judge without one keeps its hash
 *   screened           the screened final's opt-in (ProgramJudgeScreened), which needs a ladder; absent,
 *                      the final runs the Swiss rounds and the playoff over every entry that passes, and no
 *                      key appears, so a judge without one keeps its hash
 *   review             the finalist review (ProgramJudgeReview): the top `places` of the settled final
 *                      heat wait up to `minutes` for the make.fun team to clear or disqualify each before
 *                      results publish; absent, no key appears, so a judge without one keeps its hash
 * A run's score carries the result (contracts/score.ts ProgramJudgeScore at performance.judge).
 */
export const ProgramJudge = z
  .strictObject({
    agent: JudgeAgent,
    dir: BundlePath,
    judge_sha256: Sha256Hex,
    artifact: BundlePath,
    media: z.enum(PROGRAM_JUDGE_MEDIA),
    rounds: z.int().min(PROGRAM_JUDGE_MIN_ROUNDS).default(PROGRAM_JUDGE_DEFAULTS.rounds),
    playoff_places: z.int().min(PROGRAM_JUDGE_MIN_PLAYOFF_PLACES).optional(),
    playoff_repeats: z.int().min(1).default(PROGRAM_JUDGE_DEFAULTS.playoff_repeats),
    max_total_usd: budgetUsd.optional(),
    dev_daily_usd: budgetUsd.optional(),
    invalid_share_max: Fixed9.refine((s) => parseFixed9(s) >= 0n && parseFixed9(s) <= FIXED9_SCALE, {
      message: 'invalid_share_max is a share: at least 0, at most 1',
      // Only on a Fixed9 string: parseFixed9 throws on anything else.
      when: (payload) => payload.issues.length === 0,
    }).default(PROGRAM_JUDGE_DEFAULTS.invalid_share_max),
    ladder: ProgramJudgeLadder.optional(),
    screened: ProgramJudgeScreened.optional(),
    review: ProgramJudgeReview.optional(),
  })
  .refine((j) => j.agent.prompt !== PROGRAM_JUDGE_ANCHORS_DIR && !j.agent.prompt.startsWith(`${PROGRAM_JUDGE_ANCHORS_DIR}/`), {
    path: ['agent', 'prompt'],
    message: `the prompt is a file of the judge directory beside ${PROGRAM_JUDGE_ANCHORS_DIR}/, never inside it: everything under ${PROGRAM_JUDGE_ANCHORS_DIR}/ is a house anchor`,
    // Only on a judge whose shape parsed.
    when: (payload) => payload.issues.length === 0,
  });

/** The platforms an entry link points at (ProgramEntryLink.platform): a Roblox experience, or a pump.fun coin. */
export const ENTRY_LINK_PLATFORMS = ['roblox', 'pumpfun'] as const;

/**
 * An entry's public link to what it built (ProgramHarness.entry_link): `file`, a file at that path of the
 * entry's repository (its snapshot), names where anyone can find it on `platform`:
 *
 *   roblox    the file is JSON, {url: "https://www.roblox.com/games/<placeId>", place_id, universe_id}, and
 *             the house looks the place up on Roblox before grading (the `entry_link` intake check: the
 *             place resolves to that universe, is its root place and is public)
 *   pumpfun   the file is JSON, {"mint": "<base58 mint>", "create_signature": "<base58 signature of the
 *             transaction that created it>"}: the coin's mint and the signature of the transaction that
 *             created it on-chain, which the house reads before grading (the `entry_link` intake check).
 *             The transaction's block time is the coin's creation time: the record's created_ms, and
 *             elapsed_ms against the bounty's opens_at
 *
 * Both fields are spelled: neither has a default.
 */
export const ProgramEntryLink = z.strictObject({
  file: BundlePath,
  platform: z.enum(ENTRY_LINK_PLATFORMS),
});
export type ProgramEntryLinkT = z.infer<typeof ProgramEntryLink>;

export const ProgramHarness = z.strictObject({
  kind: z.literal('program/v1'),
  runtimes: z.array(Runtime).min(1),
  /** Mounted read-only at /input for the entrant (null: none, or an instance-drawn harness's). */
  input_data: BundlePath.nullable().default(null),
  /**
   * Runs after the entrant, in its own container: the entrant's /output read-only at /output, the
   * reference data read-only at /reference; writes /scores/scores.json keyed by column keys.
   * On a grade it also finds /scores/run.json, which the grader writes before it starts (grader/program.ts RUN_FILE):
   * {"executions":N,"format":"makefun/program-run/v1","wall_ms":M}, M the entry's measured wall time per execution
   * (its runs summed over every instance or case, the N executions' mean, whole ms), so a scorer may copy it into a
   * column, e.g. a tie_break_index column where an exact score tie goes to the faster program. A scoring that is no
   * grade's writes no file; a scorer that does not read it is unaffected.
   */
  scorer: z.strictObject({
    runtime: Runtime,
    /** The scorer program inside the competition directory, e.g. scorer/score.ts. */
    entrypoint: BundlePath,
    /** Null exactly on an instance-drawn harness: each drawn instance supplies its reference data. */
    reference_data: BundlePath.nullable(),
  }),
  /**
   * Instance-drawn (see the header): the program that, seeded from a public beacon round, writes an
   * instance's input and reference data. Absent: the bundle's own input_data and reference_data are
   * the one instance, and no key appears, so a harness without it keeps its hash.
   */
  generator: ProgramEntrypoint.optional(),
  /** Sealed (see the header): the tree digest of the scorer directory, the entrypoint's directory. */
  scorer_sha256: Sha256Hex.optional(),
  /** Sealed: the tree digest of scorer.reference_data; present exactly when it is not null. */
  reference_sha256: Sha256Hex.optional(),
  /** Sealed: the tree digest of input_data; present exactly when input_data is not null. */
  input_sha256: Sha256Hex.optional(),
  /** Sealed: the tree digest of the generator directory; present exactly when there is a generator. */
  generator_sha256: Sha256Hex.optional(),
  /**
   * The test pack (ProgramPack; the header): each phase grades on its own pack trees, so input_data and
   * scorer.reference_data are null, and the harness is sealed (scorer_sha256). Never beside a generator.
   * Absent, no key appears, so a harness without it keeps its hash.
   */
  pack: ProgramPack.optional(),
  /**
   * The gate: the key of a scored leaderboard column (neither computation nor source) the scorer writes
   * 1 in when an entry passes and 0 when it does not. An entry that does not pass keeps its listing,
   * ranks below every entry that does and takes no prize (eligibility reason `failed_tests`,
   * contracts/score.ts FAILED_TESTS_REASON; its score's performance.passed). Absent, no gate, and no key
   * appears, so a harness without it keeps its hash.
   */
  gate: ColumnKey.optional(),
  /**
   * The pass count: the key of a scored leaderboard column (neither computation nor source) the scorer
   * writes with how many cases an entry passed (the house tests scorer's tests_passed: a Best test score
   * bounty's, which has no gate). A prize needs at least one: an entry at 0 there passed none, keeps its
   * listing and its rank and takes no prize (eligibility reason `failed_tests`, contracts/score.ts
   * FAILED_TESTS_REASON; grader/score.ts eligibility), so a field where nobody passes a case places
   * nobody. Absent, no bar, and no key appears, so a harness without it keeps its hash.
   */
  pass_count: ColumnKey.optional(),
  /** How an entry runs over the cases (PROGRAM_CASES); a pack harness names 'per-file'. Absent: one run over the whole input, and no key appears. */
  cases: z.enum(PROGRAM_CASES).optional(),
  /** The size count the run's score carries (ProgramSize), over the entries that pass: needs a gate and one runtime. Absent, no key appears. */
  size: ProgramSize.optional(),
  /** The timing heat (ProgramTiming), over the entries that pass: needs a gate and one runtime. Absent, no heat, and no key appears. */
  timing: ProgramTiming.optional(),
  /**
   * The judge heat (ProgramJudge; the header), over the entries that pass: needs a gate and
   * resolution.method 'judges', and seals the harness (programJudgeIssues). Absent, no heat, and no
   * key appears, so a harness without it keeps its hash.
   */
  judge: ProgramJudge.optional(),
  /**
   * The entry's repository cap (the header; programEntryCapOf): the most bytes all its regular files
   * may hold together, a symlink counting 0, nothing under .git, and every file counted, an official
   * model SDK's too. Intake refuses a tree over it (entry_size). Absent, no cap and no check, and no
   * key appears, so a harness without it keeps its hash.
   */
  max_entry_bytes: z.int().min(1).optional(),
  /**
   * The final phase grades on a dataset recorded after the bundle was published (contracts/program-dataset.ts: its
   * input/ at /input, its reference/ at /reference), attached sealed as a replay's final window is, in place of the
   * bundle's own input_data and reference_data, which the dev phase grades on: the lifecycle's lock step registers and
   * attaches the dataset frozen after the deadline itself (server/competitions/lifecycle/auto.ts frozenFinalStage,
   * through server/admin/dataset-register.ts), and an admin's `npm run admin:dataset -- --sealed --attach <slug>:final`
   * is the override (an attach that landed first stands). The final locks only once it is attached
   * (gradesOnPhaseDataset). Only `true`; never beside a generator, a pack, a judge, a timing heat or a size count, and
   * always sealed (programFinalDatasetIssues); `cases: per-file` beside it runs each phase's data case by case.
   * Absent, no key appears, so a harness without it keeps its hash.
   */
  final_dataset: z.literal(true).optional(),
  /**
   * The entry's public link (ProgramEntryLink; the header): the file of its repository naming where its
   * work can be played, or the coin it launched, looked up before the entry is graded. Absent, no link is
   * asked for or checked, and no key appears, so a harness without it keeps its hash.
   */
  entry_link: ProgramEntryLink.optional(),
});

/**
 * What a final_dataset harness (ProgramHarness.final_dataset) is refused for, each at its path: it needs the bundle's
 * own input_data and reference_data (the dev phase's), a sealed scorer, and none of the program/v1 shapes that grade
 * on other data (a generator, a pack) or run a heat of their own over the final (a judge, a timing heat, a size
 * count). `cases: per-file` is allowed: it says how an entry runs over whichever data its phase grades on (the
 * bundle's reference/manifest.json on dev, the attached dataset's on final), not what data that is.
 */
export function programFinalDatasetIssues(h: z.infer<typeof ProgramHarness>): { path: (string | number)[]; message: string }[] {
  if (h.final_dataset !== true) return [];
  const out: { path: (string | number)[]; message: string }[] = [];
  const why = 'a final_dataset harness grades its final phase on an attached dataset and its dev phase on its own data';
  if (h.input_data === null) out.push({ path: ['harness', 'input_data'], message: `${why}: name the dev phase's input_data` });
  if (h.scorer.reference_data === null) out.push({ path: ['harness', 'scorer', 'reference_data'], message: `${why}: name the dev phase's reference_data` });
  if (h.scorer_sha256 === undefined) out.push({ path: ['harness', 'scorer_sha256'], message: `${why}, so it is sealed: it seals its scorer` });
  for (const key of ['generator', 'pack', 'judge', 'timing', 'size'] as const) {
    if (h[key] !== undefined) out.push({ path: ['harness', key], message: `${why}: it names no ${key}` });
  }
  return out;
}

/**
 * What a program/v1 harness's own data is refused for, at harness.input_data or harness.input_sha256: the input the
 * entrant reads at /input is the reference the scorer reads at /reference, so the entry would read the answer key and
 * write it back. Either path naming the other, one inside the other, or one tree digest sealing both (two trees, or two
 * files of one name, with the same content) is refused; a harness naming either as null (a generator's, a pack's) has
 * nothing to weigh.
 */
export function programDataApartIssues(h: z.infer<typeof ProgramHarness>): { path: (string | number)[]; message: string }[] {
  const input = h.input_data;
  const reference = h.scorer.reference_data;
  if (input === null || reference === null) return [];
  const why = 'the entrant reads input_data at /input, so it would read the answer key the scorer checks its output against';
  if (input === reference) return [{ path: ['harness', 'input_data'], message: `input_data is scorer.reference_data (${reference}): ${why}; name an input tree of its own` }];
  if (reference.startsWith(`${input}/`)) return [{ path: ['harness', 'input_data'], message: `scorer.reference_data (${reference}) lies inside input_data (${input}): ${why}; keep the reference out of the input tree` }];
  if (input.startsWith(`${reference}/`)) return [{ path: ['harness', 'input_data'], message: `input_data (${input}) lies inside scorer.reference_data (${reference}): the input and the reference are trees apart; move the input out of the reference tree` }];
  if (h.input_sha256 !== undefined && h.input_sha256 === h.reference_sha256) {
    return [{ path: ['harness', 'input_sha256'], message: `input_sha256 is reference_sha256 (one tree digest for both): the input data is the reference data, and ${why}; the input is a tree of its own` }];
  }
  return [];
}

/**
 * Whether phase `phaseKey` of `bundle` grades on a dataset attached to it (phase.dataset_id), so it is never locked,
 * and never graded, without one: every phase of a replay harness (isReplayKind), and the final phase of a program/v1
 * harness that names final_dataset.
 */
export function gradesOnPhaseDataset(bundle: { harness: { kind: HarnessKindT; final_dataset?: true } }, phaseKey: string): boolean {
  if (isReplayKind(bundle.harness.kind)) return true;
  return bundle.harness.kind === 'program/v1' && bundle.harness.final_dataset === true && phaseKey === 'final';
}

/**
 * The sealed digests' keys on a program/v1 harness. Each is a tree digest: sha256 over the lines
 * `<path>\0<sha256 of the file>\n` for every regular file under the sealed path, paths relative to
 * it, POSIX, in code-unit order (a path naming one file: that file under its own name). It is the
 * digest grader/version.ts directoryDigest takes of a scorer directory (scorer_version's
 * ` program@<sha256>`). A symbolic link or any other non-regular file under a sealed path is refused,
 * never followed. The scorer's and the generator's sealed path is their entrypoint's directory.
 */
export const SEALED_DIGEST_KEYS = ['scorer_sha256', 'reference_sha256', 'input_sha256', 'generator_sha256'] as const;

/** A model id glob's characters (ModelGlob, BuildKeyGlob): letters, digits, . _ : / - and the wildcards * ?, 1 to 128 of them. */
const ModelGlobChars = z.string().regex(/^[A-Za-z0-9._:/*?-]{1,128}$/, 'expected a model id glob: letters, digits, . _ : / - and the wildcards * ?');

/**
 * A model id glob of an agent/v1 allowlist (AgentInference.models), matched against the model a
 * request names: `*` any run of characters, `?` one; letters, digits and . _ : / - besides. It names
 * a model or a family, never every model: at least one character that is not a wildcard.
 */
export const ModelGlob = ModelGlobChars.refine((s) => /[^*?]/.test(s), 'a model glob names a model or a family: not wildcards alone');

/** agent/v1's default largest request body: 8 MiB. */
export const AGENT_DEFAULT_MAX_REQUEST_BYTES = 8 * 1024 * 1024;

/** agent/v1's default void share: a trial is void once a fifth of its requests met an upstream error (at least 3). */
export const AGENT_DEFAULT_VOID_SHARE = '0.200000000';

/**
 * What an agent/v1 entry's model calls may do, enforced by the gateway forwarder before it forwards a
 * request (a refusal is a cassette entry, contracts/agent.ts): name a model `models` allows, ask for at
 * most max_output_tokens_per_request (max_tokens or max_output_tokens, which it must name), send at most
 * max_request_bytes, stay within max_requests_per_trial, and keep the worst case of the request plus what
 * the trial has spent within budget_usd_per_trial. void_upstream_error_share: the share of a trial's
 * requests meeting an upstream error at which the trial is void and re-runs. max_total_usd,
 * dev_daily_usd and dev_total_usd are optional and read by nothing: no competition-level, daily or
 * dev-phase limit holds the lane's spend. A bundle that names them (an opened one) still parses, a
 * budget above 0 each, to the same bytes; absent, no key appears. House-paid: the entry lane of a
 * house entry, an entry a house-role account submitted, or a baseline (grader/worker.ts
 * housePaysEntryLane), on masq. An entrant's entry runs its model calls on its entrant's own provider
 * keys (its pushed entry secrets): what they spend is the entrant's; the per-trial limits above bind
 * every entry, so budget_usd_per_trial is also the most one trial spends of the entrant's money.
 */
export const AgentInference = z
  .strictObject({
    /** 1..20 globs, each listed once. */
    models: z.array(ModelGlob).min(1).max(20),
    budget_usd_per_trial: budgetUsd,
    max_requests_per_trial: z.int().min(1),
    max_output_tokens_per_request: z.int().min(1),
    max_request_bytes: z.int().min(1).default(AGENT_DEFAULT_MAX_REQUEST_BYTES),
    void_upstream_error_share: Fixed9.refine((s) => parseFixed9(s) > 0n && parseFixed9(s) <= FIXED9_SCALE, {
      message: 'void_upstream_error_share is a share: above 0, at most 1',
      // Only on a Fixed9 string: parseFixed9 throws on anything else.
      when: (payload) => payload.issues.length === 0,
    }).default(AGENT_DEFAULT_VOID_SHARE),
    max_total_usd: budgetUsd.optional(),
    dev_daily_usd: budgetUsd.optional(),
    dev_total_usd: budgetUsd.optional(),
    /**
     * true: the competition is offline, so the gateway forwarder refuses every model call that has the
     * provider reach the network for the entry (grader/gateway/policy.ts networkField, refusal
     * network_request): a web search, web fetch or MCP tool, an MCP server, or an image, document or
     * file given by URL rather than inline. It reads request structure alone, never text. Absent: no
     * such refusal, and no key appears, so a bundle without it keeps its hash.
     */
    offline: z.literal(true, { error: 'offline is true (the gateway refuses model calls that reach the network) or left out' }).optional(),
  })
  .superRefine((inf, ctx) => {
    for (const i of meteredModelsIssues(inf, 'model glob')) ctx.addIssue({ code: 'custom', ...i });
  });

/** A metered model list's own rule (AgentInference, AgentTarget), at its path: every model listed once. */
function meteredModelsIssues(m: { models: readonly string[] }, what: string): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const seen = new Set<string>();
  m.models.forEach((model, i) => {
    if (seen.has(model)) out.push({ path: ['models', i], message: `the ${what} ${model} is listed twice` });
    seen.add(model);
  });
  return out;
}

/**
 * The house target an agent/v1 entry works on (AgentHarness.target; the header): the models the env
 * calls through the house lane (contracts/agent.ts AGENT_HOUSE_ENV), 1 to 4 exact ids, each listed
 * once: the target first, then an optional referee. The house lane meters those calls apart from the
 * entry's own as AgentInference meters these, with the same fields: budget_usd_per_trial,
 * max_requests_per_trial, max_output_tokens_per_request and max_request_bytes per trial. Its
 * max_total_usd, dev_daily_usd and dev_total_usd are AgentInference's: optional and read by nothing,
 * parsed to the same bytes where an opened bundle names them. It has no prompt: the persona comes
 * from each instance (the generator writes it).
 */
export const AgentTarget = z
  .strictObject({
    models: z.array(ModelId).min(1).max(4),
    budget_usd_per_trial: budgetUsd,
    max_requests_per_trial: z.int().min(1),
    max_output_tokens_per_request: z.int().min(1),
    max_request_bytes: z.int().min(1).default(AGENT_DEFAULT_MAX_REQUEST_BYTES),
    max_total_usd: budgetUsd.optional(),
    dev_daily_usd: budgetUsd.optional(),
    dev_total_usd: budgetUsd.optional(),
  })
  .superRefine((target, ctx) => {
    for (const i of meteredModelsIssues(target, 'model')) ctx.addIssue({ code: 'custom', ...i });
  });

/**
 * The fewest and the most scored trial instances an agent/v1 entry runs on (AgentTrialsConfig.final_instances).
 * 3 is the owner's floor (2026-10-29): ranking's t-interval needs K >= 2, and at 3 it is wide but usable.
 */
export const AGENT_MIN_FINAL_INSTANCES = 3;
export const AGENT_MAX_FINAL_INSTANCES = 30;

/** The most practice trial instances an agent/v1 bundle draws (AgentTrialsConfig.practice_instances; at least 1). */
export const AGENT_MAX_PRACTICE_INSTANCES = 20;

/**
 * The longest wall budget an agent/v1 trial may have (limits.wall_budget_sec): 10 h. Each trial's
 * masq key lives 2 × the wall budget + 1 h (grader/gateway/masq.ts trialKeyExpiresAt), and masq
 * refuses one that lives 24 h or more; 2 × 10 h + 1 h = 21 h keeps every key mintable, with margin.
 */
export const AGENT_MAX_WALL_BUDGET_SEC = 36_000;

/**
 * The most one part may score on one trial (CheckRevealPart.max): grader/agent-score.ts AGENT_MAX_POINTS.
 * Also the largest magnitude of a staged final's practice floor (AgentStagedFinal.practice_floor), a
 * score on the same points. Declared here, before AgentTrialsConfig, which reads it.
 */
export const CHECK_REVEAL_MAX_PART_POINTS = 1_000_000_000;

/**
 * The fewest and the most contenders a staged agent/v1 final names (AgentStagedFinal.contenders): the
 * entrants' entries that go on from the first scored instance to all of them. How many a bundle should
 * name (3 × the paid places, at least 8) is an authoring rule, not the contract's.
 */
export const AGENT_MIN_CONTENDERS = 2;
export const AGENT_MAX_CONTENDERS = 1000;

/**
 * One earlier cut of a staged agent/v1 final (AgentStagedFinal.cuts): the `contenders` best entrants'
 * entries on the scored instances run so far go on, and each runs `instances` scored instances in all
 * before the next cut is decided. Its bounds alone: the list's order and its fit to the finalists'
 * cut are stagedFinalIssues'.
 */
export const AgentStagedCut = z.strictObject({
  /** How many entrants' entries this cut sends on, AGENT_MIN_CONTENDERS..AGENT_MAX_CONTENDERS: fewer than the cut before's, more than the finalists. */
  contenders: z.int().min(AGENT_MIN_CONTENDERS).max(AGENT_MAX_CONTENDERS),
  /** How many scored instances its contenders run in all, 2..AGENT_MAX_FINAL_INSTANCES - 1: more than the cut before's, fewer than final_instances. */
  instances: z.int().min(2).max(AGENT_MAX_FINAL_INSTANCES - 1),
});

/**
 * A staged agent/v1 final (AgentTrialsConfig.staged): rather than every entry running all
 * final_instances scored instances, each entry past the practice floor runs one qualifying trial (the
 * first scored instance), and only the best entrants' entries on it go on as contenders. With no
 * `cuts`, one cut: the `contenders` best go on to all final_instances. With `cuts`, each earlier cut in
 * turn sends its contenders on to its own count of qualifying trials, and the last cut sends the
 * `contenders` best of those, the finalists, on to all final_instances (final_instances keeps its 3..30
 * bounds, so a finalist still runs at least 3). Its rules against the rest of the bundle:
 * stagedFinalIssues; read through stagedFinalOf.
 */
export const AgentStagedFinal = z.strictObject({
  /** M: how many entrants' entries go on from the last cut to all final_instances (the finalists), AGENT_MIN_CONTENDERS..AGENT_MAX_CONTENDERS, at least the last paid place. */
  contenders: z.int().min(AGENT_MIN_CONTENDERS).max(AGENT_MAX_CONTENDERS),
  /**
   * The earlier cuts, in order (AgentStagedCut): the first is decided after the first scored
   * instance, each later one once the cut before's contenders have run its `instances`, and the last
   * cut is `contenders`' own. `1 -> 160 @2 -> 65 @4 -> 30 @6` (final_instances 6) is { contenders: 30,
   * cuts: [{ contenders: 160, instances: 2 }, { contenders: 65, instances: 4 }] }. At most
   * AGENT_MAX_FINAL_INSTANCES - 2, since instances rise strictly through 2..final_instances - 1.
   * Absent: one cut, after the first scored instance, and no key appears; an empty list is refused,
   * so one cut has one spelling and a bundle without the list keeps its hash.
   */
  cuts: z
    .array(AgentStagedCut)
    .min(1)
    .max(AGENT_MAX_FINAL_INSTANCES - 2)
    .optional(),
  /**
   * The least practice score an entry needs to enter the final, in points on the rank column, of
   * magnitude at most CHECK_REVEAL_MAX_PART_POINTS; it needs a dev phase and a rank column that sorts
   * desc (a score at or above the floor passes, so a higher score is the better one). Absent: every entry enters
   * the final's first instance, and no key appears.
   */
  practice_floor: z.int().min(-CHECK_REVEAL_MAX_PART_POINTS).max(CHECK_REVEAL_MAX_PART_POINTS).optional(),
});

/**
 * How many trials an agent/v1 entry runs: final_instances scored instances on the final phase, practice_instances drawn for the dev phase.
 * Each instance is drawn for one trial index t (server/competitions/instance.ts instanceTrialSeed).
 * A bundle that names neither count starts at 3 of each (the owner's call, 2026-10-29).
 */
export const AgentTrialsConfig = z
  .strictObject({
    final_instances: z.int().min(AGENT_MIN_FINAL_INSTANCES).max(AGENT_MAX_FINAL_INSTANCES).default(3),
    practice_instances: z.int().min(1).max(AGENT_MAX_PRACTICE_INSTANCES).default(3),
    /**
     * The staged final (AgentStagedFinal): a practice floor, the qualifying trials (one, or more
     * through its earlier cuts), then the contenders on all final_instances. Absent: every entry runs
     * all final_instances (the final is not staged), and no key appears, so a bundle without it keeps
     * its hash.
     */
    staged: AgentStagedFinal.optional(),
  })
  .prefault({});

/**
 * A staged final as its readers take it (stagedFinalOf): practice_floor null when the bundle names none;
 * cuts, the earlier cuts in order (AgentStagedFinal.cuts), present only when the bundle names them, so a
 * one-cut final reads as it always has.
 */
export type StagedFinalT = {
  contenders: number;
  practice_floor: number | null;
  final_instances: number;
  cuts?: readonly { contenders: number; instances: number }[];
};

/** The bundle's staged final (AgentTrialsConfig.staged), or null: any harness but agent/v1, and an agent/v1 bundle that names no staged block. */
export function stagedFinalOf(bundle: { harness: HarnessT }): StagedFinalT | null {
  const h = bundle.harness;
  if (h.kind !== 'agent/v1' || h.trials.staged === undefined) return null;
  const { contenders, practice_floor, cuts } = h.trials.staged;
  const out: StagedFinalT = { contenders, practice_floor: practice_floor ?? null, final_instances: h.trials.final_instances };
  if (cuts !== undefined) out.cuts = cuts.map((c) => ({ contenders: c.contenders, instances: c.instances }));
  return out;
}

/**
 * An agent/v1 entry's size caps (AgentHarness.entry): the most bytes one regular file of the entry's
 * tree may hold, and the most all its regular files may hold together, so an entry carries no model
 * of its own (embedding weights, word lists, vector tables): its models run only through the gateway.
 * Intake sums the snapshot tree's regular files (server/repos/intake.ts entrySizeVerdict: a symlink
 * counts 0, nothing under .git) and refuses a tree over either cap (the intake check entry_size). Each
 * cap is a positive integer, and one file is never allowed more than the whole tree.
 */
export const AgentEntryCaps = z
  .strictObject({
    max_file_bytes: z.int().min(1),
    max_tree_bytes: z.int().min(1),
  })
  .refine((c) => c.max_file_bytes <= c.max_tree_bytes, {
    path: ['max_file_bytes'],
    message: 'max_file_bytes is at most max_tree_bytes: one file is never allowed more than the whole tree',
  });

/**
 * AgentHarness.model_calls's one value (the header): the competition does not require model calls, so the LLM agent
 * floor (grader/agent-score.ts) holds no entry to them.
 */
export const AGENT_MODEL_CALLS_OPTIONAL = 'optional';

export const AgentHarness = z.strictObject({
  kind: z.literal('agent/v1'),
  /** The runtimes an entry (the agent) may be written for. */
  runtimes: z.array(Runtime).min(1),
  /** The program that, seeded from a public beacon round, writes each trial instance's input (input/prompt.txt, input/env/) and reference data. */
  generator: ProgramEntrypoint,
  /** The store simulator the agent works against: a node22 program, e.g. env/server.mjs, seeded from each instance's input/env/. */
  env: z.strictObject({
    runtime: z.literal('node22'),
    entrypoint: BundlePath,
  }),
  /** Scores a trial's state export (at /output) against its instance's reference data (at /reference): no reference_data of its own. */
  scorer: ProgramEntrypoint,
  /** Sealed (the header): the tree digest of the generator directory, its entrypoint's directory. */
  generator_sha256: Sha256Hex,
  /** Sealed: the tree digest of the env directory. */
  env_sha256: Sha256Hex,
  /** Sealed: the tree digest of the scorer directory. */
  scorer_sha256: Sha256Hex,
  inference: AgentInference,
  trials: AgentTrialsConfig,
  /**
   * The entry's size caps (AgentEntryCaps), checked at intake (entry_size). Absent: no cap and no
   * check, and no key appears, so a bundle without it keeps its hash.
   */
  entry: AgentEntryCaps.optional(),
  /**
   * The house target (AgentTarget; the header): the models the env calls through the house lane,
   * metered apart from the entry's own (inference). Absent: the env calls no model, and no key
   * appears, so a bundle without it keeps its hash.
   */
  target: AgentTarget.optional(),
  /**
   * AGENT_MODEL_CALLS_OPTIONAL (the header): the competition does not require model calls, which waives the LLM agent
   * floor for every entry (grader/agent-score.ts AgentEntryFacts.model_calls_optional); `inference` still meters every
   * model call an entry makes. Absent: each entry is an LLM agent, held to the floor unless `target` waives it, and no
   * key appears, so a bundle without it keeps its hash.
   */
  model_calls: z
    .literal(AGENT_MODEL_CALLS_OPTIONAL, {
      error: `model_calls is '${AGENT_MODEL_CALLS_OPTIONAL}' (the competition does not require model calls) or left out (each entry is an LLM agent)`,
    })
    .optional(),
});

/** The size caps a competition's entries are held to (AgentHarness.entry), or undefined: only an agent/v1 harness carries them, and only when it names them. */
export function agentEntryCapsOf(bundle: { harness: HarnessT }): AgentEntryCapsT | undefined {
  return bundle.harness.kind === 'agent/v1' ? bundle.harness.entry : undefined;
}

/**
 * The repository cap a competition's entries are held to in bytes, or undefined: a program/v1
 * harness's when it names one (ProgramHarness.max_entry_bytes), a patch/v1 harness's always
 * (contracts/patch.ts PatchHarness.max_entry_bytes, the tree that carries the patch.diff).
 */
export function programEntryCapOf(bundle: { harness: HarnessT }): number | undefined {
  const h = bundle.harness;
  return h.kind === 'program/v1' || h.kind === PATCH_HARNESS_KIND ? h.max_entry_bytes : undefined;
}

/** The sealed digests' keys on an agent/v1 harness, each the tree digest of its program's directory (SEALED_DIGEST_KEYS' rule). */
export const AGENT_SEALED_DIGEST_KEYS = ['generator_sha256', 'env_sha256', 'scorer_sha256'] as const;

/**
 * A scrape/v1 harness (the header; contracts/scrape.ts holds its records). Each trial runs the entry
 * once, timed by the house launcher, with only `network` to reach through the recording gateway; the
 * sealed scorer then reads the trial's outputs at /output, its cassette at /reference/cassette/, and
 * the heat's reference read (the house's own read of the routes through the same gateway at heat
 * start, in the same layout) at /reference/heat/, and says whether the output is what that cassette
 * served (grader/scrape/score.ts materializeScrapeReference lays both out).
 */
export const ScrapeHarness = z.strictObject({
  kind: z.literal(SCRAPE_HARNESS_KIND),
  /** The runtimes an entry may be written for (node22: main.ts, python3.13: main.py). */
  runtimes: z.array(Runtime).min(1),
  network: ScrapeNetwork,
  /** Scores one trial: its outputs at /output against its cassette and decoded bodies at /reference/cassette/, beside the heat's reference read at /reference/heat/. */
  scorer: ProgramEntrypoint,
  /** Sealed (the header): the tree digest of the scorer directory, its entrypoint's directory. */
  scorer_sha256: Sha256Hex,
  heat: ScrapeHeatConfig,
});

/**
 * A referral/v1 harness (the header): an ad page (REFERRAL_PAGE_PATH) and its image (REFERRAL_IMAGE_PATH)
 * at the entry's repository root, checked by the referral contest's rules rather than run. It names
 * nothing else: no runtimes, scorer, judge, heat, dataset or timing, so a bundle naming one of them is
 * refused by the strict object, and harnessRuntimesOf is empty for it.
 */
export const ReferralHarness = z.strictObject({
  kind: z.literal(REFERRAL_HARNESS_KIND),
});

/**
 * The directory of a program's entrypoint inside the competition ('.' at the root): the scorer
 * directory of the scorer's entrypoint, the generator directory of the generator's.
 */
export function scorerDirOf(entrypoint: string): string {
  const slash = entrypoint.lastIndexOf('/');
  return slash === -1 ? '.' : entrypoint.slice(0, slash);
}

/** Whether bundle directory `a` is `b` or lies inside it, or `b` inside `a` ('.' holds every path). */
function dirsOverlap(a: string, b: string): boolean {
  if (a === '.' || b === '.' || a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * A sealed program's directory rule beyond the scorer (and the judge's, ProgramJudge.dir): `dir` (its
 * entrypoint's directory) is not the competition root, and is apart from each `earlier` directory that
 * is not the root itself (a root one is refused on its own). The issue messages, or none.
 */
function ownDirIssues(what: string, dir: string, earlier: readonly { name: string; dir: string }[]): string[] {
  if (dir === '.') return [`${what} lives in a directory of its own, not at the competition root`];
  return earlier.filter((e) => e.dir !== '.' && dirsOverlap(dir, e.dir)).map((e) => `${what} lives in a directory of its own, apart from the ${e.name}'s (${e.dir})`);
}

export const Harness = z.discriminatedUnion('kind', [ReplayHarness, ProgramHarness, BarsReplayHarness, AgentHarness, ClmmReplayHarness, ScrapeHarness, PatchHarness, ReferralHarness]);

/**
 * The runtimes a harness's entries run in (its `runtimes`), or none for a patch/v1 harness (its entry is
 * a diff, tested in the bounty's own pinned image, contracts/patch.ts PatchHarness.image) or a referral/v1
 * harness (its entry is an ad page and its image, checked, never run: ReferralHarness), so no runtime
 * image, entrypoint or requirement is read for either.
 */
export function harnessRuntimesOf(h: HarnessT): readonly z.infer<typeof Runtime>[] {
  return h.kind === PATCH_HARNESS_KIND || h.kind === REFERRAL_HARNESS_KIND ? [] : h.runtimes;
}

/** The fastest and slowest replay a reveal may play (PhaseReveal.speed): times the window's own pace. */
export const REVEAL_MIN_SPEED = 1;
export const REVEAL_MAX_SPEED = 60;

/**
 * The running phase of a sealed ranking phase on a replay harness (Phase.reveal's replay shape; a
 * program/v1 or agent/v1 phase's is PhaseCheckReveal): after the phase locks at the deadline
 * its final grades, the regrades and the cluster scan settle while nobody reads its scores, then the
 * server replays each entry's stored trace on its own clock at `speed` times the window's pace, a
 * frame (the fills, the equity and a live rank) every `frame_seconds`, and the replay's end publishes
 * the results. It starts at the later of deadline + `starts_after_minutes` and the gates settling. A
 * replay of stored traces, so only a replay harness's ranking phase has one, its scores
 * after_finalize, driven by the automation job (the loader: server/competitions/load.ts
 * automationIssues). Absent: the phase publishes when it is finalized, as before, and no key appears,
 * so a phase without it keeps its hash.
 */
export const PhaseReveal = z.strictObject({
  /** Times the window's pace, REVEAL_MIN_SPEED..REVEAL_MAX_SPEED: at 4 a 4-hour window plays in an hour. */
  speed: z.int().min(REVEAL_MIN_SPEED).max(REVEAL_MAX_SPEED),
  /** The earliest the replay starts, in minutes after competition.deadline: 5..240, default 30. */
  starts_after_minutes: z.int().min(5).max(240).default(30),
  /** Seconds between two frames the live board is sent: 2..30, default 5. */
  frame_seconds: z.int().min(2).max(30).default(5),
});

/** A check reveal's running phase, in seconds (PhaseCheckReveal.duration_sec): one minute to four hours. */
export const CHECK_REVEAL_MIN_DURATION_SEC = 60;
export const CHECK_REVEAL_MAX_DURATION_SEC = 14_400;
/** Stage 1's step, τ1 (PhaseCheckReveal.stage1_step_sec): 2..60 s, default 8. */
export const CHECK_REVEAL_MIN_STAGE1_STEP_SEC = 2;
export const CHECK_REVEAL_MAX_STAGE1_STEP_SEC = 60;
export const CHECK_REVEAL_DEFAULT_STAGE1_STEP_SEC = 8;
/**
 * Stage 2's step, τ2, is derived (server/live/resolver.ts revealTimetable) and held to 5..20 s: a
 * shorter one moves a held part to stage 1, a longer one leaves the surplus as a pre-roll.
 */
export const CHECK_REVEAL_MIN_STAGE2_STEP_SEC = 5;
export const CHECK_REVEAL_MAX_STAGE2_STEP_SEC = 20;
// CHECK_REVEAL_MAX_PART_POINTS, the most one part may score on one trial, is declared before
// AgentTrialsConfig, whose staged final's practice floor reads it.

/** One scored part a check reveal shows (PhaseCheckReveal.parts): a leaderboard column's key and the most it scores on one trial. */
export const CheckRevealPart = z.strictObject({
  /** A scored leaderboard column other than the rank column (checkRevealIssues). */
  key: ColumnKey,
  /** The most the part scores on one trial, 1..CHECK_REVEAL_MAX_PART_POINTS: what a row's ceiling counts for each part still held back. */
  max: z.int().min(1).max(CHECK_REVEAL_MAX_PART_POINTS),
});

/**
 * The freeze-and-resolve reveal of a sealed program/v1 or agent/v1 ranking phase (Phase.reveal; the
 * plan: server/live/resolver.ts revealPlan, #2194's drilled design). The rank column is the sum of
 * `parts`, each a scored column (on agent/v1 per trial, the run's score their integer-sum mean). From
 * the reveal's start t0, stage 1 shows each open part (`parts` less `held`, in `parts` order) for every
 * row at once, one step every `stage1_step_sec`; that board is the freeze. Stage 2 then resolves the
 * held parts bottom-up, ICPC Resolver style: the lowest row not yet placed shows its next held part,
 * or, with none left, takes the lowest place open. Every step's row and time follow from public state
 * alone, a shown place is final, and the last step publishes at t0 + `duration_sec`, which is when the
 * results are published. Its rules against the rest of the bundle: checkRevealIssues; driven by the
 * automation job like a replay (server/competitions/load.ts automationIssues). Absent: the phase
 * publishes when it is finalized, and no key appears, so a phase without it keeps its hash.
 */
export const PhaseCheckReveal = z
  .strictObject({
    /** D: the running phase in seconds, CHECK_REVEAL_MIN_DURATION_SEC..CHECK_REVEAL_MAX_DURATION_SEC; its last step publishes at its end. */
    duration_sec: z.int().min(CHECK_REVEAL_MIN_DURATION_SEC).max(CHECK_REVEAL_MAX_DURATION_SEC),
    /** The scored parts in reveal order, each key once: their sum is the rank column. */
    parts: z.array(CheckRevealPart).min(1),
    /** The parts stage 2 resolves (keys of `parts`, each once), the freeze's held-back hour; at least one part stays open. */
    held: z.array(ColumnKey),
    /** τ1: seconds between two stage-1 steps, CHECK_REVEAL_MIN_STAGE1_STEP_SEC..CHECK_REVEAL_MAX_STAGE1_STEP_SEC, default CHECK_REVEAL_DEFAULT_STAGE1_STEP_SEC. */
    stage1_step_sec: z.int().min(CHECK_REVEAL_MIN_STAGE1_STEP_SEC).max(CHECK_REVEAL_MAX_STAGE1_STEP_SEC).default(CHECK_REVEAL_DEFAULT_STAGE1_STEP_SEC),
  })
  .superRefine((r, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const keys = new Set<string>();
    r.parts.forEach((p, i) => {
      if (keys.has(p.key)) issue(['parts', i, 'key'], `duplicate part ${p.key}: each part is shown once`);
      keys.add(p.key);
    });
    const held = new Set<string>();
    r.held.forEach((k, i) => {
      if (!keys.has(k)) issue(['held', i], `${k} is not one of parts: only a part is held back`);
      else if (held.has(k)) issue(['held', i], `${k} is held twice`);
      held.add(k);
    });
    const open = r.parts.filter((p) => !held.has(p.key)).length;
    // No part at all is the parts' own issue (at least one).
    if (r.parts.length === 0) return;
    if (open === 0) issue(['held'],'at least one part stays open: stage 1 shows the open parts for every row at once, and that board is the freeze stage 2 resolves from');
    else if (open * r.stage1_step_sec > r.duration_sec) {
      issue(['duration_sec'], `stage 1 alone (${open} open parts × stage1_step_sec ${r.stage1_step_sec} = ${open * r.stage1_step_sec} s) runs past duration_sec ${r.duration_sec}: lengthen it, hold fewer parts back, or shorten stage1_step_sec`);
    }
  });

/** The keys only a check reveal has: a reveal naming one of them and no `speed` is a check reveal (PHASE_REVEAL). */
const CHECK_REVEAL_KEYS = ['duration_sec', 'parts', 'held', 'stage1_step_sec'] as const;

/** Whether a raw reveal block is a check reveal's (see PHASE_REVEAL): an object with a check reveal's key and no `speed`. */
function looksLikeCheckReveal(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return !Object.hasOwn(v, 'speed') && CHECK_REVEAL_KEYS.some((k) => Object.hasOwn(v, k));
}

/**
 * Phase.reveal: a replay (PhaseReveal) or a check reveal (PhaseCheckReveal), told apart by their keys,
 * never by trying both: a block naming `speed`, or none of CHECK_REVEAL_KEYS, is parsed as the replay
 * (so `{}` says speed is required, as it did before the check reveal existed), any other as the check
 * reveal, and each block's issues are its own shape's, at their own paths.
 */
const PHASE_REVEAL = z.unknown().transform((v, ctx): PhaseRevealT | PhaseCheckRevealT => {
  const r = looksLikeCheckReveal(v) ? PhaseCheckReveal.safeParse(v) : PhaseReveal.safeParse(v);
  if (r.success) return r.data;
  for (const i of r.error.issues) ctx.addIssue({ ...i, input: undefined });
  return z.NEVER;
});

/** Whether a phase's reveal is a check reveal (PhaseCheckReveal), not a replay (PhaseReveal). */
export function isCheckReveal(r: PhaseRevealT | PhaseCheckRevealT): r is PhaseCheckRevealT {
  return typeof r === 'object' && r !== null && Object.hasOwn(r, 'parts');
}

/** The fewest and most practice windows a dev phase grades on (PracticeWindows.count: odd, so the median is exactly one window's). */
export const PRACTICE_WINDOWS_MIN = 3;
export const PRACTICE_WINDOWS_MAX = 9;

/** The most block-surrogate runs per dev entry a bundle may ask (PracticeWindows.stress). */
export const PRACTICE_STRESS_MAX = 40;

/** How many practice windows: odd, so the median is exactly one window's own lamport value. */
export const PracticeWindowCount = z
  .int()
  .min(PRACTICE_WINDOWS_MIN)
  .max(PRACTICE_WINDOWS_MAX)
  .refine((n) => n % 2 === 1, { message: 'count must be odd, so the median is exactly one window' });

/**
 * Phase.practice_windows: the dev phase of a pumpfun-replay/v2 bundle grades each entry on `count`
 * masked practice windows of `hours` each, instead of one dataset, and its dev score is the net PnL
 * of the median window (grader/score.ts aggregateEras). The windows are named w1..w<count>
 * (practiceWindowKeys) and attached one by one, each a dataset of its own (practice_window rows,
 * server/db/schema.ts). `stress` is the block-surrogate runs the server adds per dev entry, shown and
 * never ranked; absent, none. Odd count, 3..9: the median is one window's own lamport value.
 */
export const PracticeWindows = z.strictObject({
  count: PracticeWindowCount,
  /** Each window's length, a whole number of hours (the final window's, when a sealed-window.yaml names one). */
  hours: z.int().min(1),
  stress: z.int().min(1).max(PRACTICE_STRESS_MAX).optional(),
});
export type PracticeWindowsT = z.infer<typeof PracticeWindows>;

/** A practice window's key: w1..w<PRACTICE_WINDOWS_MAX> (practiceWindowKeys). */
export const PracticeWindowKey = z.string().regex(/^w[1-9]$/, { error: 'expected a practice window key, w1..w9' });

/** The practice windows' keys, in order: w1..w<count>. */
export function practiceWindowKeys(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `w${i + 1}`);
}

/** The most racers one race runs (PhaseRace.max_racers), and how many it runs by default. */
export const RACE_MAX_RACERS = 128;
export const RACE_DEFAULT_MAX_RACERS = 64;
/** How far behind the feed, in bars, a racer is said to be behind (PhaseRace.lag_note_bars): 1..RACE_MAX_LAG_NOTE_BARS, default 5. */
export const RACE_DEFAULT_LAG_NOTE_BARS = 5;
export const RACE_MAX_LAG_NOTE_BARS = 60;
/**
 * The contract-level race lead, in minutes, as the bundles graded before 2026-11-10 were scored under it.
 * Nothing reads it: the loader's floor is RACE_LEAD_MINUTES (server/competitions/race-lead.ts, 15,
 * checked by server/competitions/load.ts raceIssues). It stays unchanged because contracts/ is scorer
 * source (grader/version.ts SCORER_SOURCES): an edit to its tokens names a new scorer and fails the L1
 * regrades of every final graded before it at $.scorer_version. It goes once no final graded under it
 * waits on a regrade.
 */
export const RACE_MIN_LEAD_MINUTES = 60;
/** The longest race window (raceWindowOf: a bars race's phase ends_at − starts_at, a pump race's `hours`), in hours: three days run live. */
export const RACE_MAX_WINDOW_HOURS = 72;

/**
 * The live race of a bars-replay/v1 or pumpfun-replay/v2 ranking phase (Phase.race): over its window
 * (raceWindowOf), every racer (the house's baselines and the final entries, under `requires_dev_profit`
 * only those whose dev grade made a net PnL above 0, at most `max_racers` in all) runs in its own
 * sandbox as the feed comes in, and the board draws each racer's equity as it goes.
 *   - bars-replay/v1: the window is the phase's [starts_at, ends_at], fed bar by bar as the recorder at
 *     `<bars data root>/<recording>/record` takes the bars; the window is frozen from that recording
 *     when it ends and attached to the phase, and the bot cannot tell the race from a replay (the
 *     protocol is bars-replay/v1 byte for byte). No `hours`: the phase's own dates are the window.
 *   - pumpfun-replay/v2: the window is [starts_at, starts_at + hours], fed minute by minute from the
 *     tap `recording` (the live pump.fun firehose, collector/tap.ts) while the official collector
 *     records the same hours for the frozen window; the phase itself runs on past it (to ends_at, the
 *     wait for that window's freeze and attach), so `hours` is required.
 * The race decides nothing: the ordinary grade of the frozen window (two executions, byte-equal action
 * logs) alone ranks and pays; the race is a provisional third execution, labelled so wherever it
 * shows. Its rules against the rest of the bundle (a bars-replay/v1 or pumpfun-replay/v2 harness, the
 * ranking phase only and sealed, no reveal beside it, a start at least RACE_LEAD_MINUTES after the
 * deadline, a window of at most RACE_MAX_WINDOW_HOURS on the bar grid (bars) or the minute with its
 * `hours` inside the phase (pump), no dev gate on a pump race, the automation job) are the loader's (server/competitions/load.ts
 * raceIssues). Absent: no race, and no key appears, so a phase without it keeps its hash. Present, its
 * defaults fill in and are part of the hash; `hours` has none, so a race without it keeps its hash
 * too. raceOf reads it, raceWindowOf its window.
 */
export const PhaseRace = z.strictObject({
  /**
   * The recording the race reads from, a slug: on bars-replay/v1 `<bars data root>/<recording>/record`, the
   * recorder's output directory (collector/bars/record.ts); on pumpfun-replay/v2 the tap's, `<taps root>/<recording>`
   * (collector/tap.ts).
   */
  recording: Slug,
  /** Only a final entry whose latest dev grade made a net PnL above 0 races and is graded on the final (the dev_profitable check); default true. A pumpfun-replay/v2 race sets false: the gate reads a bars score alone (server/competitions/load.ts raceIssues). */
  requires_dev_profit: z.boolean().default(true),
  /** The most racers the race runs, 1..RACE_MAX_RACERS, default RACE_DEFAULT_MAX_RACERS: the house's baselines first, then the best dev net PnL, the earlier receipt breaking a tie. */
  max_racers: z.int().min(1).max(RACE_MAX_RACERS).default(RACE_DEFAULT_MAX_RACERS),
  /** Display only: a racer this many bars or more behind the feed reads "behind by N bars"; 1..RACE_MAX_LAG_NOTE_BARS, default RACE_DEFAULT_LAG_NOTE_BARS. */
  lag_note_bars: z.int().min(1).max(RACE_MAX_LAG_NOTE_BARS).default(RACE_DEFAULT_LAG_NOTE_BARS),
  /**
   * The race window's length in whole hours from the phase's starts_at, 1..RACE_MAX_WINDOW_HOURS (raceWindowOf):
   * required on pumpfun-replay/v2, whose phase runs on past the race, refused on bars-replay/v1, whose window is
   * its phase's (server/competitions/load.ts raceIssues). Absent: no key appears, so a race without it keeps its hash.
   */
  hours: z.int().min(1).max(RACE_MAX_WINDOW_HOURS).optional(),
});

export const Phase = z.strictObject({
  key: PhaseKey,
  title: z.string().min(1),
  description: z.string().default(''),
  starts_at: IsoDateTime,
  /** Null: open-ended (only the last phase). */
  ends_at: IsoDateTime.nullable(),
  /** The dataset's slug once one is attached (null until collected). */
  dataset: Slug.nullable().default(null),
  /** live: scores show as they land; after_finalize: hidden until an admin finalizes the phase. */
  scores: z.enum(['live', 'after_finalize']).default('live'),
  /** The running phase: a replay (PhaseReveal) or a check reveal (PhaseCheckReveal), PHASE_REVEAL. Absent: no key appears, so a phase without it keeps its hash. */
  reveal: PHASE_REVEAL.optional(),
  /** The dev phase's N practice windows (PracticeWindows). Absent: no key appears, so a phase without it keeps its hash, and the phase grades on `dataset` as ever. */
  practice_windows: PracticeWindows.optional(),
  /** The ranking phase's live race over its window (PhaseRace, raceWindowOf), on bars-replay/v1 or pumpfun-replay/v2 alone. Absent: no key appears, so a phase without it keeps its hash. */
  race: PhaseRace.optional(),
});

/** A derived leaderboard column's computation (LeaderboardColumn.computation). */
export const COMPUTATIONS = ['avg', 'avg_rank', 'baseline_margin', 'speedup'] as const;
export type ComputationT = (typeof COMPUTATIONS)[number];

/**
 * The computations measured against the gate baseline (the prize gate of prize_requires_beating_baseline):
 * each reads one raw column in the entry's row and in the gate baseline's, so each needs that gate,
 * sorts desc, is never the rank column (the gate is read from it) and is never read by avg or avg_rank.
 */
export const BASELINE_COMPUTATIONS = ['baseline_margin', 'speedup'] as const satisfies readonly ComputationT[];
export type BaselineComputationT = (typeof BASELINE_COMPUTATIONS)[number];

/** Whether a column's computation is measured against the gate baseline (BASELINE_COMPUTATIONS). */
export function isBaselineComputation(c: ComputationT | null): c is BaselineComputationT {
  return (BASELINE_COMPUTATIONS as readonly (ComputationT | null)[]).includes(c);
}

/** The significant figures a column may round its public value to (LeaderboardColumn.significant_figures). */
export const SIGNIFICANT_FIGURES = [2, 3] as const;

export const LeaderboardColumn = z.strictObject({
  key: ColumnKey,
  title: z.string().min(1),
  index: z.int().min(0),
  sorting: z.enum(['asc', 'desc']),
  precision: z.int().min(0).max(9).default(2),
  hidden: z.boolean().default(false),
  /**
   * Derived columns: avg = mean of the listed columns' values, avg_rank = mean of their ranks,
   * baseline_margin = how far the one listed raw column beats the gate baseline (the prize gate of
   * prize_requires_beating_baseline): that column's value minus the gate baseline's value in it,
   * negated when the column sorts asc, so a positive margin always beats the baseline (the column
   * itself sorts desc); speedup = how many times over the one listed raw column beats the gate
   * baseline: the gate baseline's value in it over the entry's when it sorts asc (a time: the
   * baseline's time over the entry's), the entry's over the baseline's when it sorts desc, so a
   * speedup above 1 always beats the baseline (the column itself sorts desc), and none unless both
   * values are positive (server/routes/competitions/ranking.ts baselineSpeedup).
   */
  computation: z.enum(COMPUTATIONS).nullable().default(null),
  computation_indexes: z.array(z.int().min(0)).nullable().default(null),
  /** Dot path into the score JSON (contracts/score.ts); null = performance.scores.<key> (program/v1). */
  source: z.string().min(1).nullable().default(null),
  /**
   * Public rounding: the significant figures a public row shows of this column's value (the value
   * itself and its display); the owner's own row, exports and the result document stay raw. Absent:
   * `precision` alone, and no key appears, so a column without it keeps its hash.
   */
  significant_figures: z.literal(SIGNIFICANT_FIGURES).optional(),
});

/**
 * When a competition's scores, ranks and places show (Leaderboard.placements): live, each phase's as its own
 * phases[].scores says while the competition runs; after_finalize, every phase's hidden from everyone but admins
 * until the ranking phase (rankingPhaseIndex) is finalized.
 */
export const PLACEMENTS = ['live', 'after_finalize'] as const;
export type PlacementsT = (typeof PLACEMENTS)[number];

export const Leaderboard = z.strictObject({
  title: z.string().min(1),
  /** The column entries rank by. */
  primary_index: z.int().min(0),
  /**
   * The column an exact tie on the rank key is ordered by, by that column's own sorting, before the
   * earlier receipt (server/routes/competitions/ranking.ts): placement order, prize ranks and the
   * standings follow it; the baseline gate, the statistical ties and the intervals read the rank key
   * alone. Another column than the rank column, shown, raw (never computed: no avg, avg_rank,
   * baseline_margin or speedup), reading no build metric (readsBuildMetric: no cost.* source), and
   * on agent/v1 a scored column (the scorer writes it per trial). Absent: ties go to the earlier receipt, and no
   * key appears, so a bundle without it keeps its hash.
   */
  tie_break_index: z.int().min(0).optional(),
  /**
   * Whether placements show while the competition runs (PLACEMENTS, placementsOf): live, each phase's scores and
   * places as its own `phases[].scores` says; after_finalize, every phase's scores, ranks and places hidden from
   * everyone but admins until the ranking phase is finalized. Absent: after_finalize (hidden), and no key appears,
   * so a bundle without it keeps its hash.
   */
  placements: z.enum(PLACEMENTS).optional(),
  /**
   * The live feed (liveFeedOf): a judged image's WebP rendition, or a judged text's kept bytes, shows to everyone while
   * the dev phase runs, each public entry's beside its dev row, before the phase locks and before the deadline
   * (server/routes/archive/judge.ts feedShows). Only true; the key is fixed when the competition opens, or added to an
   * unescrowed contest once it has resolved (no escrow holds that bundle's hash); the loader takes it only on a
   * program/v1 judge, or on an agent/v1 bundle with a feed view (server/feed/geo-map.ts agentFeedViewOf: a geolocation
   * contest, whose feed shows each entry's answers map, server/routes/archive/geo-map.ts), whose dev phase shows its
   * scores live (server/competitions/load.ts bundleIssues). Its original
   * bytes, the heat record and the opponents' artifacts stay closed until the lock as before. It is the authoring
   * default (the owner, 2026-11-11): a new judged bundle whose dev phase scores live names it, and
   * tests/unit/contract-judge-target.test.ts holds every shipped judged bundle to it or to its closed list (UNFED); one
   * kept closed leaves the key off, is listed there, and says in its rules that no entry is shown before the deadline.
   * The contract itself defaults nothing: absent, no feed, and no key appears, so a bundle without it keeps its hash.
   */
  feed: z.literal(true).optional(),
  columns: z.array(LeaderboardColumn).min(1),
});

/**
 * Whether a leaderboard column is scored: neither computed nor read from the score JSON by source,
 * so the bundle's scorer writes it (grader/program-scores.ts scoredColumns lists these).
 */
export function isScoredColumn(c: Pick<LeaderboardColumnT, 'computation' | 'source'>): boolean {
  return c.computation === null && c.source === null;
}

/**
 * Whether a column's score-JSON source path reads a build metric: the build cost, tokens and models
 * (cost, cost.*) or the authoring cost per surviving line, the paths server/routes/competitions/
 * leaderboard.ts isBuildMetricColumn withholds while build metrics are not public. The entry's code
 * size (size, size.*: contracts/score.ts Score.size) is the entry's own, public like its scores, never a
 * build metric.
 */
export function readsBuildMetric(source: string): boolean {
  return source === 'cost' || source.startsWith('cost.') || source === 'authorship.micro_usd_per_surviving_line';
}

/** The scored column an agent/v1 scorer says a trial's store works in: 1 when it works, else 0. */
export const AGENT_WORKING_COLUMN = 'working';

/** Why an agent/v1 run cannot be aggregated on a leaderboard (agentLeaderboardIssues). */
export const AGENT_LEADERBOARD_ISSUE_CODES = [
  /** No column has primary_index (the leaderboard rule refuses it on every harness). */
  'no_primary',
  /** The primary column is computed or reads the score JSON: the interval is taken over scorer points. */
  'primary_not_scored',
  /** No column is keyed AGENT_WORKING_COLUMN. */
  'no_working',
  /** The working column is computed or reads the score JSON. */
  'working_not_scored',
] as const;
export type AgentLeaderboardIssueCode = (typeof AGENT_LEADERBOARD_ISSUE_CODES)[number];

/** One reason, at its path inside the leaderboard (['primary_index'], ['columns'], ['columns', i, member]). */
export interface AgentLeaderboardIssue {
  code: AgentLeaderboardIssueCode;
  path: (string | number)[];
  message: string;
}

/** How a column that is not scored gets its value, as a refusal says it. */
function unscoredHow(c: Pick<LeaderboardColumnT, 'computation' | 'source'>): string {
  return c.computation !== null ? `is computed (${c.computation})` : `reads source ${c.source}`;
}

/**
 * The one rule an agent/v1 run is aggregated on (grader/agent-score.ts agentColumns aggregates by
 * it, the bundle's refinement refuses a bundle that breaks it, so it fails at load before any trial
 * spends inference money): the primary column is scored (the run's interval is taken over each
 * trial's scorer points in it), and a scored AGENT_WORKING_COLUMN says whether each trial's store
 * works. The issues in that order, each naming the column and the fix; none when the run can be
 * aggregated.
 */
export function agentLeaderboardIssues(leaderboard: {
  primary_index: number;
  columns: readonly Pick<LeaderboardColumnT, 'key' | 'index' | 'computation' | 'source'>[];
}): AgentLeaderboardIssue[] {
  const issues: AgentLeaderboardIssue[] = [];
  const cols = leaderboard.columns;
  const primary = cols.find((c) => c.index === leaderboard.primary_index);
  if (primary === undefined) {
    issues.push({ code: 'no_primary', path: ['primary_index'], message: `no leaderboard column has the primary index ${leaderboard.primary_index}` });
  } else if (!isScoredColumn(primary)) {
    const scored = cols.filter(isScoredColumn);
    const candidate = scored.find((c) => c.key !== AGENT_WORKING_COLUMN) ?? scored[0];
    const fix =
      candidate === undefined
        ? 'add a scored column (neither computation nor source) and point primary_index at it'
        : `point primary_index at a scored column (neither computation nor source), such as ${candidate.key}`;
    issues.push({
      code: 'primary_not_scored',
      path: ['primary_index'],
      message: `the primary column ${primary.key} is not a scored column: it ${unscoredHow(primary)}, and an agent/v1 run's interval is taken over each trial's scorer points in its primary column, so its scorer must write it; ${fix}`,
    });
  }
  const what = `the leaderboard has no scored ${AGENT_WORKING_COLUMN} column`;
  const writes = `an agent/v1 scorer writes it, 1 when a trial's store works and 0 when it does not`;
  const at = cols.findIndex((c) => c.key === AGENT_WORKING_COLUMN);
  if (at === -1) {
    issues.push({
      code: 'no_working',
      path: ['columns'],
      message: `${what}: ${writes}, and the run counts its working trials from it; add a column with key ${AGENT_WORKING_COLUMN} and neither computation nor source`,
    });
  } else if (!isScoredColumn(cols[at]!)) {
    const w = cols[at]!;
    const computed = w.computation !== null;
    issues.push({
      code: 'working_not_scored',
      path: ['columns', at, computed ? 'computation' : 'source'],
      message: `${what}: ${AGENT_WORKING_COLUMN} ${unscoredHow(w)} here, and ${writes}; ${computed ? 'drop its computation and computation_indexes' : 'drop its source'}`,
    });
  }
  return issues;
}

/** What programGateIssues reads of a bundle. */
export interface ProgramGateBundle {
  harness: Pick<ProgramHarnessT, 'runtimes' | 'gate' | 'pass_count' | 'size' | 'timing'>;
  leaderboard: { columns: readonly Pick<LeaderboardColumnT, 'key' | 'computation' | 'source'>[] };
}

/**
 * A program/v1 harness's gate (ProgramHarness.gate), pass count (ProgramHarness.pass_count), size count
 * (ProgramSize) and timing heat (ProgramTiming) against the rest of the bundle, each at its path, in that
 * order (none when they hold; the bundle's refinement reports them):
 *   - the gate names a leaderboard column, and a scored one (neither computation nor source): the
 *     scorer writes it, 1 when an entry passes and 0 when it does not;
 *   - the pass count likewise: the scorer writes it, how many cases an entry passed;
 *   - a size count or a timing heat ranks the entries that pass, so it needs a gate;
 *   - and compares them in one language: runtimes lists exactly one (bytes of code, or CPU time, in two
 *     languages say nothing about which entry is smaller or faster).
 * Whether the scorer writes only 0 or 1 there is each score's to say (grader/score.ts).
 */
export function programGateIssues(b: ProgramGateBundle): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const h = b.harness;
  const writes = '1 when an entry passes and 0 when it does not';
  if (h.gate !== undefined) {
    const col = b.leaderboard.columns.find((c) => c.key === h.gate);
    if (col === undefined) out.push({ path: ['harness', 'gate'], message: `no leaderboard column is keyed ${h.gate}: the gate is a scored column of the leaderboard, which the scorer writes ${writes}` });
    else if (!isScoredColumn(col)) out.push({ path: ['harness', 'gate'], message: `the gate column ${h.gate} ${unscoredHow(col)}: the gate is a scored column (neither computation nor source), which the scorer writes ${writes}` });
  }
  if (h.pass_count !== undefined) {
    const counts = 'how many cases an entry passed';
    const col = b.leaderboard.columns.find((c) => c.key === h.pass_count);
    if (col === undefined) out.push({ path: ['harness', 'pass_count'], message: `no leaderboard column is keyed ${h.pass_count}: the pass count is a scored column of the leaderboard, which the scorer writes with ${counts}` });
    else if (!isScoredColumn(col)) out.push({ path: ['harness', 'pass_count'], message: `the pass count column ${h.pass_count} ${unscoredHow(col)}: the pass count is a scored column (neither computation nor source), which the scorer writes with ${counts}` });
  }
  const ranks = [
    ...(h.size === undefined ? [] : [{ key: 'size', what: 'a size count ranks the entries that pass by the bytes of their code' }]),
    ...(h.timing === undefined ? [] : [{ key: 'timing', what: 'a timing heat races the entries that pass on CPU time net of the null-entry control' }]),
  ];
  if (h.gate === undefined) {
    for (const r of ranks) out.push({ path: ['harness', r.key], message: `${r.what}, and the harness names no gate: set gate to the scored column the scorer writes ${writes}` });
  }
  if (ranks.length > 0 && h.runtimes.length !== 1) {
    const which = ranks.map((r) => r.key).join(' and ');
    out.push({
      path: ['harness', 'runtimes'],
      message: `${which} compare${ranks.length === 1 ? 's' : ''} entries in one language, and runtimes lists ${h.runtimes.length}: list exactly one (the bytes of code, or the CPU time, of two languages say nothing about which entry is smaller or faster)`,
    });
  }
  return out;
}

/** What programJudgeIssues reads of a bundle. */
export interface ProgramJudgeBundle {
  competition: { resolution: Pick<ResolutionT, 'method'> };
  harness: Pick<ProgramHarnessT, 'judge' | 'gate' | 'timing' | 'size' | 'pass_count' | 'generator' | 'scorer' | 'input_data'>;
  leaderboard: { primary_index: number; columns: readonly Pick<LeaderboardColumnT, 'key' | 'index' | 'sorting' | 'computation' | 'source'>[] };
  prize_requires_beating_baseline?: boolean | undefined;
  /** The bundle's prizes, for a screened final's shortlist and playoff (none: no paid place). */
  prizes?: readonly Pick<PrizeT, 'kind' | 'place' | 'amount_usd'>[] | undefined;
}

/**
 * A program/v1 judge heat (ProgramHarness.judge) against the rest of the bundle, each at its path, in
 * that order (none without a judge, or when they hold; the bundle's refinement reports them):
 *   - it plays the entries that pass, so it needs a gate: the scorer says whether an entry's artifact is
 *     valid;
 *   - it is the one ranking: no timing heat, size count or pass count beside it, and no generator (the
 *     anchors answer the bundle's own input, so every entry answers it too);
 *   - and no prize_requires_beating_baseline: the baseline gate compares raw values, so a win rate a
 *     noise's width above the baseline's (0.51 against 0.50) would pay;
 *   - the house judge decides the ranking: resolution.method is 'judges';
 *   - the rank column reads the win rate (JUDGE_WIN_RATE_SOURCE), sorting desc;
 *   - its directory is its own, apart from the scorer's and the data's (ownDirIssues);
 *   - and its ladder's (ProgramJudgeLadder.dir), when it names one, is its own too, apart from those
 *     and the judge directory: each is sealed by its own digest;
 *   - a screened final (ProgramJudgeScreened) screens on the dev phase's ladder ratings, so it needs a
 *     ladder, and its shortlist line M (judgeShortlistPlaces over the last paid place) holds every
 *     playoff place (playoff_places, or unnamed the last paid place and PROGRAM_JUDGE_PLAYOFF_MARGIN more,
 *     at least PROGRAM_JUDGE_MIN_PLAYOFF_PLACES, as server/competitions/load.ts judgePlayoffPlaces);
 *   - its contender rounds (contender_games above 0) run only on the bundle's own named judge, never a pool,
 *     the house's pool or an overflow, so the judge names one model (namedJudgeAgent);
 *   - and its race separates the prize boundaries of the placement prizes at places exactly 1 to K
 *     (grader/judge-race.ts judgeRaceTiers, which throws on any other set), so the places skip none: a gap would
 *     load and then fail the final. A place listed twice is the bundle's own duplicate-place issue, not repeated here.
 */
export function programJudgeIssues(b: ProgramJudgeBundle): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const h = b.harness;
  const j = h.judge;
  if (j === undefined) return out;
  if (h.gate === undefined) {
    out.push({ path: ['harness', 'judge'], message: "a judge heat plays the entries that pass, and the harness names no gate: set gate to the scored column the scorer writes 1 in when an entry's artifact is valid and 0 when it is not" });
  }
  const others = [
    { key: 'timing', what: 'a timing heat ranks by CPU time' },
    { key: 'size', what: 'a size count ranks by the bytes of code' },
    { key: 'pass_count', what: 'a pass count bars prizes on the cases an entry passed' },
    { key: 'generator', what: "an instance-drawn harness grades each phase on drawn input, and the house anchors answer the bundle's own" },
  ] as const;
  for (const o of others) {
    if (h[o.key] !== undefined) out.push({ path: ['harness', o.key], message: `a judge heat ranks the entries that pass by the house judge's verdicts alone, and ${o.what}: drop ${o.key}` });
  }
  if (b.prize_requires_beating_baseline !== undefined) {
    out.push({
      path: ['prize_requires_beating_baseline'],
      message: "a judge heat's playoff decides the prizes: the baseline gate compares raw values only, so a win rate a noise's width above the baseline's (0.51 against 0.50) would pay; drop prize_requires_beating_baseline",
    });
  }
  if (b.competition.resolution.method !== 'judges') {
    out.push({ path: ['competition', 'resolution', 'method'], message: `the house judge decides a judge harness's ranking, and resolution.method is ${b.competition.resolution.method}: set it to judges` });
  }
  const at = b.leaderboard.columns.findIndex((c) => c.index === b.leaderboard.primary_index);
  const rank = at < 0 ? undefined : b.leaderboard.columns[at];
  if (rank !== undefined) {
    if (rank.computation !== null || rank.source !== JUDGE_WIN_RATE_SOURCE) {
      out.push({
        path: ['leaderboard', 'columns', at, rank.computation !== null ? 'computation' : 'source'],
        message: `a judge harness ranks by the judge heat's win rate, and its rank column ${rank.key} ${rank.computation !== null ? 'is computed' : `reads ${rank.source ?? `performance.scores.${rank.key}`}`}: give it source ${JUDGE_WIN_RATE_SOURCE} and no computation`,
      });
    }
    if (rank.sorting !== 'desc') {
      out.push({ path: ['leaderboard', 'columns', at, 'sorting'], message: `a higher win rate ranks first, and the rank column ${rank.key} sorts ${rank.sorting}: set sorting to desc` });
    }
  }
  const earlier = [
    { name: 'scorer', dir: scorerDirOf(h.scorer.entrypoint) },
    ...(h.input_data === null ? [] : [{ name: 'input data', dir: h.input_data }]),
    ...(h.scorer.reference_data === null ? [] : [{ name: 'reference data', dir: h.scorer.reference_data }]),
  ];
  for (const message of ownDirIssues('the judge', j.dir, earlier)) out.push({ path: ['harness', 'judge', 'dir'], message });
  if (j.ladder !== undefined) {
    for (const message of ownDirIssues('the ladder', j.ladder.dir, [...earlier, { name: 'judge', dir: j.dir }])) out.push({ path: ['harness', 'judge', 'ladder', 'dir'], message });
  }
  if (j.screened !== undefined) {
    if (j.ladder === undefined) {
      out.push({
        path: ['harness', 'judge', 'screened'],
        message: "a screened final screens each entry on its dev phase's ladder rating, and the judge names no ladder: add ladder (the calibrated ladder the dev heats play), or drop screened",
      });
    }
    const paid = (b.prizes ?? []).reduce((last, p) => (p.kind === 'placement' && p.place !== null && p.amount_usd > 0 ? Math.max(last, p.place) : last), 0);
    const playoff = j.playoff_places ?? Math.max(PROGRAM_JUDGE_MIN_PLAYOFF_PLACES, paid + PROGRAM_JUDGE_PLAYOFF_MARGIN);
    const line = judgeShortlistPlaces(j.screened, paid);
    if (line < playoff) {
      out.push({
        path: ['harness', 'judge', 'screened', 'shortlist_min'],
        message: `a screened final's playoff takes its places from the shortlist, and the shortlist line sits at place ${line} (max(${j.screened.shortlist_per_paid} x the last paid place ${paid}, shortlist_min ${j.screened.shortlist_min})) while the playoff takes ${playoff}: take shortlist_min at least ${playoff}`,
      });
    }
    if (j.screened.contender_games > 0 && namedJudgeAgent(j.agent) === null) {
      out.push({
        path: ['harness', 'judge', 'screened', 'contender_games'],
        message: "contender rounds run on the bundle's own named judge: name one model or set contender_games: 0",
      });
    }
    const places = [...new Set((b.prizes ?? []).flatMap((p) => (p.kind === 'placement' && p.place !== null ? [p.place] : [])))].sort((x, y) => x - y);
    const k = places.length;
    if (k > 0 && places[k - 1] !== k) {
      const held = new Set(places);
      const skipped = Array.from({ length: places[k - 1]! }, (_, i) => i + 1).filter((p) => !held.has(p));
      out.push({
        path: ['prizes'],
        message: `a screened final races the prize boundaries of placement prizes at places exactly 1 to ${k}, and the placement prizes sit at places ${placeRanges(places)}, skipping ${placeRanges(skipped)}: number them 1 to ${k} with no gap`,
      });
    }
  }
  return out;
}

/** Sorted whole places as runs, `1 to 3, 5, 7 to 9`. */
function placeRanges(sorted: readonly number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    runs.push(j === i ? `${sorted[i]}` : `${sorted[i]} to ${sorted[j]}`);
    i = j + 1;
  }
  return runs.join(', ');
}

/** Codabench's leaderboard submission rules: which of an entrant's submissions ranks. */
export const CODABENCH_SUBMISSION_RULES = [
  'Add',
  'Add_And_Delete',
  'Add_And_Delete_Multiple',
  'Force_Last',
  'Force_Latest_Multiple',
  'Force_Best',
] as const;

export const SubmissionRule = z.strictObject({
  rule: z.enum(CODABENCH_SUBMISSION_RULES),
  max_per_day: z.int().min(1),
  /**
   * The most entries each entrant's account may have in the competition in all (null: no total of the bundle's own),
   * counting only those its checks did not reject: an accepted, superseded or cancelled entry counts, one still being
   * checked holds its place until it is rejected, and neither a rejected one (before its grade was scored, or by the
   * contest's own dev floor after it: dev_profitable, practice_floor) nor a round the platform failed counts
   * (server/routes/submissions.ts quotaWeightOf; the words: server/entries/checks.ts QUOTA_COUNTED). An account's
   * reputation can lower it and an admin's allowance adds to it. Beside it every account is held to the platform's hard
   * limit (server/entries/checks.ts ENTRY_HARD_LIMIT), every entry taken in counted, rejected or not, which no bundle raises.
   */
  max_total: z.int().min(1).nullable().default(null),
  /** An entry must carry the transcripts that built it (default on); the deployment's switch can turn it off everywhere: transcriptsRequired. */
  transcripts_required: z.boolean().default(true),
  strategy_note_required: z.boolean().default(false),
  /** The repo must carry an OSI-approved license. */
  license: z.literal('osi'),
  /** The repo's created_at must be at or after competition.opens_at. */
  repo_created_after_open: z.boolean(),
  /** Only house accounts may enter (internal pilots). */
  house_only: z.boolean().default(false),
  /**
   * Strict transcripts: an entry's transcripts come only from sealed `makefun record` recordings the site witnessed
   * live while the agent worked (contracts/recording.ts), and no transcript upload is accepted; the gate check
   * transcripts_witnessed holds every session line and committed file to the times the site received them. Absent
   * means off (optional, no default, so the canonical JSON and the hash of every bundle that leaves it out stay as
   * they were). On needs transcripts_required on.
   */
  strict_transcripts: z.boolean().optional(),
}).refine((r) => r.strict_transcripts !== true || r.transcripts_required, {
  message: 'strict transcripts build every entry\'s transcripts from its recordings: set transcripts_required to true, or strict_transcripts to false',
  path: ['strict_transcripts'],
});

/** Whether a competition's submission rule turns strict transcripts on (absent: off). */
export function strictTranscripts(rule: { readonly strict_transcripts?: boolean | undefined }): boolean {
  return rule.strict_transcripts === true;
}

/** The deployment's switch over every competition's transcript rule: `off` (or 0/false) makes no entry need its transcripts; unset or `on` leaves each competition's own rule. */
export const TRANSCRIPTS_REQUIRED_ENV = 'MAKEFUN_TRANSCRIPTS_REQUIRED';

/** Whether this deployment requires transcripts at all (TRANSCRIPTS_REQUIRED_ENV, default on). */
export function transcriptsRequiredGlobally(
  env: Readonly<Record<string, string | undefined>> | undefined = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env,
): boolean {
  const v = (env?.[TRANSCRIPTS_REQUIRED_ENV] ?? '').trim().toLowerCase();
  return !(v === 'off' || v === '0' || v === 'false');
}

/** Whether a competition's entries must carry their transcripts: its own submission_rule.transcripts_required and the deployment's switch, both on. */
export function transcriptsRequired(rule: { readonly transcripts_required: boolean }, global: boolean = transcriptsRequiredGlobally()): boolean {
  return global && rule.transcripts_required;
}

export const Prize = z
  .strictObject({
    kind: z.enum(['placement', 'efficiency']),
    /** 1-based place for placement prizes; null for the efficiency prize. */
    place: z.int().min(1).nullable(),
    amount_usd: usd,
    title: z.string().min(1).nullable().default(null),
  })
  .refine((p) => (p.kind === 'placement') === (p.place !== null), 'placement prizes have a place; the efficiency prize has none');

/** The most model globs a build meter's keys may call (BuildMeter.models). */
export const BUILD_METER_MAX_MODELS = 200;

/**
 * A build key's every model (BuildKeyModels): the glob `*` alone. masq reads a key's allowlist glob `*` as any run of
 * characters in any case (masq src/keys.ts modelAllowed), so every model id passes it. A build key's alone: a
 * ModelGlob, and so an agent/v1 allowlist (AgentInference.models), is never wildcards alone.
 */
export const EVERY_MODEL_GLOB = '*';

/** Whether a build key's model globs (BuildKeyModels) allow every model: EVERY_MODEL_GLOB alone. */
export function allowsEveryModel(models: readonly string[]): boolean {
  return Array.isArray(models) && models.length === 1 && models[0] === EVERY_MODEL_GLOB;
}

/** A build key's model glob (BuildKeyModels): a ModelGlob, or EVERY_MODEL_GLOB, every model. */
export const BuildKeyGlob = ModelGlobChars.refine(
  (s) => s === EVERY_MODEL_GLOB || /[^*?]/.test(s),
  `a model glob names a model or a family, or is ${EVERY_MODEL_GLOB} for every model: not other wildcards alone`,
);

/**
 * The model globs a build key may call (BuildMeter.models): EVERY_MODEL_GLOB alone, every model, or
 * 1..BUILD_METER_MAX_MODELS ModelGlobs, each listed once.
 */
export const BuildKeyModels = z
  .array(BuildKeyGlob)
  .min(1, 'a build key calls at least one model: name a model glob')
  .max(BUILD_METER_MAX_MODELS, `at most ${BUILD_METER_MAX_MODELS} model globs`)
  .superRefine((models, ctx) => {
    const seen = new Set<string>();
    models.forEach((g, i) => {
      if (seen.has(g)) ctx.addIssue({ code: 'custom', path: [i], message: `the model glob ${g} is listed twice` });
      else if (g === EVERY_MODEL_GLOB && models.length > 1) ctx.addIssue({ code: 'custom', path: [i], message: `${EVERY_MODEL_GLOB} is every model: a build key lists it alone, never beside another glob` });
      seen.add(g);
    });
  });

/** An entrant's share of a build allowance (BuildMeter.per_entrant_usd): a USD amount above 0. */
export const BuildKeyShareUsd = UsdAmount.refine((n) => n > 0, "an entrant's share of the build allowance is above 0");

/**
 * The build meter (CompetitionBundle.build_meter): the sponsor's build allowance, which pays the model
 * spend of building each entry through a masq build key make.fun issues to its entrant, so a competition
 * ranked on build cost ranks on what the house's own meter saw (contracts/score.ts Cost.metered; an
 * entry whose transcripts used a model off the key is `cost_unmetered`, COST_UNMETERED_REASON):
 *   allowance_usd     the whole allowance, above 0: what every entrant's build keys may spend between them
 *   per_entrant_usd   one entrant's share, above 0 and at most allowance_usd: the cap on its keys
 *   models            the model globs (ModelGlob) a build key may call, 1..BUILD_METER_MAX_MODELS, each once,
 *                     or `*` alone for every model (BuildKeyModels, EVERY_MODEL_GLOB)
 * Not a prize: it pays for builds, never a place, so competition.reward_usd stays the prizes' sum and an
 * escrow holds none of it (the house holds it off-chain and owes back what the keys did not spend). Only
 * on the shape that ranks on build cost (buildMeterIssues: program/v1, the rank column reading
 * cost.micro_usd, prize_requires_efficiency).
 */
export const BuildMeter = z
  .strictObject({
    allowance_usd: UsdAmount.refine((n) => n > 0, 'a build allowance is above 0'),
    per_entrant_usd: BuildKeyShareUsd,
    models: BuildKeyModels,
  })
  .superRefine((m, ctx) => {
    // In cents (UsdAmount: at most two decimals), so no float rounding decides it.
    if (Math.round(m.per_entrant_usd * 100) > Math.round(m.allowance_usd * 100)) {
      ctx.addIssue({
        code: 'custom',
        path: ['per_entrant_usd'],
        message: `per_entrant_usd (${m.per_entrant_usd}) is at most allowance_usd (${m.allowance_usd}): one entrant's build keys draw on the allowance, never past it`,
      });
    }
  });

/** An entry fee's amount (EntryFee.amount_usd): a USD amount above 0, in whole cents (UsdAmount). */
export const EntryFeeUsd = UsdAmount.refine((n) => n > 0, 'an entry fee is above 0');

/**
 * The entry fee (CompetitionBundle.entry_fee): a fixed USDC amount an account pays to enter the bounty.
 *   amount_usd   the fee, above 0, in whole cents (EntryFeeUsd)
 * One payment per account per bounty, never per entry. The fee goes into the bounty's escrow vault and
 * joins the pot: at resolve the fee pot is split pro rata over the awarded placement prizes, and if
 * nobody places each fee is refunded to its payer as a result leaf (server/payouts/standings.ts Entry
 * fees). That needs a posted result, which needs a committed entries root: with no signed entry by the
 * entries deadline commit_entries commits none, no result can be posted, and refund sweeps the whole
 * vault, the fees included, to the sponsor (server/chain/jobs/post-result.ts pages the admins with the
 * fees it sends there). A paying account may keep up to 10 entries.
 * Not a prize, so competition.reward_usd stays the prizes' sum. Never on a rehost (whose signed terms
 * promise free entry) or a submission_rule.house_only bundle (server/competitions/load.ts bundleIssues);
 * a house bundle with one escrows at open (the house loader).
 */
export const EntryFee = z.strictObject({
  amount_usd: EntryFeeUsd,
});

/** The cost column a build meter's competition ranks by (BuildMeter): the metered build cost. */
export const BUILD_METER_RANK_SOURCE = 'cost.micro_usd';

/** What buildMeterIssues reads of a bundle. */
export interface BuildMeterBundle {
  harness: Pick<HarnessT, 'kind'>;
  leaderboard: { primary_index: number; columns: readonly Pick<LeaderboardColumnT, 'key' | 'index' | 'computation' | 'source'>[] };
  prize_requires_efficiency?: boolean;
  build_meter?: unknown;
}

/**
 * A build meter (BuildMeter) against the rest of the bundle, each at ['build_meter'], in this order
 * (none without one, or when they hold; the bundle's refinement reports them). It pays for builds ranked
 * on their metered cost, so:
 *   - the harness is program/v1: an entrant builds a program, the build is what the meter paid for;
 *   - the rank column (leaderboard.primary_index) reads BUILD_METER_RANK_SOURCE, raw (no computation);
 *   - prize_requires_efficiency is true: a prize goes only to an efficiency-eligible build, which under a
 *     meter is one whose every usage line it vouched for.
 * A primary index no column has is the leaderboard rule's to report.
 */
export function buildMeterIssues(b: BuildMeterBundle): { path: (string | number)[]; message: string }[] {
  if (b.build_meter === undefined) return [];
  const out: { path: (string | number)[]; message: string }[] = [];
  const at = ['build_meter'];
  const pays = 'a build meter pays for the model spend of building entries ranked on their metered build cost';
  if (b.harness.kind !== 'program/v1') out.push({ path: at, message: `${pays}: it needs a program/v1 harness, not ${b.harness.kind}` });
  const rank = b.leaderboard.columns.find((c) => c.index === b.leaderboard.primary_index);
  if (rank !== undefined && (rank.computation !== null || rank.source !== BUILD_METER_RANK_SOURCE)) {
    const how = rank.computation !== null ? `is computed (${rank.computation})` : rank.source === null ? 'is a scored column' : `reads ${rank.source}`;
    out.push({ path: at, message: `${pays}: the rank column (leaderboard.primary_index) reads ${BUILD_METER_RANK_SOURCE}, and ${rank.key} ${how}` });
  }
  if (b.prize_requires_efficiency !== true) {
    out.push({ path: at, message: `${pays}: it needs prize_requires_efficiency: true, so a prize goes only to an efficiency-eligible build, one whose every usage line the meter vouched for` });
  }
  return out;
}

/**
 * The prize gates a bundle may name (`prize_gate`). 'rehearsal': a past-data backtest (a sealed pool of
 * recorded windows, competitions/<slug>/sealed-window.yaml) whose entries could have seen the scored
 * data, so the hindsight check (server/entries/hindsight.ts) must first be shown to catch planted
 * memorisers without holding honest bots. While such a bundle lists any prize or a reward_usd above 0,
 * the loader (server/competitions/load.ts directoryIssues, prizeGateIssue, rehearsalGate) refuses it
 * unless competitions/<slug>/rehearsal.json verifies under verifyRehearsal in its sealed form: the
 * agent-fun/rehearsal-sealed/v3 record scripts/backtest/rehearse.ts gate publishes there
 * (server/competitions/rehearsal.ts sealRehearsal: counts over every window and trial, nothing per window
 * or per audit, the false-positive statement's gaps rounded up to a whole delta, and a commitment to the
 * full record). The full agent-fun/rehearsal/v1 record, whose per-window
 * numbers identify the pool's windows, is refused beside the bundle: rehearse.ts keeps it private as the
 * commitment's opening (<sealed dir>/<slug>/rehearsal.opening.json, revealed with the final kit), and
 * while it is there the loader checks the published record against it (verifyRehearsalOpening). What binds:
 *   - the sha256 of sealed-window.yaml's bytes as they are now: another pool, or the same pool re-sealed,
 *     needs its own rehearsal;
 *   - the check in force, cheatCheckSha256() of CHEAT_CHECK (its version and every number): calibration
 *     or any later change to the check needs a new rehearsal;
 *   - this competition's slug, every window of the pool (the sidecar's `windows`) and at least
 *     PRIZE_GATE_MIN_TRIALS trials;
 *   - the gate itself, re-derived from the sealed record's flags (and, against its opening, from the full
 *     record's numbers) and never read from its stored verdict: every GATE_POSITIVES memoriser flagged in
 *     every trial on every window, no house bot or baseline ever flagged, variant and zoo bots within the
 *     10% bound.
 * And no prize is listed while the check in force is provisional (CheatCheck.provisional, until
 * calibration freezes it): a record that verifies against it lets no prize load, nor the escrow open.
 * A gated bundle with no prize and a reward_usd of 0 loads without either file (the rehearsal runs on
 * it); prizes are listed after it passes. Absent, no key appears, so a bundle without it keeps its hash.
 *
 * The gate fails closed: a bundle that lists any prize or a reward_usd above 0 beside a
 * sealed-window.yaml (any entry under that name in its directory) is refused unless it names
 * 'rehearsal', by the loader (prizeGateIssue) and by the escrow open (server/routes/escrow.ts) alike, so
 * a past-data backtest, a sponsor's among them, never lists a prize ungated. The sidecar lives beside
 * the bundle, not in it, so this contract cannot see it: the rule is the directory rules' (prizeGateIssue).
 *
 * 'accord': a rehosted upstream bounty (competition.rehost), whose prize is paid for a patch the
 * upstream owner accepts on the terms of the accord they ratified (contracts/rehost.ts RehostAccord: the
 * grader, the review window, the grounds a patch may be rejected on). The bundle names it exactly when it
 * names competition.rehost, and that bundle lists no prize until competitions/<slug>/accord.json
 * (AccordFile) holds the accord rehost.accord_sha256 names and the owner's acceptance of it. That
 * sidecar lives beside the bundle too, so its checks are the directory rules'.
 *
 * Each gate is its own harness's (PRIZE_GATE_HARNESS), and neither takes the other's.
 */
export const PRIZE_GATES = ['rehearsal', 'accord'] as const;
export const PrizeGate = z.enum(PRIZE_GATES);
export type PrizeGateT = (typeof PRIZE_GATES)[number];

/** The harness each prize gate needs, and why. */
export const PRIZE_GATE_HARNESS: Readonly<Record<PrizeGateT, { kind: HarnessKindT; why: string }>> = {
  rehearsal: { kind: 'pumpfun-replay/v2', why: 'the hindsight check it rehearses replays bots on sealed windows' },
  accord: { kind: 'patch/v1', why: "the accord it waits on ratifies a patch/v1 grader: the upstream's repo, its tests, the digests of the pack's lists" },
};

/** The fewest trials a rehearsal that lets a prize be listed may have run (rehearse.ts gate's default). */
export const PRIZE_GATE_MIN_TRIALS = 5;

/**
 * How a competition's prizes leave the house (Automation.payouts): 'manual', an admin screens each
 * claim and pays it (server/payouts/rails.ts, the manual rail); 'auto', each manual-rail claim is
 * screened automatically and paid from the prize hot wallet, held for an admin whenever a check does
 * not pass. An escrowed competition's prizes are claimed from its escrow on chain, so it never pays
 * 'auto' (server/competitions/load.ts escrowPayoutsIssue), unless its bundle funds the escrow at
 * open (ESCROW_FUNDINGS): then 'auto' pays from the hot wallet only when that escrow was never funded.
 */
export const PAYOUT_MODES = ['auto', 'manual'] as const;
export const PayoutMode = z.enum(PAYOUT_MODES);
export type PayoutModeT = (typeof PAYOUT_MODES)[number];

/**
 * When a competition's reward goes into its escrow (Automation.escrow): 'at_open', the worker moves the
 * whole placement reward from make.fun's reward wallet into the competition's own escrow on Solana when
 * it opens, once, with no admin. The rules are hashed into that escrow (rules_sha256), so a bundle says
 * so itself, and its rules have to be true whether or not the escrow could be funded: when it was, the
 * winners claim from the escrow on chain; when it was not, the prizes are paid as a bundle without the
 * key pays them (Automation.payouts). The loader holds such a bundle to what an escrow can carry
 * (server/competitions/load.ts escrowAtOpenIssues).
 */
export const ESCROW_FUNDINGS = ['at_open'] as const;
export const EscrowFunding = z.enum(ESCROW_FUNDINGS);
export type EscrowFundingT = (typeof ESCROW_FUNDINGS)[number];

/**
 * The competition's automation (CompetitionBundle.automation). `lifecycle: true` opts it in to the
 * automation job, which runs only while the server has it on as well: at the deadline it locks the
 * ranking phase, waits for every gate resolve needs (both grades of every entry, the regrades of the
 * would-be awarded set, a current cluster scan), plays the phase's reveal if it has one, publishes the
 * results and resolves the competition; an escrowed competition is only locked, its chain sync
 * resolves it. `payouts` (PAYOUT_MODES, default 'manual'). `escrow` (ESCROW_FUNDINGS): 'at_open'
 * funds the competition's escrow when it opens; left out, none is funded at open and no key appears,
 * so a bundle without it keeps its hash. The block absent: nothing is automated (payouts 'manual'),
 * and no key appears, so a bundle without it keeps its hash.
 */
export const Automation = z.strictObject({
  lifecycle: z.boolean(),
  payouts: PayoutMode.default('manual'),
  escrow: EscrowFunding.optional(),
});

/**
 * The retired `market` key (CompetitionBundle.market): the terms of the play-credit side-bet market, deleted with
 * its engine for the on-chain side market (server/side-market/, whose toggles are the database's, never the
 * bundle's). It stays in the contract only so a bundle stored with it still parses and hashes exactly as stored: a
 * released race's (the btc-race template wrote `market: {enabled: false, ...}`, and an escrow committed the
 * bundle's sha256 at open: server/chain/rules-hash.ts) and every older competition row's. It is read as written,
 * an object of strings, numbers and booleans: nothing fills in, nothing reads it, and a repo bundle that names it
 * is refused (server/competitions/load.ts retiredMarketIssue).
 */
export const RetiredMarket = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export type AutomationT = z.infer<typeof Automation>;
export type PhaseRevealT = z.infer<typeof PhaseReveal>;
export type PhaseCheckRevealT = z.infer<typeof PhaseCheckReveal>;
export type PhaseRaceT = z.infer<typeof PhaseRace>;
export type CheckRevealPartT = z.infer<typeof CheckRevealPart>;

export const Limits = z.strictObject({
  cpus: z.number().positive().max(64),
  memory_mb: z.int().min(64),
  pids: z.int().min(16),
  wall_budget_sec: z.int().min(1),
});

export const CompetitionBundle = z
  .strictObject({
    version: z.literal(COMPETITION_BUNDLE_VERSION),
    competition: CompetitionInfo,
    harness: Harness,
    phases: z.array(Phase).min(1),
    leaderboard: Leaderboard,
    submission_rule: SubmissionRule,
    prizes: z.array(Prize),
    /**
     * The build meter (BuildMeter): the sponsor's build allowance and how each entrant's metered build
     * key draws on it. Not a prize, so reward_usd stays the prizes' sum. Only on a program/v1 bundle
     * ranked on its metered build cost with prize_requires_efficiency (buildMeterIssues). Absent: no
     * key appears, so a bundle without it keeps its hash.
     */
    build_meter: BuildMeter.optional(),
    /**
     * The entry fee (EntryFee): one payment per account per bounty, into the bounty's escrow vault,
     * where it joins the pot. The fee pot is split pro rata over the awarded placement prizes, and
     * refunded as result leaves if nobody places; with no signed entry at all no result is posted and
     * the vault, fees included, refunds to the sponsor (EntryFee). A paying account may keep up to 10 entries. Not a
     * prize, so reward_usd stays the prizes' sum. Absent: entry is free, and no key appears, so a
     * bundle without it keeps its hash.
     */
    entry_fee: EntryFee.optional(),
    limits: Limits,
    min_authored_coverage: z.number().min(0).max(1),
    /**
     * A placement prize needs a net PnL above holding cash (> 0 after every fee: lamports on a pump
     * replay, net_pnl_quote_units on a bars replay): an entry at 0 or below keeps its rank but is not
     * prize-eligible (grader/score.ts eligibility, `below_hold_cash`; server/payouts/baseline.ts
     * belowHoldCash), and a place no prize-eligible entry is left to take is unawarded and refunds to
     * the sponsor (server/payouts/standings.ts). pumpfun-replay/v2 and bars-replay/v1 only: a bars race
     * pays only an entry that made money on it, the prize bar its one-symbol universe can carry (the
     * baseline gate's interval cannot clear on one symbol: server/competitions/load.ts
     * barsBaselineUniverseIssue). Absent: beating hold-cash gates a pump replay's efficiency view alone
     * (the pilot's rule) and a bars replay's nothing, and no key appears, so a bundle without it keeps
     * its hash.
     */
    prize_requires_beating_hold_cash: z.boolean().optional(),
    /**
     * A placement prize needs a rank value better than the gate baseline's: the best rank-column value
     * (best by that column's sorting) among the phase's ranked entries flagged baseline, so an entry
     * must beat every published house baseline. An entry at or below it keeps its rank but is not
     * prize-eligible, applied when ranking, never when grading. On any harness, pumpfun-replay/v2
     * included: there a net PnL above the best house bot's, weighed on the value alone
     * (server/payouts/baseline.ts), the house's hold-cash bot among the baselines holding the bar at 0
     * or above. Never beside prize_requires_beating_hold_cash: a bundle names one prize bar. Never true
     * on a bars-replay/v1 universe of one symbol, whose interval across assets can never clear
     * (server/competitions/load.ts barsBaselineUniverseIssue). A baseline_margin column needs it set
     * to true. Absent: no key appears, so a bundle without it keeps its hash.
     */
    prize_requires_beating_baseline: z.boolean().optional(),
    /**
     * The house's own entries hold the places they win (the owner's call: "when it wins a position that
     * position just gets no prize"). True: walking the ranking in its prize order, a house entry
     * (server/payouts/standings.ts standingsHouse) or a baseline takes the next place whenever it would
     * place as an entrant (ranked, a value on the rank key, the guardrails met, every prize bar the bundle
     * names cleared, the baseline gate's included, which the gate baseline never clears, not identical
     * behaviour, its run not excluded), exempt only from what bars it for being the house's (the `house`,
     * `baseline` and `no_transcripts` reasons, the payout wallet, one place per entrant and per wallet):
     * the place it holds pays nothing, its prize unawarded (an escrow's refunds to the sponsor), and the
     * entrants behind it take the places after it; the efficiency prize alike goes unawarded when a house
     * entry or baseline leads the efficiency order (server/routes/competitions/ranking.ts holdsHousePlace,
     * efficiencyHolderOf). Absent or false: a house entry or baseline takes no place, so the next entrant
     * takes the place it would have, and no key appears, so a bundle without it keeps its hash. Any harness.
     */
    house_holds_places: z.boolean().optional(),
    /**
     * A placement prize needs the entry to be efficiency-eligible (contracts/score.ts Eligibility
     * efficiency_eligible: an authorship summary at or above min_authored_coverage, a fully priced build
     * cost, no partial or inconsistent usage line, and under a build meter a cost the meter vouched for
     * (provenance metered, else cost_unmetered), as grader/score.ts eligibility rules): an entry that
     * is not keeps its rank but is not prize-eligible. For a competition that ranks on the build's cost,
     * whose rank key means nothing unless every line of it is priced and authored. On any harness, beside
     * a prize bar or alone; a build meter needs it. Absent: efficiency gates the efficiency view alone, and
     * no key appears, so a bundle without it keeps its hash.
     */
    prize_requires_efficiency: z.boolean().optional(),
    /**
     * The prize gate (PRIZE_GATES), each its own harness's (PRIZE_GATE_HARNESS): 'rehearsal'
     * (pumpfun-replay/v2) refuses any prize until a passing rehearsal record binds the sealed pool and
     * the check in force, and while that check is provisional; 'accord' (patch/v1), named exactly
     * beside competition.rehost, refuses any prize until the upstream owner has accepted the accord.
     * Absent: no gate, and no key appears, so a bundle without it keeps its hash; but a bundle
     * that lists a prize beside a sealed-window.yaml must name it (PRIZE_GATES: the gate fails closed).
     */
    prize_gate: PrizeGate.optional(),
    /** The automation (Automation). Absent: nothing is automated, and no key appears, so a bundle without it keeps its hash. */
    automation: Automation.optional(),
    /** Retired (RetiredMarket): a stored bundle's old play-credit market terms, read as written and never used. */
    market: RetiredMarket.optional(),
  })
  .superRefine((b, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const t = (s: string) => Date.parse(s);

    if (t(b.competition.opens_at) >= t(b.competition.deadline)) issue(['competition', 'deadline'], 'deadline must be after opens_at');
    // Hold-cash is the two replays' that rank on a net PnL in cash: the pump replay's and the bars
    // replay's (a bars race's prize bar, its universe one symbol). The rehearsal gate stays the pump
    // replay's own: the hindsight check it rehearses replays pump bots on sealed pump windows. The
    // baseline gate is every harness's, the pump replay's too (a net PnL above the best house bot's),
    // and a bundle names one prize bar of the two.
    if (b.prize_requires_beating_hold_cash === true && !(HOLD_CASH_KINDS as readonly HarnessKindT[]).includes(b.harness.kind)) {
      issue(['prize_requires_beating_hold_cash'], `beating hold-cash needs a ${HOLD_CASH_KINDS.join(' or ')} harness: only those replays rank on a net PnL in cash to hold cash against`);
    }
    if (b.prize_gate !== undefined) {
      const { kind, why } = PRIZE_GATE_HARNESS[b.prize_gate];
      if (b.harness.kind !== kind) issue(['prize_gate'], `the ${b.prize_gate} gate needs a ${kind} harness: ${why}`);
    }
    // A rehosted bounty (competition.rehost) and the accord gate come together, on a patch/v1 harness
    // grading the upstream's repo, paying one placement prize, place 1 (the entry the owner accepts),
    // its places never live: the owner reviews the ranked patches once the ranking phase is finalized.
    const rehost = b.competition.rehost;
    if (rehost === undefined) {
      if (b.prize_gate === 'accord') issue(['prize_gate'], 'the accord gate needs competition.rehost: the accord it waits on is the one rehost.accord_sha256 names');
    } else {
      if (b.harness.kind !== 'patch/v1') {
        issue(['competition', 'rehost'], `a rehosted bounty is graded by a patch/v1 harness, a patch to the upstream's repo: not ${b.harness.kind}`);
      } else if (b.harness.repo.url !== `https://github.com/${rehost.upstream.repo}`) {
        issue(['harness', 'repo', 'url'], `a rehosted bounty's harness grades the upstream's repo, https://github.com/${rehost.upstream.repo}: not ${b.harness.repo.url}`);
      }
      if (b.prize_gate !== 'accord') issue(['prize_gate'], "a rehosted bounty names prize_gate: accord: its prize waits on the upstream owner's accepted accord");
      const placed = b.prizes.filter((p) => p.kind === 'placement').map((p) => p.place);
      if (placed.length !== 1 || placed[0] !== 1) {
        const listed = placed.length === 0 ? 'it lists none' : `it lists place ${placed.join(', ')}`;
        issue(['prizes'], `a rehosted bounty lists exactly one placement prize, place 1, for the entry the upstream owner accepts: ${listed}`);
      }
      if (b.leaderboard.placements === 'live') {
        issue(['leaderboard', 'placements'], 'a rehosted bounty shows its placements after_finalize, never live: the upstream owner reviews the ranked patches before a winner is named');
      }
    }
    if (b.prize_requires_beating_baseline !== undefined && b.prize_requires_beating_hold_cash !== undefined) {
      issue(['prize_requires_beating_baseline'], 'a bundle gates its prizes on beating hold-cash or on beating the baseline, never both: drop prize_requires_beating_hold_cash');
    }

    // Sealed digests, on both harnesses that run programs of the bundle's own (program/v1, agent/v1):
    // all or nothing (each piece's exactly when the harness names that piece), and a scorer in a
    // directory of its own (at the root its digest would cover competition.yaml, which names it). An
    // instance-drawn harness (a generator) has no input or reference data of its own, is always
    // sealed, and keeps its generator apart from the root and from the scorer's directory. A pack
    // harness (ProgramPack) has none of its own either, its pack's trees each phase's, is always
    // sealed, and never draws instances besides. A judge harness (ProgramJudge) seals its judge
    // directory (judge_sha256, required), so it is always sealed too.
    if (b.harness.kind === 'program/v1') {
      const h = b.harness;
      const g = h.generator;
      const pack = h.pack;
      const scorerDir = scorerDirOf(h.scorer.entrypoint);
      const sealed = g !== undefined || pack !== undefined || h.judge !== undefined || SEALED_DIGEST_KEYS.some((k) => h[k] !== undefined);
      if (sealed) {
        const seals = (what: string) =>
          g !== undefined
            ? `an instance-drawn harness is sealed: it seals its ${what}`
            : pack !== undefined
              ? `a pack harness is sealed: it seals its ${what}`
              : h.judge !== undefined
                ? `a judge harness is sealed: it seals its ${what}`
                : `a sealed harness seals its ${what}`;
        if (h.scorer_sha256 === undefined) issue(['harness', 'scorer_sha256'], seals('scorer'));
        if (g !== undefined && h.generator_sha256 === undefined) issue(['harness', 'generator_sha256'], seals('generator'));
        if (g === undefined && pack === undefined && h.scorer.reference_data !== null && h.reference_sha256 === undefined) issue(['harness', 'reference_sha256'], seals('reference data'));
        if (g === undefined && pack === undefined && h.input_data !== null && h.input_sha256 === undefined) issue(['harness', 'input_sha256'], seals('input data'));
        if (scorerDir === '.') issue(['harness', 'scorer', 'entrypoint'], 'a sealed scorer lives in a directory of its own, not at the competition root');
      }
      if (h.input_data === null && h.input_sha256 !== undefined) issue(['harness', 'input_sha256'], 'there is no input_data to seal');
      if (h.scorer.reference_data === null && h.reference_sha256 !== undefined) issue(['harness', 'reference_sha256'], 'there is no reference_data to seal');
      if (g === undefined) {
        if (h.generator_sha256 !== undefined) issue(['harness', 'generator_sha256'], 'there is no generator to seal');
        if (pack === undefined && h.scorer.reference_data === null) {
          issue(['harness', 'scorer', 'reference_data'], 'reference_data is null only on an instance-drawn harness (one with a generator), whose instances supply it');
        }
      } else {
        if (h.input_data !== null) issue(['harness', 'input_data'], 'an instance-drawn harness takes its input data from each instance: input_data must be null');
        if (h.scorer.reference_data !== null) {
          issue(['harness', 'scorer', 'reference_data'], 'an instance-drawn harness takes its reference data from each instance: reference_data must be null');
        }
        for (const m of ownDirIssues('the generator', scorerDirOf(g.entrypoint), [{ name: 'scorer', dir: scorerDir }])) issue(['harness', 'generator', 'entrypoint'], m);
      }
      if (pack !== undefined) {
        if (g !== undefined) {
          issue(['harness', 'pack'], 'a pack harness grades each phase on its pack, and an instance-drawn harness (harness.generator) on the instances it draws: name a pack or a generator, never both');
        } else {
          const from = "a pack harness takes each phase's input and reference data from its pack (pack.dev, pack.final)";
          if (h.input_data !== null) issue(['harness', 'input_data'], `${from}: input_data must be null`);
          if (h.scorer.reference_data !== null) issue(['harness', 'scorer', 'reference_data'], `${from}: reference_data must be null`);
        }
        // Per case, the entry mounts only that case's input (PROGRAM_CASES), so it never reads the other
        // cases or the pack's salt; one run over the whole input tree would mount them all at /input.
        if (h.cases !== 'per-file') {
          issue(['harness', 'cases'], "a pack harness runs an entry once per case, with only that case's input mounted: over the whole input tree, the entry would read every case and the pack's salt at /input; name cases: per-file");
        }
      }
      // The input the entrant reads at /input is never the reference the scorer checks it against:
      // the same path, one inside the other, or one tree digest for both mounts the answer key at
      // /input (programDataApartIssues).
      for (const i of programDataApartIssues(h)) issue(i.path, i.message);
      // The gate, and the size count and timing heat that rank the entries passing it (programGateIssues).
      for (const i of programGateIssues({ harness: h, leaderboard: b.leaderboard })) issue(i.path, i.message);
      // The judge heat, the one ranking of the entries passing it (programJudgeIssues).
      for (const i of programJudgeIssues({ competition: b.competition, harness: h, leaderboard: b.leaderboard, prize_requires_beating_baseline: b.prize_requires_beating_baseline, prizes: b.prizes })) {
        issue(i.path, i.message);
      }
      // A final graded on an attached dataset (programFinalDatasetIssues), and a final phase for it to grade.
      for (const i of programFinalDatasetIssues(h)) issue(i.path, i.message);
      if (h.final_dataset === true && !b.phases.some((p) => p.key === 'final')) issue(['harness', 'final_dataset'], 'a final_dataset harness grades its final phase on the attached dataset, and the bundle has no final phase');
    }
    // 'judges' names the house's models as the judges: a house judge (ProgramHarness.judge) or a house
    // target (AgentHarness.target) the bundle names.
    const housed = (b.harness.kind === 'program/v1' && b.harness.judge !== undefined) || (b.harness.kind === 'agent/v1' && b.harness.target !== undefined);
    if (b.competition.resolution.method === 'judges' && !housed) {
      issue(['competition', 'resolution', 'method'], 'resolution.method judges names the house models as the judges, and the harness names none: a program/v1 judge (harness.judge) or an agent/v1 target (harness.target)');
    }
    // agent/v1 is sealed and instance-drawn by its shape (its three digests required, no input or
    // reference data of its own): what is left is its three programs, each in a directory of its own,
    // apart from the root and from one another, and its wall budget (AGENT_MAX_WALL_BUDGET_SEC).
    if (b.harness.kind === 'agent/v1') {
      const h = b.harness;
      const scorerDir = scorerDirOf(h.scorer.entrypoint);
      const generatorDir = scorerDirOf(h.generator.entrypoint);
      if (scorerDir === '.') issue(['harness', 'scorer', 'entrypoint'], 'a sealed scorer lives in a directory of its own, not at the competition root');
      const scorer = { name: 'scorer', dir: scorerDir };
      for (const m of ownDirIssues('the generator', generatorDir, [scorer])) issue(['harness', 'generator', 'entrypoint'], m);
      for (const m of ownDirIssues('the env', scorerDirOf(h.env.entrypoint), [scorer, { name: 'generator', dir: generatorDir }])) issue(['harness', 'env', 'entrypoint'], m);
      // Every trial mints a masq key for its wall budget: a budget that makes no key is refused here,
      // at load, not at the first trial's mint.
      if (b.limits.wall_budget_sec > AGENT_MAX_WALL_BUDGET_SEC) {
        issue(
          ['limits', 'wall_budget_sec'],
          `an agent/v1 trial's wall_budget_sec is at most ${AGENT_MAX_WALL_BUDGET_SEC} s (10 h), not ${b.limits.wall_budget_sec}: each trial's masq key lives 2 × the wall budget + 1 h, and masq refuses a key that lives 24 h or more`,
        );
      }
    }
    // scrape/v1 is sealed by its shape (scorer_sha256 required, no reference data of its own): what is
    // left is its scorer's directory, apart from the root, which competition.yaml (naming it) sits in.
    if (b.harness.kind === 'scrape/v1' && scorerDirOf(b.harness.scorer.entrypoint) === '.') {
      issue(['harness', 'scorer', 'entrypoint'], 'a sealed scorer lives in a directory of its own, not at the competition root');
    }
    // patch/v1 is sealed by its shape (contracts/patch.ts PatchHarness: its pack's trees, oracle and
    // witness by digest): what is left is the bundle around it (the header's patch/v1 paragraph).
    if (b.harness.kind === PATCH_HARNESS_KIND) {
      const keys = b.phases.map((p) => p.key).join(',');
      if (keys !== PATCH_PHASES.join(',')) {
        issue(['phases'], `a patch/v1 bundle runs a dev phase on the published tests, then a final on the hidden ones: its phases are ${PATCH_PHASES.join(' then ')}, not ${keys || 'none'}`);
      }
      b.phases.forEach((p, i) => {
        if (p.key === 'final' && p.scores !== 'after_finalize') {
          issue(['phases', i, 'scores'], 'a patch/v1 final grades sealed tests: its scores show after_finalize, never live, so no score reads out the hidden lists one entry at a time');
        }
      });
      const patchColumns = PATCH_SCORE_COLUMNS as readonly string[];
      b.leaderboard.columns.forEach((c, i) => {
        if (!patchColumns.includes(c.key)) issue(['leaderboard', 'columns', i, 'key'], `a patch/v1 column reads performance.scores: its key is one of ${PATCH_SCORE_COLUMNS.join(', ')}, not ${c.key}`);
        // Resolved entries tie on every patch column, so the earlier receipt wins: a column read from
        // anywhere else (a cost, a time) or computed would break that tie.
        if (c.source !== null && c.source !== `performance.scores.${c.key}`) {
          issue(['leaderboard', 'columns', i, 'source'], `a patch/v1 column reads performance.scores.${c.key} itself (source null), not ${c.source}`);
        }
        if (c.computation !== null) issue(['leaderboard', 'columns', i, 'computation'], 'a patch/v1 column is read, never computed');
      });
      if (!b.leaderboard.columns.some((c) => c.key === 'resolved')) {
        issue(['leaderboard', 'columns'], 'a patch/v1 leaderboard shows the gate: one column is resolved');
      }
      if (b.limits.wall_budget_sec > AGENT_MAX_WALL_BUDGET_SEC) {
        issue(['limits', 'wall_budget_sec'], `a patch/v1 grade's wall_budget_sec is at most ${AGENT_MAX_WALL_BUDGET_SEC} s (10 h), not ${b.limits.wall_budget_sec}`);
      }
      if (b.prize_gate !== undefined && b.prize_gate !== 'accord') {
        issue(['prize_gate'], "a patch/v1 bundle names no prize_gate but accord, a rehosted bounty's: its tests' gate is resolved, in the harness");
      }
    }
    // referral/v1 is checked by the referral contest's rules, never run (ReferralHarness): exactly a dev
    // phase then a final one (the final starting at or after the deadline is the phase rule above: the
    // 24-hour pause before the verdict), placement prizes alone, no baseline to beat, and every entry's
    // transcripts (its ad page is the thinking gate's entrypoint, server/entries/policy.ts).
    if (b.harness.kind === REFERRAL_HARNESS_KIND) {
      const keys = b.phases.map((p) => p.key).join(',');
      if (keys !== PHASE_KEYS.join(',')) {
        issue(['phases'], `a referral/v1 bundle runs a dev phase until the deadline, then a final phase from it (the 24-hour pause before its verdict): its phases are ${PHASE_KEYS.join(' then ')}, not ${keys || 'none'}`);
      }
      b.prizes.forEach((p, i) => {
        if (p.kind !== 'placement') issue(['prizes', i, 'kind'], 'a referral/v1 competition pays placement prizes alone: its verdict ranks the entries, and no build is priced beside it; drop the efficiency prize');
      });
      if (b.prize_requires_beating_baseline !== undefined) {
        issue(['prize_requires_beating_baseline'], 'a referral/v1 competition has no baseline to beat: its entries are checked by the referral rules, never run against a house baseline; drop prize_requires_beating_baseline');
      }
      if (!b.submission_rule.transcripts_required) {
        issue(['submission_rule', 'transcripts_required'], 'a referral/v1 entry is the ad page its transcripts built (index.html): set transcripts_required to true');
      }
    }

    // Phases: unique keys, dev before final, each window ordered, sequential and non-overlapping.
    const order = new Map(PHASE_KEYS.map((k, i) => [k, i]));
    b.phases.forEach((p, i) => {
      if (p.ends_at !== null && t(p.starts_at) >= t(p.ends_at)) issue(['phases', i, 'ends_at'], 'ends_at must be after starts_at');
      // Practice windows: the dev phase of a pump replay only, and in place of its one dataset.
      if (p.practice_windows !== undefined) {
        const at = ['phases', i, 'practice_windows'];
        if (p.key !== 'dev') issue(at, `practice_windows grade the dev phase's entries on several windows, and this is the ${p.key} phase: the final is one sealed window`);
        if (b.harness.kind !== 'pumpfun-replay/v2') issue(at, `practice_windows need a pumpfun-replay/v2 harness: only a pump replay is graded on masked windows (this is a ${b.harness.kind} harness)`);
        if (p.dataset !== null) issue(['phases', i, 'dataset'], `the practice windows replace the phase's dataset: set practice_windows or dataset (${p.dataset}), not both`);
      }
      if (i === 0) return;
      const prev = b.phases[i - 1]!;
      if (prev.key === p.key) issue(['phases', i, 'key'], `duplicate phase ${p.key}`);
      else if ((order.get(prev.key) ?? 0) > (order.get(p.key) ?? 0)) issue(['phases', i, 'key'], `${p.key} must not come before ${prev.key}`);
      if (prev.ends_at === null) issue(['phases', i - 1, 'ends_at'], 'only the last phase may be open-ended');
      else if (t(prev.ends_at) > t(p.starts_at)) issue(['phases', i, 'starts_at'], `${p.key} starts before ${prev.key} ends`);
    });

    // Leaderboard: unique keys and indexes, a real primary column, well-formed computations.
    const cols = b.leaderboard.columns;
    const indexes = new Set<number>();
    const keys = new Set<string>();
    cols.forEach((c, i) => {
      if (indexes.has(c.index)) issue(['leaderboard', 'columns', i, 'index'], `duplicate column index ${c.index}`);
      if (keys.has(c.key)) issue(['leaderboard', 'columns', i, 'key'], `duplicate column key ${c.key}`);
      indexes.add(c.index);
      keys.add(c.key);
    });
    if (!indexes.has(b.leaderboard.primary_index)) issue(['leaderboard', 'primary_index'], 'no column has this index');
    cols.forEach((c, i) => {
      const refs = c.computation_indexes ?? [];
      if (c.computation === null) {
        if (refs.length > 0) issue(['leaderboard', 'columns', i, 'computation_indexes'], 'computation_indexes need a computation');
        return;
      }
      if (refs.length < 1) issue(['leaderboard', 'columns', i, 'computation_indexes'], `${c.computation} needs computation_indexes`);
      for (const r of refs) {
        if (r === c.index) issue(['leaderboard', 'columns', i, 'computation_indexes'], 'a column cannot compute from itself');
        else if (!indexes.has(r)) issue(['leaderboard', 'columns', i, 'computation_indexes'], `no column has index ${r}`);
      }
      if (!isBaselineComputation(c.computation)) {
        // avg / avg_rank over a margin or a speedup: either waits on the gate, the gate on the rank
        // column, so a column computed from one can wait on itself (ranking.ts resolves the loop to nulls).
        for (const r of refs) {
          const ref = r === c.index ? undefined : cols.find((x) => x.index === r);
          if (ref !== undefined && isBaselineComputation(ref.computation)) {
            const what = ref.computation === 'speedup' ? 'speedup' : 'margin';
            issue(
              ['leaderboard', 'columns', i, 'computation_indexes'],
              `${c.computation} cannot read the ${ref.computation} column ${ref.key}: a ${what} is measured against the gate baseline, which the rank column sets, so a column computed from a ${what} waits on itself and resolves to nulls; compute from the raw column it measures instead`,
            );
          }
        }
        return;
      }
      // baseline_margin and speedup: one raw column measured against the gate baseline, so each needs
      // that gate; a positive margin, and a speedup above 1, beats the baseline, so each sorts desc;
      // and the gate is read from the rank column, so the rank column cannot be either.
      const kind = c.computation;
      if (refs.length > 1) issue(['leaderboard', 'columns', i, 'computation_indexes'], `${kind} takes exactly one computation_index: the raw column it measures`);
      const measured = refs.length === 1 && refs[0] !== c.index ? cols.find((x) => x.index === refs[0]) : undefined;
      if (measured !== undefined && measured.computation !== null) {
        issue(['leaderboard', 'columns', i, 'computation_indexes'], `${kind} measures a raw column, not the ${measured.computation} column ${measured.key}`);
      }
      if (c.sorting !== 'desc') {
        issue(['leaderboard', 'columns', i, 'sorting'], kind === 'speedup' ? 'a speedup column sorts desc: a speedup above 1 beats the baseline' : 'a baseline_margin column sorts desc: a positive margin beats the baseline');
      }
      if (c.index === b.leaderboard.primary_index) {
        issue(['leaderboard', 'primary_index'], `the rank column cannot be the ${kind} column ${c.key}: the gate baseline is read from the rank column`);
      }
      if (b.prize_requires_beating_baseline !== true) {
        issue(['leaderboard', 'columns', i, 'computation'], `a ${kind} column needs prize_requires_beating_baseline: true, the gate whose baseline it measures against`);
      }
    });
    // A replay has no scores.json: each raw column reads its score JSON by source path.
    if (isReplayKind(b.harness.kind)) {
      cols.forEach((c, i) => {
        if (c.computation === null && c.source === null) issue(['leaderboard', 'columns', i, 'source'], 'replay columns need a source path');
      });
    }
    // agent/v1 is aggregated on its scorer's points (agentLeaderboardIssues, the rule grader/agent-score.ts
    // agentColumns aggregates by): refused here, at load, before any trial spends. A primary index no
    // column has is the rule above's to report.
    if (b.harness.kind === 'agent/v1') {
      for (const i of agentLeaderboardIssues(b.leaderboard)) {
        if (i.code !== 'no_primary') issue(['leaderboard', ...i.path], i.message);
      }
    }
    // The tie-break column (Leaderboard.tie_break_index) orders exact rank-key ties only, so it is
    // another column than the rank key, shown, and raw: a computed column's order is its inputs'
    // (a baseline_margin column's the rank key's own). It reads the score, never the build, so a
    // later copy never overtakes what it copied by spending less; and on agent/v1 the scorer writes
    // it for every trial, as it writes the rank key.
    const tieBreak = b.leaderboard.tie_break_index;
    if (tieBreak !== undefined) {
      const tb = cols.find((c) => c.index === tieBreak);
      const at = ['leaderboard', 'tie_break_index'];
      if (tb === undefined) issue(at, 'no column has this index');
      else if (tieBreak === b.leaderboard.primary_index) issue(at, `the tie-break column cannot be the rank column ${tb.key}: it orders exact ties on the rank key`);
      else if (tb.computation === 'baseline_margin') issue(at, `the tie-break column cannot be the baseline_margin column ${tb.key}: a margin measures the rank column against the gate baseline, so it orders as the rank key does`);
      else if (tb.computation !== null) issue(at, `the tie-break column ${tb.key} is computed (${tb.computation}): a tie-break is a raw column, its order its own`);
      else if (tb.source !== null && readsBuildMetric(tb.source)) {
        issue(at, `the tie-break column ${tb.key} reads the build (${tb.source}): an exact tie never goes to the build, so a later copy cannot overtake what it copied by spending less`);
      } else if (b.harness.kind === 'agent/v1' && !isScoredColumn(tb)) {
        issue(at, `the tie-break column ${tb.key} is not a scored column: it ${unscoredHow(tb)}, and an agent/v1 tie-break is a column its scorer writes for every trial; point tie_break_index at a scored column (neither computation nor source)`);
      } else if (tb.hidden) issue(at, `the tie-break column ${tb.key} is hidden: the board shows the column its order reads`);
    }

    // A check reveal against the harness and the leaderboard (checkRevealIssues).
    for (const i of checkRevealIssues(b)) issue(i.path, i.message);

    // A staged agent/v1 final against the phases and the prizes (stagedFinalIssues).
    for (const i of stagedFinalIssues(b)) issue(i.path, i.message);

    // A build meter against the harness, the rank column and the prize rule (buildMeterIssues).
    for (const i of buildMeterIssues(b)) issue(i.path, i.message);

    // Prizes: one efficiency prize at most, unique places, and the pool adds up (a build meter's
    // allowance is not a prize: it is no part of the pool).
    const places = new Set<number>();
    let efficiency = 0;
    b.prizes.forEach((p, i) => {
      if (p.kind === 'efficiency') efficiency += 1;
      else if (p.place !== null) {
        if (places.has(p.place)) issue(['prizes', i, 'place'], `duplicate place ${p.place}`);
        places.add(p.place);
      }
    });
    if (efficiency > 1) issue(['prizes'], 'at most one efficiency prize');
    const cents = (n: number) => Math.round(n * 100);
    const total = b.prizes.reduce((sum, p) => sum + cents(p.amount_usd), 0);
    if (total !== cents(b.competition.reward_usd)) {
      issue(['competition', 'reward_usd'], `reward_usd ${b.competition.reward_usd} != sum of prizes ${total / 100}`);
    }
  });

export type CompetitionBundleT = z.infer<typeof CompetitionBundle>;

/**
 * The index of the phase a competition ranks and resolves on: final, else the last one (the bundle's
 * side of server/routes/admin/grading.ts rankingPhase).
 */
export function rankingPhaseIndex(phases: readonly Pick<PhaseT, 'key'>[]): number {
  const final = phases.findIndex((p) => p.key === 'final');
  return final === -1 ? phases.length - 1 : final;
}

/** The bundle's word on when placements show (Leaderboard.placements): after_finalize when it names none. */
export function placementsOf(b: { leaderboard: { placements?: PlacementsT } }): PlacementsT {
  return b.leaderboard.placements ?? 'after_finalize';
}

/** Whether the bundle turns the live feed on (Leaderboard.feed): false when it names none. */
export function liveFeedOf(b: { leaderboard: { feed?: true | undefined } }): boolean {
  return b.leaderboard.feed === true;
}

/**
 * The ranking phase's replay (PhaseReveal), or undefined when it has none or its reveal is a check
 * reveal (checkRevealOf): only the ranking phase is revealed.
 */
export function revealOf(b: { phases: readonly Pick<PhaseT, 'key' | 'reveal'>[] }): PhaseRevealT | undefined {
  const r = b.phases[rankingPhaseIndex(b.phases)]?.reveal;
  return r === undefined || isCheckReveal(r) ? undefined : r;
}

/**
 * The ranking phase's live race (PhaseRace), or null when it has none: only the ranking phase races
 * (the loader refuses a race on any other: server/competitions/load.ts raceIssues), so a race on
 * another phase of a bundle that has not been through the loader reads as none. Its window is
 * raceWindowOf's. The one definition every reader of a race goes through (the dev_profitable check,
 * the racer, the lifecycle).
 */
export function raceOf(b: { phases: readonly Pick<PhaseT, 'key' | 'race'>[] }): PhaseRaceT | null {
  return b.phases[rankingPhaseIndex(b.phases)]?.race ?? null;
}

/** A race window (raceWindowOf), epoch ms: the race runs from start_ms to end_ms. */
export interface RaceWindowT {
  start_ms: number;
  end_ms: number;
}

/**
 * A race's window, epoch ms, from its phase's dates (a bundle's ISO strings, or a phase row's Dates or
 * epoch ms): with `hours` (a pumpfun-replay/v2 race) [starts_at, starts_at + hours], whatever the phase's
 * ends_at (the phase runs on past it, to the frozen window's attach); without (bars-replay/v1)
 * [starts_at, ends_at], or null when the phase has no end. The one definition the loader, the racer,
 * the race view and the stall watch read a window through; that it fits inside the phase, and on what
 * grid, is the loader's (server/competitions/load.ts raceIssues).
 */
export function raceWindowOf(
  race: Pick<PhaseRaceT, 'hours'>,
  phase: { starts_at: string | Date | number; ends_at: string | Date | number | null },
): RaceWindowT | null {
  const ms = (v: string | Date | number) => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : v.getTime());
  const start_ms = ms(phase.starts_at);
  if (race.hours !== undefined) return { start_ms, end_ms: start_ms + race.hours * 3_600_000 };
  return phase.ends_at === null ? null : { start_ms, end_ms: ms(phase.ends_at) };
}

/** The ranking phase's check reveal (PhaseCheckReveal), or undefined when it has none or its reveal is a replay (revealOf). */
export function checkRevealOf(b: { phases: readonly Pick<PhaseT, 'key' | 'reveal'>[] }): PhaseCheckRevealT | undefined {
  const r = b.phases[rankingPhaseIndex(b.phases)]?.reveal;
  return r !== undefined && isCheckReveal(r) ? r : undefined;
}

/** The two harnesses whose runs are scored on columns a check reveal shows (PhaseCheckReveal). */
export const CHECK_REVEAL_KINDS = ['program/v1', 'agent/v1'] as const satisfies readonly HarnessKindT[];

/** What checkRevealIssues reads of a bundle. */
export interface CheckRevealBundle {
  harness: { kind: HarnessKindT };
  phases: readonly Pick<PhaseT, 'reveal'>[];
  leaderboard: {
    primary_index: number;
    tie_break_index?: number;
    columns: readonly Pick<LeaderboardColumnT, 'key' | 'index' | 'sorting' | 'computation' | 'source'>[];
  };
}

/**
 * A check reveal's rules against the rest of the bundle (PhaseCheckReveal), each at its path, in phase
 * order (none when they hold; the bundle's refinement reports them):
 *   - only program/v1 and agent/v1 (CHECK_REVEAL_KINDS) score the parts it shows: a replay harness's
 *     reveal is a replay (PhaseReveal, `speed`), and scrape/v1 ranks on time;
 *   - the rank column is a scored column (neither computation nor source: the scorer writes it, so the
 *     parts can be added up to it) that sorts desc (a shown total only rises as parts are shown);
 *   - each part is a scored leaderboard column other than the rank column;
 *   - the tie-break column (leaderboard.tie_break_index), when the bundle names one, is an open part:
 *     the final order breaks an exact tie on the rank key on it, so stage 1 shows every row's value
 *     there before stage 2 places any row, and a shown place stays final.
 * Whether the parts add up to the rank column is each score's to say: the plan checks it at the
 * reveal's start and, when one does not, publishes everything at once at the end (revealPlan).
 */
export function checkRevealIssues(b: CheckRevealBundle): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const cols = b.leaderboard.columns;
  const primary = cols.find((c) => c.index === b.leaderboard.primary_index);
  const tieBreak = b.leaderboard.tie_break_index === undefined ? undefined : cols.find((c) => c.index === b.leaderboard.tie_break_index);
  b.phases.forEach((p, i) => {
    const r = p.reveal;
    if (r === undefined || !isCheckReveal(r)) return;
    const at = ['phases', i, 'reveal'];
    if (!(CHECK_REVEAL_KINDS as readonly HarnessKindT[]).includes(b.harness.kind)) {
      out.push({
        path: at,
        message: `a check reveal shows the scored parts of a ${CHECK_REVEAL_KINDS.join(' or ')} run, and this is a ${b.harness.kind} harness: ${isReplayKind(b.harness.kind) ? 'a replay harness reveals by replaying its traces (reveal: {speed})' : 'drop reveal, and the phase publishes when it is finalized'}`,
      });
      return;
    }
    if (primary !== undefined) {
      if (!isScoredColumn(primary)) {
        out.push({ path: at, message: `the rank column ${primary.key} ${unscoredHow(primary)}: a check reveal adds its parts up to the rank column as the scorer wrote it, so the rank column is a scored column (neither computation nor source)` });
      } else if (primary.sorting !== 'desc') {
        out.push({ path: at, message: `the rank column ${primary.key} sorts asc: a check reveal's totals only rise as parts are shown, so its rank column sorts desc` });
      }
    }
    r.parts.forEach((part, j) => {
      const where = [...at, 'parts', j, 'key'];
      const col = cols.find((c) => c.key === part.key);
      if (col === undefined) out.push({ path: where, message: `no leaderboard column is keyed ${part.key}: a part is a scored column of the leaderboard` });
      else if (col === primary) out.push({ path: where, message: `${part.key} is the rank column: the parts add up to it, so it is none of them` });
      else if (!isScoredColumn(col)) out.push({ path: where, message: `the part ${part.key} ${unscoredHow(col)}: a part is a scored column the scorer writes (neither computation nor source)` });
    });
    if (tieBreak !== undefined && tieBreak !== primary) {
      const part = r.parts.findIndex((x) => x.key === tieBreak.key);
      const held = r.held.indexOf(tieBreak.key);
      const why = `the tie-break column ${tieBreak.key} orders an exact tie on the rank key, so stage 1 shows every row's value there before stage 2 places any row`;
      if (part === -1) out.push({ path: [...at, 'parts'], message: `${why}: it must be one of the open parts (in parts, not held), summed into the rank column like every part` });
      else if (held !== -1) out.push({ path: [...at, 'held', held], message: `${why}: keep it open (out of held)` });
    }
  });
  return out;
}

/** What stagedFinalIssues reads of a bundle. */
export interface StagedFinalBundle {
  harness: HarnessT;
  phases: readonly Pick<PhaseT, 'key' | 'reveal'>[];
  prizes: readonly Pick<PrizeT, 'kind' | 'place' | 'amount_usd'>[];
  leaderboard: { primary_index: number; columns: readonly Pick<LeaderboardColumnT, 'key' | 'index' | 'sorting'>[] };
}

/**
 * A staged final's rules against the rest of the bundle (AgentTrialsConfig.staged), each at its path
 * (none when they hold, or when the final is not staged; the bundle's refinement reports them):
 *   - the bundle has a final phase: the staging is the final's;
 *   - contenders is at least the last paid place (the highest placement place paying above 0), so
 *     every paid place goes to a contender;
 *   - the earlier cuts (cuts) run in order: their instances rise strictly, each at most
 *     final_instances - 1 (the finalists' cut sends contenders on to all of them), and their
 *     contenders fall strictly, each more than contenders (the finalists are the fewest);
 *   - practice_floor needs a dev phase, whose practice scores it reads;
 *   - practice_floor needs a rank column (leaderboard.primary_index) that sorts desc: the dev gate
 *     (server/entries/stage.ts practiceFloorCheck) admits a practice score at or above the floor,
 *     which reads backwards where a lower score ranks first. contenders alone fits either sorting
 *     (server/grading/final-cut.ts orders by the rank column's own);
 *   - the final phase has no check reveal yet: server/live/resolver.ts falls back when its order
 *     differs from the standings', which a cut entry's single trial would make it.
 */
export function stagedFinalIssues(b: StagedFinalBundle): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const staged = stagedFinalOf(b);
  if (staged === null) return out;
  const at = ['harness', 'trials', 'staged'];
  const final = b.phases.findIndex((p) => p.key === 'final');
  if (final === -1) out.push({ path: at, message: 'a staged final stages the final phase, and the bundle has no final phase: add one, or drop staged' });
  let lastPaid = 0;
  for (const p of b.prizes) {
    if (p.kind === 'placement' && p.place !== null && p.amount_usd > 0 && p.place > lastPaid) lastPaid = p.place;
  }
  if (staged.contenders < lastPaid) {
    out.push({
      path: [...at, 'contenders'],
      message: `contenders (${staged.contenders}) is at least the last paid place, ${lastPaid}: every paid place goes to a contender, an entry that ran every final instance`,
    });
  }
  const cuts = staged.cuts ?? [];
  const K = staged.final_instances;
  for (const [i, c] of cuts.entries()) {
    const prev = i > 0 ? cuts[i - 1]! : null;
    if (prev !== null && c.instances <= prev.instances) {
      out.push({
        path: [...at, 'cuts', i, 'instances'],
        message: `cuts[${i}].instances (${c.instances}) is more than cuts[${i - 1}].instances (${prev.instances}): each cut's contenders run more scored instances than the cut before's`,
      });
    }
    if (c.instances > K - 1) {
      out.push({
        path: [...at, 'cuts', i, 'instances'],
        message: `cuts[${i}].instances (${c.instances}) is at most final_instances - 1, ${K - 1}: the finalists' cut sends contenders on to all ${K}, so an earlier cut stops before them`,
      });
    }
    if (prev !== null && c.contenders >= prev.contenders) {
      out.push({
        path: [...at, 'cuts', i, 'contenders'],
        message: `cuts[${i}].contenders (${c.contenders}) is fewer than cuts[${i - 1}].contenders (${prev.contenders}): each cut sends fewer entries on than the cut before`,
      });
    }
    if (c.contenders <= staged.contenders) {
      out.push({
        path: [...at, 'cuts', i, 'contenders'],
        message: `cuts[${i}].contenders (${c.contenders}) is more than contenders (${staged.contenders}): the finalists are the fewest, so every earlier cut sends more entries on`,
      });
    }
  }
  if (staged.practice_floor !== null && !b.phases.some((p) => p.key === 'dev')) {
    out.push({ path: [...at, 'practice_floor'], message: 'practice_floor is the least practice score an entry needs to enter the final, and the bundle has no dev phase to practise on: add a dev phase, or drop practice_floor' });
  }
  // A missing rank column is the leaderboard rule's to report (no_primary), so only a found one is read.
  const rank = b.leaderboard.columns.find((c) => c.index === b.leaderboard.primary_index);
  if (staged.practice_floor !== null && rank !== undefined && rank.sorting === 'asc') {
    out.push({
      path: [...at, 'practice_floor'],
      message: `practice_floor is the least practice score an entry needs, and the rank column ${rank.key} sorts asc (lower is better): a floor fits a column that sorts desc; drop practice_floor`,
    });
  }
  if (final !== -1) {
    const r = b.phases[final]!.reveal;
    if (r !== undefined && isCheckReveal(r)) {
      out.push({
        path: ['phases', final, 'reveal'],
        message: "a staged final has no check reveal yet: the reveal's order would differ from the standings', a cut entry ranked on its one trial, and the resolver falls back to publishing everything at once; drop reveal, or drop staged",
      });
    }
  }
  return out;
}

/** Whether the bundle opts in to the automation job (automation.lifecycle: true). */
export function automatesLifecycle(b: { automation?: AutomationT }): boolean {
  return b.automation?.lifecycle === true;
}

/** How the competition's prizes are paid (Automation.payouts): 'manual' unless its automation names 'auto'. */
export function payoutModeOf(b: { automation?: AutomationT }): PayoutModeT {
  return b.automation?.payouts ?? 'manual';
}

/** Whether the competition's escrow is funded when it opens (Automation.escrow 'at_open'). */
export function escrowsAtOpen(b: { automation?: AutomationT }): boolean {
  return b.automation?.escrow === 'at_open';
}
export type CompetitionBundleInput = z.input<typeof CompetitionBundle>;
export type LeaderboardColumnT = z.infer<typeof LeaderboardColumn>;
export type PhaseT = z.infer<typeof Phase>;
export type PrizeT = z.infer<typeof Prize>;
export type BuildMeterT = z.infer<typeof BuildMeter>;
export type EntryFeeT = z.infer<typeof EntryFee>;
export type HarnessT = z.infer<typeof Harness>;
export type ProgramHarnessT = z.infer<typeof ProgramHarness>;
export type ProgramPackT = z.infer<typeof ProgramPack>;
export type ProgramSizeT = z.infer<typeof ProgramSize>;
export type ProgramTimingT = z.infer<typeof ProgramTiming>;
export type ProgramJudgeT = z.infer<typeof ProgramJudge>;
export type ProgramJudgeLadderT = z.infer<typeof ProgramJudgeLadder>;
export type ProgramJudgeScreenedT = z.infer<typeof ProgramJudgeScreened>;
export type HouseAgentT = z.infer<typeof HouseAgent>;
export type JudgePoolEntryT = z.infer<typeof JudgePoolEntry>;
export type JudgeAgentT = z.infer<typeof JudgeAgent>;
export type AgentHarnessT = z.infer<typeof AgentHarness>;
export type ScrapeHarnessT = z.infer<typeof ScrapeHarness>;
export type ReferralHarnessT = z.infer<typeof ReferralHarness>;
export type AgentEntryCapsT = z.infer<typeof AgentEntryCaps>;
export type AgentInferenceT = z.infer<typeof AgentInference>;
export type AgentTargetT = z.infer<typeof AgentTarget>;
export type CategoryT = z.infer<typeof Category>;
export type ResolutionT = z.infer<typeof Resolution>;
