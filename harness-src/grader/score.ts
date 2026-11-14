// The score JSON a run stores (contracts/score.ts Score) and its hash. Its performance is a pure
// function of (dataset, canonical action log); cost of the priced usage lines; authorship of the
// snapshot and transcripts (computed upstream, passed as its summary); under a size count, the code
// size of the snapshot (grader/size.ts, computed upstream too). Around those it records the
// facts of the execution that produced the action log (harness version, image digest, dataset
// digest, seed, whether both executions agreed, the flags they raised) and the facts of the entry
// (house, baseline) its eligibility depends on. No ids, no wall-clock times: an L1 regrade fed the
// same inputs and facts rebuilds it byte for byte (canonical JSON, sim/canonical.ts).
//
// agent/v1 (grader/agent-score.ts) runs as K trials, its action log the trials manifest and its seed
// the phase's u64 seed: it is deterministic exactly when every trial's replay matched, so a single
// nondeterministic trial makes the run nondeterministic (listed, unranked), and its facts must say so
// (buildScore). A timeout counts, as 0 on every column, and keeps the run ranked.
//
// scrape/v1 (grader/scrape/score.ts) runs as a heat of timed trials, its action log the run's trials
// manifest (contracts/scrape.ts ScrapeTrials): every listed trial its sealed scorer judged twice to
// byte-equal scores.json (a run whose scorer disagreed with itself on any trial is never scored:
// grader/worker.ts records it failed, unpublished), so a scored run is deterministic. More than `trim`
// trials that are not correct leave it no time_ms: it did not finish, listed and never ranked, as the
// board (server/routes/competitions/ranking.ts) and the standings read it.
//
// referral/v1 (contracts/competition.ts ReferralHarness) executes nothing: its action log is the entry's sign-up
// evidence (ReferralActionLog: every sign-up bound in the contest window, whether the contest's verdict counted it
// and why not), and its performance is that log's count of counted sign-ups. The score is a pure function of those
// bytes, so an L1 regrade re-derives it exactly; its cost, seed and dataset are constants of the kind
// (REFERRAL_COST, REFERRAL_SEED, REFERRAL_DATASET_SHA256), and its eligibility is the entry's facts alone
// (referralEligibility): ranked, and paid unless the entry is the house's own or a baseline.
//
// Eligibility (reasons are machine-readable; every false carries at least one):
//   ranked               both executions produced byte-equal action logs (agent/v1: and no trial is
//                        nondeterministic; scrape/v1: its scorer agreed with itself on every trial)
//                                                                             else `nondeterministic`;
//                        and a scrape/v1 run has a time_ms                    else `did_not_finish`;
//                        and a timed program/v1 run's outputs were the graded ones in every run of
//                        its timing heat                                      else `timing_outputs_differ`;
//                        and, under a build meter (`metered` below), a metered cost: the meter
//                        vouched for the entry and priced it (cost.provenance metered, cost.micro_usd
//                        not null)                    else `cost_unmetered` and/or `cost_unpriced`, said
//                        among the efficiency reasons below. The rank key of a metered bundle is that
//                        cost, so an entry without one is listed and never ranked, in any view: it
//                        takes no cost rank, no place and no prize
//   prize_eligible       ranked, not a house entry (`house`), not a baseline (`baseline`), a replay's
//                        guardrails met (`non_compliant`: the pump replay's constraints, the bars
//                        replay's and the clmm replay's alike, each score's constraints.compliant; a
//                        clmm entry's is its in-range share at or above min_in_range_share), a
//                        program/v1 entry through its harness's gate (`failed_tests`,
//                        contracts/score.ts FAILED_TESTS_REASON: performance.passed false because the
//                        gate column says 0; one the column passes but the run cannot stand behind is
//                        unranked, its passed false and its reason its own) and past its pass count
//                        (`failed_tests` too: no case passed, below), a patch/v1 entry by resolving
//                        (`failed_tests`: performance.passed false, below), transcripts present when
//                        the competition requires them (`no_transcripts`), and, when the competition
//                        sets prize_requires_beating_hold_cash, a pump or bars replay's positive net
//                        PnL (`below_hold_cash`: net_pnl_lamports, net_pnl_quote_units, above 0 after
//                        every fee): a losing entry keeps its rank and takes no prize; and
//                        when it sets prize_requires_efficiency, efficiency_eligible (below), whose
//                        reasons already say why it is not
//   gate                 a program/v1 harness naming a gate (contracts/competition.ts
//                        ProgramHarness.gate: EligibilityRules.gate, eligibilityRulesOf) makes the
//                        score's performance.passed: true when its scores.json wrote 1 in the gate
//                        column and the run is ranked, false when 0 or when the run is not ranked
//                        (its own standing: a build meter's unranking, above, moves no pass)
//                        (nondeterministic: two executions that disagree passed nothing the house can
//                        stand behind, so what reads passed alone, first to pass, the payouts and the
//                        board's compliantOf, never sees a pass); anything else in the column (null,
//                        any other number) is the scorer's fault, a ScorerError (program-scores.ts),
//                        never scored. One that did not pass keeps its listing, and the board tiers it
//                        below every one that did (server/routes/competitions/ranking.ts compliantOf).
//                        A patch/v1 harness's gate is `resolved` alone (contracts/patch.ts
//                        PatchHarness.gate, EligibilityRules.gate too), and its performance.passed is
//                        that column whatever the run's standing (PatchPerformance binds the two: a
//                        run not ranked keeps it, unranked for its own reason): one that did not
//                        resolve (refused, a listed test failed, or its canaries caught tampering:
//                        grader/patch/score.ts) is `failed_tests`, no prize
//   pass count           a program/v1 harness naming a pass count (contracts/competition.ts
//                        ProgramHarness.pass_count: EligibilityRules.pass_count, eligibilityRulesOf; a
//                        Best test score bounty's, which has no gate) pays only an entry that passed at
//                        least one case: one whose scores.json holds no count of 1 or more in that column
//                        (0: it passed none) is `failed_tests`, neither prize- nor efficiency-eligible. It
//                        keeps its listing, and its performance is as the scorer wrote it (no passed); the
//                        board tiers it below every entry that passed a case by that reason
//                        (server/routes/competitions/ranking.ts compliantOf)
//   size                 a program/v1 harness naming a size count (ProgramHarness.size:
//                        EligibilityRules.size) makes every score carry the entry's code size
//                        (Score.size, grader/size.ts codeSize over its snapshot, ScoredInputs.size) at
//                        the count's version, and a score under none carries none: a size missing, extra
//                        or at another version is the caller's TypeError, never a score without its rank key
//   timing               a program/v1 harness naming a timing heat (ProgramHarness.timing:
//                        EligibilityRules.timing) takes the heat's verdict on an entry that passed its
//                        gate (ScoredInputs.timing, grader/code-heat.ts codeHeatVerdicts): its timing,
//                        which the score carries at performance.timing (the rank key,
//                        trimmed_mean_cpu_us), or TIMING_OUTPUTS_DIFFER, a timed run whose outputs were
//                        not the graded ones, which leaves the run unranked (that reason; passed false, so
//                        the board tiers it below every entry that passed). No verdict (the heat has not
//                        run yet, or the entry did not pass) is no timing. A verdict on an entry that did not
//                        pass, or under no timing heat, is the caller's TypeError
//   metered              a bundle with a build meter (contracts/competition.ts BuildMeter:
//                        EligibilityRules.metered, eligibilityRulesOf) prices every entry on what the
//                        house's masq meter saw (grader/metered.ts meteredCostOf, through
//                        grader/entry-cost.ts): an entry whose cost the meter did not vouch for
//                        (cost.provenance other than metered: a usage line of its transcripts no
//                        metered request matches, a session reporting no usage, or no transcript at
//                        all) is `cost_unmetered` (contracts/score.ts COST_UNMETERED_REASON), and is
//                        neither ranked (above), prize- nor efficiency-eligible. Under no meter no
//                        score carries the reason, and every eligibility is what it was
//   efficiency_eligible  prize_eligible, an authorship summary (`no_authorship`) at or above the
//                        competition's min_authored_coverage (`coverage_below_gate`), a fully priced
//                        cost (`cost_unpriced`: cost.micro_usd null, which cost.ts also makes it for
//                        an entry with no priced usage or a transcript session reporting none), under
//                        a build meter a metered one (`cost_unmetered`, said right after
//                        `cost_unpriced`), no
//                        partial usage line (`partial_usage_lines`) and no inconsistent one
//                        (`inconsistent_usage_lines`), as the rules promise, and for a pump replay a
//                        positive net PnL, i.e. beating the hold-cash baseline (`below_hold_cash`).
//                        A bars replay is held to hold-cash only under prize_requires_beating_hold_cash
//                        (a bars race's prize bar), so every bars score built without it keeps its
//                        bytes; otherwise a bars, clmm or agent/v1 competition gates its prizes on its
//                        published baseline, on the primary column, when ranking
//                        (server/payouts/baseline.ts)
// `below_hold_cash` is listed last whichever flag it clears. On a pump replay the prize rule moves
// prize_eligible and nothing else: the reasons are the same with the rule and without it. On a bars
// replay the rule adds the reason and clears both flags (efficiency_eligible is prize_eligible and
// more). prize_requires_efficiency alike moves prize_eligible alone (to efficiency_eligible's verdict),
// never a reason.
// Flags: the scorer's own (fee_fallback, chain_warnings) and the execution's (wall_budget_over_half,
// killed_after_done, nonzero_exit_after_done), plus `nondeterministic`; sorted, unique.
//
// Practice windows (contracts/competition.ts Phase.practice_windows): a dev phase that grades on N masked
// windows scores each window as above, on its own, and aggregateEras folds the N Scores into the grade's:
// the median window's Score (sorted by (net_pnl_lamports, key), index floor(N / 2)), its performance.eras
// listing every window's figures (contracts/score.ts ReplayEras), so the rank key is the median window's net
// PnL, its guardrails (eligibility) are that window's own, never required of every window, and its dataset,
// seed and action log are that window's. A window that is not ranked ends the whole: the aggregate is that
// window's own unranked Score (the first by key), its reasons and flags saying why. It is ONE function, the
// server's and grade-local's alike, so a grade's result_sha256 is the same wherever it is computed.
// erasManifest is the per-window list a regrade checks: what each window was graded on and came to.

import { z } from 'zod';
import {
  PRACTICE_WINDOWS_MAX,
  PRACTICE_WINDOWS_MIN,
  practiceWindowKeys,
  transcriptsRequired,
  type CompetitionBundleT,
  type HARNESS_KINDS,
  type ProgramSizeT,
  type ProgramTimingT,
} from '../contracts/competition.ts';
import { FIXED9_SCALE, parseFixed9 } from '../contracts/primitives.ts';
import { divHalfEven } from '../contracts/scrape.ts';
import {
  COST_UNMETERED_REASON,
  FAILED_TESTS_REASON,
  ProgramTimingScore,
  ReplayEras,
  Score,
  SCORE_SCHEMA,
  type AuthorshipSummaryT,
  type CostT,
  type EligibilityT,
  type EraWindowT,
  type PerformanceT,
  type ProgramTimingScoreT,
  type ReplayErasT,
  type ReplayMetricsT,
  type ScoreSizeT,
  type ScoreT,
} from '../contracts/score.ts';
import { canonicalJson, compareCodeUnits, sha256Hex } from '../sim/canonical.ts';
import { SimAbortError } from '../sim/engine.ts';
import { agentDeterministic } from './agent-score.ts';
import { ScorerError } from './program-scores.ts';

/** What the execution and the entry contribute besides the scored inputs. */
export interface ScoreFacts {
  harness: { kind: (typeof HARNESS_KINDS)[number]; version: string };
  /** `sha256:<hex>` of the entry's image (null for the process driver). */
  image_digest: string | null;
  dataset_sha256: string | null;
  seed: string;
  /** Both executions' canonical action logs were byte-equal. */
  deterministic: boolean;
  /** Flags the execution raised (sorted or not; they are normalized). */
  execution_flags: readonly string[];
  house: boolean;
  baseline: boolean;
}

/** The competition rules a score is built under: those eligibility reads, the gate that makes performance.passed, and the size count. */
export interface EligibilityRules {
  /** 0..1 (bundle min_authored_coverage). */
  min_authored_coverage: number;
  transcripts_required: boolean;
  /**
   * Bundle prize_requires_beating_hold_cash: a pump or bars replay entry with net PnL <= 0 is not
   * prize-eligible. Absent or false: beating hold-cash gates a pump replay's efficiency_eligible
   * alone, and a bars replay's nothing.
   */
  prize_requires_beating_hold_cash?: boolean;
  /**
   * Bundle prize_requires_efficiency: a placement prize needs efficiency_eligible. Absent or false:
   * efficiency gates the efficiency view alone.
   */
  prize_requires_efficiency?: boolean;
  /**
   * A program/v1 harness's gate (contracts/competition.ts ProgramHarness.gate): the scored column whose
   * 1 or 0 makes performance.passed (the header's `gate`). Absent: no gate, and no passed. A patch/v1
   * harness's (contracts/patch.ts PatchHarness.gate) is always `resolved`, the column its passed already is.
   */
  gate?: string;
  /**
   * A program/v1 harness's pass count (contracts/competition.ts ProgramHarness.pass_count): the scored column
   * counting the cases an entry passed, a prize needing 1 or more there (the header's `pass count`). Absent: no bar.
   */
  pass_count?: string;
  /**
   * A program/v1 harness's size count (contracts/competition.ts ProgramHarness.size): every score built
   * under it carries the entry's code size (ScoredInputs.size) at its version. Absent: no size count,
   * and a score carries no size.
   */
  size?: ProgramSizeT;
  /**
   * A program/v1 harness's timing heat (contracts/competition.ts ProgramHarness.timing): a score built under it
   * may carry the heat's verdict (ScoredInputs.timing). Absent: no heat, and a verdict is the caller's TypeError.
   */
  timing?: ProgramTimingT;
  /**
   * The bundle has a build meter (contracts/competition.ts BuildMeter, the header's `metered`): an entry ranks only on a
   * metered cost, and one the meter did not vouch for is `cost_unmetered`. Absent: no meter, and no score carries it.
   */
  metered?: boolean;
}

// ---------------------------------------------------------------- referral/v1's action log

/** The version of a referral/v1 action log (ReferralActionLog): one, until its shape moves. */
export const REFERRAL_ACTION_LOG_VERSION = 1;

/**
 * A referral/v1 entry's action log, which IS its evidence snapshot (contracts/score.ts referral/v1): the entrant's
 * sign-ups bound inside the contest's window, each with whether the referral contest's verdict counted it and, when it
 * did not, why. The score is a pure function of it (the header): a referral/v1 run executes nothing, so its log is not
 * produced by an execution but read from the stored facts, and an L1 regrade re-derives the same score from the same
 * bytes. `verified_signups` is exactly the entries marked counted; a log whose count disagrees with its entries is
 * refused (the writer does not build one, and a stored one that does is not evidence).
 */
export const ReferralActionLog = z
  .strictObject({
    version: z.literal(REFERRAL_ACTION_LOG_VERSION),
    /** The entry's submitter: the referrer whose sign-ups the log lists. */
    referrer_user_id: z.string().min(1),
    /** Every referral of the referrer bound in [competition.opens_at, competition.deadline], in binding order. */
    signups: z.array(
      z.strictObject({
        referral_id: z.string().min(1),
        /** Whether the referral contest's verdict counted it (verified). An undecided one never counts. */
        counted: z.boolean(),
        /** Why it does not count; null for one that does. */
        why: z.string().nullable(),
      }),
    ),
    /** How many of `signups` counted: the score's verified count. */
    verified_signups: z.int().min(0),
  })
  .superRefine((log, ctx) => {
    const counted = log.signups.filter((s) => s.counted).length;
    if (log.verified_signups !== counted) {
      ctx.addIssue({ code: 'custom', path: ['verified_signups'], message: `the log says ${log.verified_signups} verified sign-ups and ${counted} of its ${log.signups.length} entries are counted` });
    }
  });
export type ReferralActionLogT = z.infer<typeof ReferralActionLog>;

/** A stored referral/v1 action log, parsed and held to its shape; a ZodError when it is no log (grader/regrade.ts regradeReferralL1). */
export function referralActionLogOf(value: unknown): ReferralActionLogT {
  return ReferralActionLog.parse(value);
}

/**
 * The performance a referral/v1 action log counts: the entries marked counted and the entries in all. It is the only
 * place the score's referral figures come from, so the same log always builds the same performance (and the same score).
 */
export function referralPerformanceOf(log: ReferralActionLogT): Extract<PerformanceT, { kind: 'referral/v1' }> {
  return { kind: 'referral/v1', scores: { verified_signups: log.signups.filter((s) => s.counted).length, signups: log.signups.length } };
}

/**
 * The dataset_sha256 every referral/v1 run records. The kind runs on no dataset; one constant digest names its metric's
 * definition, so every run of a phase records the same data digest and a phase with no dataset attached still yields a
 * result (server/payouts/onchain.ts resultDatasetSha256, server/chain/verify.ts datasetSha256Of), while a regrade holds
 * its run to it (grader/regrade.ts regradeReferralL1).
 */
export const REFERRAL_DATASET_SHA256 = sha256Hex('referral/v1');

/** The seed every referral/v1 run records: nothing is drawn or executed, so a constant keeps the score a function of the log alone. */
export const REFERRAL_SEED = '0';

/** The cost every referral/v1 run stores: no transcript is priced for the kind (its score is the count alone). */
export const REFERRAL_COST: CostT = {
  pricing_rev: 'referral/v1',
  micro_usd: '0',
  priced_micro_usd: '0',
  lines: 0,
  unpriced_lines: 0,
  partial_lines: 0,
  inconsistent_lines: 0,
  tokens: { input: '0', output: '0', cache_read: '0', cache_write_5m: '0', cache_write_1h: '0', reasoning: '0' },
  models: [],
  provenance: 'none',
};

/** The reason a timed program/v1 run is unranked (the header's `timing`): a run of its heat wrote other outputs than its grade. */
export const TIMING_OUTPUTS_DIFFER = 'timing_outputs_differ';

/** How many runs time a passing entry in a phase with no heat (the dev phase's provisional timing, grader/code-heat.ts). */
export const CODE_TIMING_DEV_ROUNDS = 3;

/**
 * A timing heat's verdict on an entry that passed its gate (grader/code-heat.ts codeHeatVerdicts, runProvisionalTiming):
 * its timing, or TIMING_OUTPUTS_DIFFER.
 */
export type TimingVerdictT = ProgramTimingScoreT | typeof TIMING_OUTPUTS_DIFFER;

/**
 * The rules a score is built under, from the competition bundle: what every grade, regrade and verify
 * of that competition must score under. Each optional rule is named only when the bundle sets it. The
 * transcript rule is the bundle's under the deployment's switch (MAKEFUN_TRANSCRIPTS_REQUIRED), so a
 * regrade or verify of a deployment that turned it off must run with it off too.
 */
export function eligibilityRulesOf(
  bundle: Pick<CompetitionBundleT, 'min_authored_coverage' | 'submission_rule' | 'prize_requires_beating_hold_cash' | 'prize_requires_efficiency' | 'harness' | 'build_meter'>,
): EligibilityRules {
  const rules: EligibilityRules = { min_authored_coverage: bundle.min_authored_coverage, transcripts_required: transcriptsRequired(bundle.submission_rule) };
  if (bundle.prize_requires_beating_hold_cash === true) rules.prize_requires_beating_hold_cash = true;
  if (bundle.prize_requires_efficiency === true) rules.prize_requires_efficiency = true;
  if (bundle.harness.kind === 'program/v1' && bundle.harness.gate !== undefined) rules.gate = bundle.harness.gate;
  if (bundle.harness.kind === 'patch/v1') rules.gate = bundle.harness.gate;
  if (bundle.harness.kind === 'program/v1' && bundle.harness.pass_count !== undefined) rules.pass_count = bundle.harness.pass_count;
  if (bundle.harness.kind === 'program/v1' && bundle.harness.size !== undefined) rules.size = { count: bundle.harness.size.count, version: bundle.harness.size.version };
  if (bundle.harness.kind === 'program/v1' && bundle.harness.timing !== undefined) rules.timing = { ...bundle.harness.timing };
  if (bundle.build_meter !== undefined) rules.metered = true;
  return rules;
}

/**
 * Whether a program/v1 run passed its harness's gate: its scores.json's `gate` column is 1 (passed) or 0
 * (did not). Any other value, null or a missing column included, is the scorer's fault: ScorerError.
 */
export function gatePassed(scores: Readonly<Record<string, number | null>>, gate: string): boolean {
  const v = Object.hasOwn(scores, gate) ? scores[gate] : undefined;
  if (v === 1) return true;
  if (v === 0) return false;
  throw new ScorerError(`scores.json's gate column ${gate} is ${v === undefined ? 'missing' : JSON.stringify(v)}: the gate is 1 when an entry passes and 0 when it does not, nothing else`);
}

/**
 * Whether a program/v1 run passed at least one case under a harness's pass count (the header's `pass count`): its
 * scores.json's `passCount` column is 1 or more. 0 (it passed none), null or no column at all is no case passed.
 */
export function passedACase(scores: Readonly<Record<string, number | null>>, passCount: string): boolean {
  const v = Object.hasOwn(scores, passCount) ? scores[passCount] : undefined;
  return typeof v === 'number' && v >= 1;
}

export interface ScoredInputs {
  action_log_sha256: string;
  performance: PerformanceT;
  /** Flags the scorer raised. */
  performance_flags: readonly string[];
  cost: CostT;
  authorship: AuthorshipSummaryT | null;
  /**
   * The entry's code size (grader/size.ts codeSize over its snapshot and the kit's starter), given
   * exactly when the rules name a size count (EligibilityRules.size) and at its version.
   */
  size?: ScoreSizeT;
  /**
   * The timing heat's verdict on the entry (the header's `timing`), given only under a timing heat
   * (EligibilityRules.timing) and only for an entry that passed its gate; absent while it has none.
   */
  timing?: TimingVerdictT;
  /**
   * A referral/v1 run's action log (ReferralActionLog), given exactly under a referral/v1 harness: the performance it
   * carries is the log's count (referralPerformanceOf), and buildScore refuses a performance that is not.
   */
  referral_log?: ReferralActionLogT;
}

/** A 0..1 share as Fixed9-scaled BigInt (rounded to the nearest 1e-9). */
export function shareToFixed9(share: number): bigint {
  if (!Number.isFinite(share) || share < 0 || share > 1) throw new RangeError(`share ${share} is outside 0..1`);
  return BigInt(Math.round(share * Number(FIXED9_SCALE)));
}

/**
 * Where a run stands before any rule of the entry's: deterministic (both executions agreed, and for
 * agent/v1 every trial's replay matched) and finished (a scrape/v1 run with more than `trim` trials
 * not correct has no rank key: it did not finish) and, under a timing heat, timed on its own outputs (no
 * run of its heat wrote other outputs than its grade: the verdict is not TIMING_OUTPUTS_DIFFER). Ranked is
 * all three: eligibility's `ranked` (which a build meter further holds to a metered cost), and what a gate's
 * pass needs (gatedPerformance).
 */
function standingOf(facts: Pick<ScoreFacts, 'deterministic'>, perf: PerformanceT, timing: TimingVerdictT | undefined): { deterministic: boolean; finished: boolean; reproduced: boolean; ranked: boolean } {
  const deterministic = facts.deterministic && (perf.kind !== 'agent/v1' || agentDeterministic(perf));
  const finished = perf.kind !== 'scrape/v1' || perf.scores.time_ms !== null;
  const reproduced = timing !== TIMING_OUTPUTS_DIFFER;
  return { deterministic, finished, reproduced, ranked: deterministic && finished && reproduced };
}

/**
 * A score's eligibility (the header): `inputs.timing` is the timing heat's verdict, when there is one (the header's
 * `timing`); TIMING_OUTPUTS_DIFFER leaves the run unranked with that reason. Under a build meter (rules.metered, the
 * header's `metered`) a cost the meter did not vouch for is `cost_unmetered`, and an entry without a metered cost
 * (unvouched or unpriced) is unranked, its reasons those of its cost. The standing a gate's pass reads (standingOf) is
 * the run's own and never the meter's: the meter moves eligibility alone, never performance.passed.
 */
export function eligibility(
  facts: Pick<ScoreFacts, 'deterministic' | 'house' | 'baseline'>,
  inputs: Pick<ScoredInputs, 'performance' | 'cost' | 'authorship'> & Partial<Pick<ScoredInputs, 'timing'>>,
  rules: EligibilityRules,
): EligibilityT {
  const reasons: string[] = [];
  const perf = inputs.performance;
  const standing = standingOf(facts, perf, inputs.timing);
  const { deterministic, finished, reproduced } = standing;
  // Under a build meter the rank key is the metered cost: an entry without one ranks nowhere (the header's `ranked`).
  const unmetered = rules.metered === true && inputs.cost.provenance !== 'metered';
  const ranked = standing.ranked && !(rules.metered === true && (unmetered || inputs.cost.micro_usd === null));
  if (!deterministic) reasons.push('nondeterministic');
  if (!finished) reasons.push('did_not_finish');
  if (!reproduced) reasons.push(TIMING_OUTPUTS_DIFFER);

  let prize = ranked;
  if (facts.house) {
    prize = false;
    reasons.push('house');
  }
  if (facts.baseline) {
    prize = false;
    reasons.push('baseline');
  }
  if ((perf.kind === 'pumpfun-replay/v2' || perf.kind === 'bars-replay/v1' || perf.kind === 'clmm-replay/v1') && !perf.metrics.constraints.compliant) {
    prize = false;
    reasons.push('non_compliant');
  }
  // A program/v1 entry that did not pass its harness's gate (the header's `gate`) because its tests
  // failed: the gate column is not 1. One the column passes has passed false only for not being ranked
  // (gatedPerformance), and that reason is already said.
  if (perf.kind === 'program/v1' && perf.passed === false && (rules.gate === undefined || perf.scores[rules.gate] !== 1)) {
    prize = false;
    reasons.push(FAILED_TESTS_REASON);
  }
  // A program/v1 entry that passed no case under a harness counting them (the header's `pass count`): a prize needs one.
  if (perf.kind === 'program/v1' && rules.pass_count !== undefined && !passedACase(perf.scores, rules.pass_count)) {
    prize = false;
    if (!reasons.includes(FAILED_TESTS_REASON)) reasons.push(FAILED_TESTS_REASON);
  }
  // A patch/v1 entry that did not resolve (the header's `gate`): refused, a listed test failed, or its canaries caught
  // tampering. Its passed is scores.resolved whatever its standing, so a run not ranked that resolved is not this.
  if (perf.kind === 'patch/v1' && !perf.passed) {
    prize = false;
    reasons.push(FAILED_TESTS_REASON);
  }
  if (rules.transcripts_required && inputs.cost.provenance === 'none') {
    prize = false;
    reasons.push('no_transcripts');
  }

  let efficiency = prize;
  const a = inputs.authorship;
  if (a === null) {
    efficiency = false;
    reasons.push('no_authorship');
  } else if (a.authored_coverage === null || parseFixed9(a.authored_coverage) < shareToFixed9(rules.min_authored_coverage)) {
    efficiency = false;
    reasons.push('coverage_below_gate');
  }
  if (inputs.cost.micro_usd === null) {
    efficiency = false;
    reasons.push('cost_unpriced');
  }
  // Under a build meter, a cost the meter did not vouch for in full (the header's `metered`).
  if (unmetered) {
    efficiency = false;
    reasons.push(COST_UNMETERED_REASON);
  }
  if (inputs.cost.partial_lines > 0) {
    efficiency = false;
    reasons.push('partial_usage_lines');
  }
  if (inputs.cost.inconsistent_lines > 0) {
    efficiency = false;
    reasons.push('inconsistent_usage_lines');
  }
  if (perf.kind === 'pumpfun-replay/v2' && BigInt(perf.metrics.net_pnl_lamports) <= 0n) {
    if (rules.prize_requires_beating_hold_cash === true) prize = false;
    efficiency = false;
    reasons.push('below_hold_cash');
  }
  // A bars replay is held to hold-cash only under the rule (the header's `prize_eligible`), so a bars
  // score built without it is what it always was, byte for byte.
  if (perf.kind === 'bars-replay/v1' && rules.prize_requires_beating_hold_cash === true && BigInt(perf.metrics.net_pnl_quote_units) <= 0n) {
    prize = false;
    efficiency = false;
    reasons.push('below_hold_cash');
  }
  // A placement prize behind efficiency: efficiency_eligible's reasons already say why it is not.
  if (rules.prize_requires_efficiency === true && !efficiency) prize = false;
  return { ranked, prize_eligible: prize, efficiency_eligible: efficiency, reasons };
}

/**
 * A referral/v1 score's eligibility (the header's referral/v1): ranked (the count was read and recorded, and nothing
 * ran that could disagree or fail: a stored run is nondeterministic only if its record says so), and paid unless the
 * entry is the house's own (`house`) or a baseline (`baseline`). No cost, authorship, transcripts or gate rule reaches
 * it: a referral entry is its ad page and its count, and the kind prices nothing, runs nothing and gates on nothing.
 */
function referralEligibility(facts: Pick<ScoreFacts, 'deterministic' | 'house' | 'baseline'>): EligibilityT {
  const reasons: string[] = [];
  if (!facts.deterministic) reasons.push('nondeterministic');
  if (facts.house) reasons.push('house');
  if (facts.baseline) reasons.push('baseline');
  const ranked = facts.deterministic;
  const prize = ranked && !facts.house && !facts.baseline;
  return { ranked, prize_eligible: prize, efficiency_eligible: prize, reasons };
}

/**
 * The score JSON, validated against contracts/score.ts. A bars or clmm performance whose lookahead
 * audit failed (contamination.no_future_bars false), or a pump replay's whose did (no_future_events
 * false), is the engine's fault, never the entry's: it throws SimAbortError, a harness fault the job
 * retries (grade.ts), and is never scored. An agent/v1 performance (grader/agent-score.ts aggregateTrials) is
 * scored from its trials, its action_log_sha256 the trials manifest's: facts.deterministic must be
 * what its trials say (every replay matched, agentDeterministic), so the run's status and its
 * score's eligibility never disagree; anything else is the caller's TypeError. A program/v1
 * performance under a gate (rules.gate) is scored with performance.passed (gatedPerformance: false
 * whenever the run is not ranked), a gate column holding anything but 0 or 1 a ScorerError. Under a
 * size count (rules.size) the score carries inputs.size (sizeOf: the caller's TypeError when it is
 * missing, at another version, or given under no size count). Under a timing heat (rules.timing) the
 * heat's verdict (inputs.timing, timingOf) puts its timing at performance.timing, or leaves the run
 * unranked (TIMING_OUTPUTS_DIFFER); a verdict on an entry that did not pass its gate, under no heat, or
 * beside a performance carrying a timing of its own, is the caller's TypeError.
 */
export function buildScore(facts: ScoreFacts, inputs: ScoredInputs, rules: EligibilityRules, scorerVersion: string): ScoreT {
  if (inputs.performance.kind === 'bars-replay/v1' && !inputs.performance.metrics.contamination.no_future_bars) {
    throw new SimAbortError('the bars replay failed its lookahead audit (no_future_bars is false): an engine fault, never scored');
  }
  if (inputs.performance.kind === 'clmm-replay/v1' && !inputs.performance.metrics.contamination.no_future_bars) {
    throw new SimAbortError('the clmm replay failed its lookahead audit (no_future_bars is false): an engine fault, never scored');
  }
  if (inputs.performance.kind === 'pumpfun-replay/v2' && !inputs.performance.metrics.contamination.no_future_events) {
    throw new SimAbortError('the pump replay failed its lookahead audit (no_future_events is false): an engine fault, never scored');
  }
  if (inputs.performance.kind !== facts.harness.kind) throw new TypeError(`performance is ${inputs.performance.kind}, harness is ${facts.harness.kind}`);
  // A referral/v1 score is scored from its action log alone (the header): the performance it carries must be exactly
  // what the log counts, so no caller can score a figure the evidence does not hold.
  if (inputs.performance.kind === 'referral/v1') {
    if (inputs.referral_log === undefined) throw new TypeError('a referral/v1 score is built from its action log: ScoredInputs.referral_log');
    const derived = referralPerformanceOf(inputs.referral_log);
    if (canonicalJson(derived) !== canonicalJson(inputs.performance)) {
      throw new TypeError(`the referral/v1 performance is not what its action log counts: it says ${canonicalJson(inputs.performance)}, the log ${canonicalJson(derived)}`);
    }
  }
  if (inputs.performance.kind === 'agent/v1') {
    const perf = inputs.performance;
    if (facts.deterministic !== agentDeterministic(perf)) {
      const n = perf.trials.filter((t) => t.status === 'nondeterministic').length;
      throw new TypeError(
        `facts.deterministic is ${facts.deterministic}, but ${n} of the run's ${perf.trials.length} trials are nondeterministic: an agent/v1 run is deterministic exactly when every trial's replay matched`,
      );
    }
  }
  const size = sizeOf(inputs.performance, inputs.size, rules);
  const timing = timingOf(facts, inputs.performance, inputs.timing, rules);
  const gated = gatedPerformance(inputs.performance, rules, standingOf(facts, inputs.performance, timing).ranked);
  // Present only with a measured timing: no key appears otherwise, so such a score keeps its bytes.
  const performance = timing === undefined || timing === TIMING_OUTPUTS_DIFFER ? gated : { ...gated, timing };
  const flags = new Set<string>([...inputs.performance_flags, ...facts.execution_flags]);
  if (!facts.deterministic) flags.add('nondeterministic');
  return Score.parse({
    schema: SCORE_SCHEMA,
    harness: { kind: facts.harness.kind, version: facts.harness.version },
    scorer_version: scorerVersion,
    image_digest: facts.image_digest,
    dataset_sha256: facts.dataset_sha256,
    action_log_sha256: inputs.action_log_sha256,
    seed: facts.seed,
    performance,
    cost: inputs.cost,
    authorship: inputs.authorship,
    // A referral/v1 entry's standing is its count's: nothing about it is nondeterministic, gated, priced or authored,
    // so its eligibility is the entry's facts alone (referralEligibility) and never the program/v1 rules'.
    eligibility: inputs.performance.kind === 'referral/v1' ? referralEligibility(facts) : eligibility(facts, { ...inputs, performance, ...(timing === undefined ? {} : { timing }) }, rules),
    flags: [...flags].sort(compareCodeUnits),
    // Absent under no size count: no key appears, so such a score keeps its bytes.
    ...(size === undefined ? {} : { size }),
  });
}

/**
 * The timing heat's verdict a score is built with (the header's `timing`): undefined with none given. Given, it needs a
 * timing heat (rules.timing) over a program/v1 harness with a gate, an entry that passed it (its gate column 1, the run
 * deterministic and finished: the heat times only those), and a timing over the dev phase's CODE_TIMING_DEV_ROUNDS runs,
 * the heat's main rounds, or its main and playoff rounds. A verdict beside a performance naming a timing of its own is
 * refused (one timing per score); a performance naming one with no verdict is as it is, held to the contract by Score.
 * Anything else is the caller's TypeError.
 */
function timingOf(facts: Pick<ScoreFacts, 'deterministic'>, performance: PerformanceT, verdict: TimingVerdictT | undefined, rules: Pick<EligibilityRules, 'gate' | 'timing'>): TimingVerdictT | undefined {
  if (verdict === undefined) return undefined;
  if (performance.kind === 'program/v1' && performance.timing !== undefined) {
    throw new TypeError('a timing verdict was given, and the performance names a timing of its own: a score takes one timing, the heat\'s (ScoredInputs.timing)');
  }
  if (rules.timing === undefined) throw new TypeError('a timing verdict was given, but the harness names no timing heat: a score carries one only under a program/v1 timing heat');
  if (performance.kind !== 'program/v1') throw new TypeError(`a timing heat is a program/v1 harness's, but performance is ${performance.kind}`);
  if (rules.gate === undefined) throw new TypeError('a timing heat times the entries that pass a gate, and the harness names none');
  const { deterministic, finished } = standingOf(facts, performance, undefined);
  if (!gatePassed(performance.scores, rules.gate) || !deterministic || !finished) {
    throw new TypeError(`a timing verdict was given for an entry that did not pass its gate (${rules.gate}${deterministic ? '' : ', nondeterministic'}): the heat times only those that pass`);
  }
  if (verdict === TIMING_OUTPUTS_DIFFER) return verdict;
  const parsed = ProgramTimingScore.safeParse(verdict);
  if (!parsed.success) throw new TypeError(`the timing is not one: ${parsed.error.issues[0]?.message ?? 'malformed'}`);
  const t = rules.timing;
  const allowed = [CODE_TIMING_DEV_ROUNDS, t.rounds, t.rounds + t.playoff_rounds];
  if (!allowed.includes(parsed.data.rounds)) {
    throw new TypeError(`the timing is over ${parsed.data.rounds} runs, and this heat times ${t.rounds} (${t.rounds + t.playoff_rounds} with its playoff), or ${CODE_TIMING_DEV_ROUNDS} provisionally`);
  }
  return parsed.data;
}

/**
 * The code size a score carries (the header's `size`): `size` under a size count (rules.size), given
 * for a program/v1 performance at the count's version; undefined under none, where none may be given.
 * Anything else is the caller's TypeError.
 */
function sizeOf(performance: PerformanceT, size: ScoreSizeT | undefined, rules: Pick<EligibilityRules, 'size'>): ScoreSizeT | undefined {
  if (rules.size === undefined) {
    if (size !== undefined) throw new TypeError('a code size was given, but the harness names no size count: a score carries one only under a program/v1 size count');
    return undefined;
  }
  if (performance.kind !== 'program/v1') throw new TypeError(`a size count is a program/v1 harness's, but performance is ${performance.kind}`);
  if (size === undefined) {
    throw new TypeError(`the harness counts the entry's code (${rules.size.count} v${rules.size.version}), but no size was given: count it over the entry's snapshot (grader/size.ts codeSize)`);
  }
  if (size.version !== rules.size.version) throw new TypeError(`the code size was counted at version ${size.version}, but the harness's size count is version ${rules.size.version}`);
  return size;
}

/**
 * The performance a score carries: under a program/v1 harness's gate (rules.gate) with performance.passed
 * made from its column (gatePassed; the header's `gate`) and the run's standing: true only when the
 * column says 1 and the run is `ranked` (deterministic, finished and, under a timing heat, not
 * TIMING_OUTPUTS_DIFFER: eligibility's ranked, but for a build meter's hold on it), else false.
 * Without a gate, as it is. A performance already naming passed must name what the column and the
 * standing say (TypeError otherwise). A patch/v1 performance always names passed, its gate column
 * itself (`resolved`) whatever the standing (contracts/patch.ts PatchPerformance): as it is, once
 * the gate's column says what its passed does (TypeError otherwise).
 */
export function gatedPerformance(performance: PerformanceT, rules: Pick<EligibilityRules, 'gate'>, ranked = true): PerformanceT {
  if (performance.kind === 'patch/v1' && rules.gate !== undefined) {
    const column = gatePassed(performance.scores, rules.gate);
    if (performance.passed !== column) throw new TypeError(`performance.passed is ${performance.passed}, but the gate column ${rules.gate} says ${column}`);
    return performance;
  }
  if (performance.kind !== 'program/v1' || rules.gate === undefined) return performance;
  const column = gatePassed(performance.scores, rules.gate);
  const passed = column && ranked;
  if (performance.passed !== undefined && performance.passed !== passed) {
    const why = column && !ranked ? `the gate column ${rules.gate} passes it, but the run is not ranked` : `the gate column ${rules.gate} says ${column}`;
    throw new TypeError(`performance.passed is ${performance.passed}, but ${why}: passed is ${passed}`);
  }
  return { ...performance, passed };
}

/** The canonical JSON a run stores and its sha256 (run.result_sha256). */
export function scoreDigest(score: ScoreT): { json: string; sha256: string } {
  const json = canonicalJson(score);
  return { json, sha256: sha256Hex(json) };
}

// ---------------------------------------------------------------- practice windows (the eras aggregate)

/** One practice window of a dev grade: its key (w1..w<N>) and the Score its own replay came to (buildScore). */
export interface EraWindowScore {
  key: string;
  score: ScoreT;
}

/** What a window was graded on and came to, the per-window list a regrade checks (erasManifest). */
export interface EraManifestEntry {
  key: string;
  dataset_sha256: string;
  seed: string;
  action_log_sha256: string;
  result_sha256: string;
}

/** A window's pump replay metrics; a window of any other harness, or one carrying eras of its own, is no window. */
function eraMetrics(w: EraWindowScore): ReplayMetricsT {
  const p = w.score.performance;
  if (p.kind !== 'pumpfun-replay/v2') throw new TypeError(`window ${w.key} is a ${p.kind} score: practice windows are a pumpfun-replay/v2 dev phase's`);
  if (p.eras !== undefined) throw new TypeError(`window ${w.key} carries eras of its own: a window is one replay, the aggregate is the grade's`);
  return p.metrics;
}

/**
 * The windows in key order, checked: an odd number of 3..9 (a single replay is no aggregate: the N=1 shape is the
 * phase's plain grade), keyed exactly w1..w<N>, each a pump replay Score with a dataset, and all of one harness
 * and scorer. A TypeError otherwise: the caller built the wrong set.
 */
function orderedEraWindows(windows: readonly EraWindowScore[]): EraWindowScore[] {
  const n = windows.length;
  if (n < PRACTICE_WINDOWS_MIN || n > PRACTICE_WINDOWS_MAX || n % 2 === 0) {
    throw new TypeError(`${n} practice windows: the dev phase grades on an odd count of ${PRACTICE_WINDOWS_MIN} to ${PRACTICE_WINDOWS_MAX}, so the median is one window's own`);
  }
  const keys = practiceWindowKeys(n);
  const byKey = new Map(windows.map((w) => [w.key, w]));
  const ordered = keys.map((key) => byKey.get(key));
  if (byKey.size !== n || ordered.some((w) => w === undefined)) {
    throw new TypeError(`practice windows are keyed ${keys.join(', ')}; got ${windows.map((w) => w.key).join(', ')}`);
  }
  const out = ordered as EraWindowScore[];
  const first = out[0]!.score;
  for (const w of out) {
    eraMetrics(w);
    if (w.score.dataset_sha256 === null) throw new TypeError(`window ${w.key} names no dataset: a practice window is graded on one`);
    if (canonicalJson(w.score.harness) !== canonicalJson(first.harness) || w.score.scorer_version !== first.scorer_version) {
      throw new TypeError(`window ${w.key} was scored by a different harness or scorer than ${out[0]!.key}: one grade's windows are scored alike`);
    }
  }
  return out;
}

/** The per-window manifest entries of `windows` (already checked, in key order). */
function manifestOf(windows: readonly EraWindowScore[]): EraManifestEntry[] {
  return windows.map((w) => ({
    key: w.key,
    dataset_sha256: w.score.dataset_sha256!,
    seed: w.score.seed,
    action_log_sha256: w.score.action_log_sha256,
    result_sha256: scoreDigest(w.score).sha256,
  }));
}

/**
 * The canonical per-window list of a dev grade, in key order: what each window was graded on (dataset, seed),
 * the action log it produced and the digest of its own Score. The same entries performance.eras opens each
 * window with, so a regrade rebuilds it from the stored runs and compares (erasManifestOf reads the stored side).
 */
export function erasManifest(windows: readonly EraWindowScore[]): EraManifestEntry[] {
  return manifestOf(orderedEraWindows(windows));
}

/** The manifest a stored ReplayEras carries: its windows' first five fields, in key order. */
export function erasManifestOf(eras: ReplayErasT): EraManifestEntry[] {
  return eras.windows.map((w) => ({ key: w.key, dataset_sha256: w.dataset_sha256, seed: w.seed, action_log_sha256: w.action_log_sha256, result_sha256: w.result_sha256 }));
}

/**
 * A dev grade's Score from its N practice windows' (`hours` each, the phase's practice_windows.hours): the
 * median window's own Score, sorted by (net_pnl_lamports, key) and taken at index floor(N / 2), with
 * performance.eras listing every window (contracts/score.ts ReplayEras). The mean is half-even, in_profit counts
 * the windows above 0 and compliant_windows those meeting the guardrails; the Score's eligibility is the median
 * window's alone (the guardrail tier follows it), and its flags, cost and authorship are that window's.
 *
 * When any window is not ranked (it did not finish, or its two runs disagreed), the grade is not ranked:
 * the first such window's own Score, by key, which carries its reasons and flags and no eras. Windows that
 * are not an odd 3..9, keyed w1..w<N>, pump replay Scores with datasets, scored alike, are a TypeError.
 */
export function aggregateEras(windows: readonly EraWindowScore[], hours: number): ScoreT {
  if (!Number.isInteger(hours) || hours < 1) throw new TypeError(`hours ${hours}: a practice window is a whole number of hours, 1 or more`);
  const ordered = orderedEraWindows(windows);
  const failing = ordered.find((w) => !w.score.eligibility.ranked);
  if (failing !== undefined) return failing.score;

  const rows = ordered.map((w) => {
    const metrics = eraMetrics(w);
    return { w, metrics, net: BigInt(metrics.net_pnl_lamports) };
  });
  const ranked = [...rows].sort((a, b) => (a.net < b.net ? -1 : a.net > b.net ? 1 : compareCodeUnits(a.w.key, b.w.key)));
  const median = ranked[Math.floor(ranked.length / 2)]!;
  const sum = rows.reduce((acc, r) => acc + r.net, 0n);
  const mean = sum < 0n ? -divHalfEven(-sum, BigInt(rows.length)) : divHalfEven(sum, BigInt(rows.length));
  const manifest = manifestOf(ordered);
  const eraWindows: EraWindowT[] = rows.map((r, i) => ({
    ...manifest[i]!,
    net_pnl_lamports: r.metrics.net_pnl_lamports,
    fills: r.metrics.fills,
    distinct_mints: r.metrics.distinct_mints,
    max_drawdown: r.metrics.max_drawdown,
    compliant: r.metrics.constraints.compliant,
  }));
  const eras = ReplayEras.parse({
    aggregate: 'median',
    count: rows.length,
    hours,
    rank_window: median.w.key,
    windows: eraWindows,
    median_net_pnl_lamports: median.metrics.net_pnl_lamports,
    mean_net_pnl_lamports: mean.toString(),
    worst_net_pnl_lamports: ranked[0]!.metrics.net_pnl_lamports,
    best_net_pnl_lamports: ranked[ranked.length - 1]!.metrics.net_pnl_lamports,
    in_profit: rows.filter((r) => r.net > 0n).length,
    compliant_windows: eraWindows.filter((w) => w.compliant).length,
  });
  const performance = median.w.score.performance as Extract<PerformanceT, { kind: 'pumpfun-replay/v2' }>;
  return { ...median.w.score, performance: { ...performance, eras } };
}

/** JSON paths at which two JSON values differ (for a regrade's report), at most `max`. */
export function jsonDifferences(a: unknown, b: unknown, max = 20, path = '$'): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, p: string): void => {
    if (out.length >= max) return;
    if (x === y) return;
    const xo = typeof x === 'object' && x !== null;
    const yo = typeof y === 'object' && y !== null;
    if (!xo || !yo || Array.isArray(x) !== Array.isArray(y)) {
      if (canonicalJson(x ?? null) !== canonicalJson(y ?? null)) out.push(p);
      return;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) {
        out.push(`${p}.length`);
        return;
      }
      x.forEach((v, i) => walk(v, y[i], `${p}[${i}]`));
      return;
    }
    const xr = x as Record<string, unknown>;
    const yr = y as Record<string, unknown>;
    const keys = new Set([...Object.keys(xr), ...Object.keys(yr)]);
    for (const k of [...keys].sort(compareCodeUnits)) {
      if (!Object.hasOwn(xr, k) || !Object.hasOwn(yr, k)) {
        if (out.length < max) out.push(`${p}.${k}`);
      } else walk(xr[k], yr[k], `${p}.${k}`);
    }
  };
  walk(a, b, path);
  return out;
}
