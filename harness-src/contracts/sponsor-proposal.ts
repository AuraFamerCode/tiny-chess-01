// A sponsor's proposal: the part of a competition bundle (./competition.ts) a sponsor writes when
// proposing a competition paid from their own wallet. server/proposals/compose.ts composes it with
// the house's values into a CompetitionBundleT, deterministically, and that bundle then passes the
// one validator every competition passes (server/competitions/load.ts validateBundle and
// bundleIssues). server/proposals/checks.ts runs the checks.
//
// Templates only (owner decision 2, as the owner was told): the harness is a choice from the
// house's scoring templates (server/proposals/templates.ts: pumpfun-replay, solana-bars-1h,
// solana-clmm-lp), a dataset window the template accepts, a metric it ranks by and its bounded knobs. A sponsor never uploads a scorer, reference data or
// input data, so the house never runs a sponsor's code and no sponsor writes the rubric. When no
// template fits, the sponsor writes a plain-language scoring brief instead (CustomScoringProposal:
// scoring.custom; for a code bounty with its code kind, contracts/code-kinds.ts, and runtimes) and the
// make.fun team finishes the setup by attaching a template and its knobs
// (server/routes/admin/proposals.ts); only then is it composed and funded. Two templates are the team's
// alone (code-tests, CodeTestsChoice: a code bounty's objective, runtimes and the hidden test pack the
// team writes from the brief; judged-artifact, JudgedArtifactChoice: the judge's persona, the medium and
// its caps from the brief, and the judge model, anchors and calibrated ladder the team sets): the contract parses
// each, so a proposal the team set up checks and composes as any, but a sponsor never names one
// (server/routes/sponsor.ts refuses it on create and edit).
//
//   The sponsor writes   the title, summary, description, rules, category (one the template fits)
//                        and skills; competition.duration_hours, how long entries stay open;
//                        competition.placements, whether scores and places show while it runs; the
//                        template choice; the submission rule's max_per_day, max_total and
//                        strategy_note_required; the placement prizes; and on a Cheapest to build
//                        bounty (code-cheapest) alone, its build allowance (allowance_usd);
//                        optionally, an entry fee each account pays once into the escrow, where it
//                        joins the pot (entry_fee_usd: the bundle's entry_fee); and, optionally, a
//                        challenge window for its escrow longer than the house's 24 hours
//                        (escrow.challenge_hours, ProposalEscrow)
//   The house sets       every date, from duration_hours (server/proposals/schedule.ts houseDates),
//                        on every save and checks pass and at the team's finish of a setup, until
//                        the deposit: competition.opens_at, the deadline and the final phase's
//                        window. A sponsor need not write them, and any written are replaced, never
//                        refused, so a downloaded proposal round-trips (one written with dates and
//                        no duration_hours is refused naming duration_hours, never a date)
//   The house fills      the version; status draft and visibility internal (approval lists it); a
//                        sponsor-namespaced slug; the sponsor; reward_usd (the prizes' sum); the
//                        dev phase (opens_at to the deadline) and both phases' datasets (the house
//                        attaches the windows it collects); the template's harness block, leaderboard
//                        and sandbox limits, and its prize rule (pumpfun-replay: beat holding cash;
//                        solana-bars-1h and solana-clmm-lp: beat the house baselines; code-tests and
//                        judged-artifact: none past its gate, and code-cheapest an efficiency-eligible
//                        build); the rest
//                        of the submission rule (transcripts_required true, house_only false, Force_Last
//                        but on code-first, Force_Best with max_total at most 30, an OSI license, a
//                        repository created after the opening); min_authored_coverage 0 (no
//                        efficiency prize; code-cheapest 0.8); code-cheapest's build meter (the
//                        sponsor's allowance, and each entrant's share of it and the models its build
//                        key may call: the setup's CodeTestsChoice.build, else the house's defaults);
//                        and the resolution panel, with a deterministic tie-break
//
// The build allowance is not a prize: it pays for the entrants' metered build keys (contracts/
// competition.ts BuildMeter), so it is no part of reward_usd or the escrow's pot; the house holds it and
// owes back what the keys did not spend. Its bounds are the proposal checks' (server/proposals/checks.ts),
// as every amount's is: PROPOSAL_CAPS counts characters and items only.
//
// Strict: a key the house fills is refused, never ignored, and so is any upload (a scorer, reference
// or input data, or a digest of one). Placement prizes only (an escrow pays nothing else). Every
// instant is whole seconds, as the escrow program counts them. zod and the pure registry only, no
// Node APIs.
//
// No string anywhere in a proposal carries a make.fun API key (`af_` and 64 letters,
// ../transcripts/api-key.ts holdsMakefunApiKey, the pattern every caller-text ingest refuses a key by):
// proposalApiKeyIssue names the first, at its path, and both schemas refuse it there (refuseApiKeys), so
// proposal_schema fails and nothing composes, deposits or publishes with it. A proposal's text is read by
// the make.fun team and, once approved, by everyone, and whoever reads the key acts as the sponsor's account.

import { z } from 'zod';
import { CODE_KIND_IDS, CODE_KINDS, codeKindRuntimesFit, isCodeKindId, OFFERED_CODE_KIND_IDS, type CodeKindIdT, type CodeKindT } from './code-kinds.ts';
import {
  BuildKeyModels,
  BuildKeyShareUsd,
  Category,
  EntryFeeUsd,
  HouseAgent,
  PLACEMENTS,
  PROGRAM_JUDGE_MIN_ANCHORS,
  ProgramPack,
  Runtime,
  RUNTIMES,
  SPONSOR_JUDGE_MEDIA,
  UsdAmount,
  type CODABENCH_SUBMISSION_RULES,
} from './competition.ts';
import { holdsMakefunApiKey, MAKEFUN_API_KEY_WHAT } from '../transcripts/api-key.ts';
import { IsoDateTime, Sha256Hex } from './primitives.ts';
import {
  CODE_TESTS,
  CODE_TESTS_ID,
  isUploadKey,
  JUDGED_ARTIFACT,
  JUDGED_ARTIFACT_ID,
  JUDGED_ARTIFACT_MAX_ANCHORS,
  JUDGED_ARTIFACT_MAX_RUNGS,
  JUDGED_ARTIFACT_PROMPT_MAX,
  orList,
  PUMPFUN_REPLAY,
  PUMPFUN_REPLAY_DATASET_IDS,
  PUMPFUN_REPLAY_ID,
  PUMPFUN_REPLAY_METRIC_IDS,
  SOLANA_BARS,
  SOLANA_BARS_DATASET_IDS,
  SOLANA_BARS_ID,
  SOLANA_BARS_METRIC_IDS,
  SOLANA_CLMM,
  SOLANA_CLMM_DATASET_IDS,
  SOLANA_CLMM_ID,
  SOLANA_CLMM_METRIC_IDS,
  SPONSOR_PICKABLE_TEMPLATE_IDS,
  uploadKeysIn,
  type TemplateChoiceT,
} from '../server/proposals/templates.ts';

export const SPONSOR_PROPOSAL_VERSION = 1;

/** Size caps on what a sponsor writes (characters, or items for skills and prizes). */
export const PROPOSAL_CAPS = Object.freeze({
  title: 120,
  summary: 280,
  description: 16_000,
  rules: 32_000,
  skill: 40,
  skills: 12,
  prize_title: 80,
  prizes: 10,
  max_per_day: 100,
  max_total: 10_000,
});

/** Size caps on a custom scoring brief (characters): what wins and how to judge it, at least a sentence; its worked examples. */
export const SCORING_BRIEF_CAPS = Object.freeze({ brief_min: 40, brief: 4_000, examples: 8_000 });

/** The most a proposal's canonical JSON may weigh, in bytes (well under the competition file's 256 KiB). */
export const MAX_PROPOSAL_BYTES = 128 * 1024;

/**
 * The proposal limits, per sponsor (one sponsor per account), settled in one place: at most
 * `max_open` proposals in review at once (deposited, not yet decided) and `max_per_day` submitted
 * per UTC day. server/proposals/checks.ts proposal_rate holds a sponsor to them and the check
 * registry (server/entries/checks.ts) quotes them.
 */
export const PROPOSAL_RATE = Object.freeze({ max_open: 3, max_per_day: 3 });

/**
 * The least a sponsor's prize pool may total, in USD, on every server: MAKEFUN_SPONSOR_MIN_PRIZE_USD
 * may raise the floor, never lower it (server/config.ts sponsorMinPrizeUsd is the larger of the two).
 * Creating or saving a proposal under it answers 422 (server/routes/sponsor.ts), and proposal_prizes
 * fails under it, so no check passes and no deposit opens.
 */
export const SPONSOR_MIN_PRIZE_FLOOR_USD = 10;

const text = (max: number) => z.string().min(1).max(max);

/** An instant in whole seconds (the escrow program's unit), with an explicit offset. */
export const ProposalInstant = IsoDateTime.refine((s) => Date.parse(s) % 1000 === 0, 'whole seconds only (no fraction of a second)');

export const ProposalCompetition = z.strictObject({
  title: text(PROPOSAL_CAPS.title),
  /** One line for the card and link previews. */
  summary: text(PROPOSAL_CAPS.summary),
  /** Board text: paragraphs split by a blank line, "- " bullets, "## " subheadings. */
  description: z.string().max(PROPOSAL_CAPS.description).default(''),
  /** The full rules, markdown. */
  rules: z.string().max(PROPOSAL_CAPS.rules).default(''),
  /** A board category the template fits (proposal_category). */
  category: Category,
  skills: z.array(text(PROPOSAL_CAPS.skill)).max(PROPOSAL_CAPS.skills).default([]),
  /**
   * How long entries stay open, hours (fractions allowed): any length from the schedule's shortest entries
   * window up, the house's 15 minutes, 0.25 (server/proposals/schedule.ts MIN_ENTRIES_MS, held by
   * proposal_schedule, not here: the schedule in force decides it). The test-windows schedule runs it at a
   * minute per hour, so 0.25 is its shortest there too (15 seconds).
   */
  duration_hours: z.number().positive(),
  /** Entries open (and the dev phase starts), set by the house: the first whole hour at least the review time after the save or checks pass. */
  opens_at: ProposalInstant,
  /** Entries close (and the dev phase ends), set by the house: duration_hours after opens_at. */
  deadline: ProposalInstant,
  /** Whether entries' scores and places show while the competition runs (the bundle's leaderboard.placements); absent: hidden until the results are published. */
  placements: z.enum(PLACEMENTS).optional(),
});

const UPLOADS_REFUSED = 'a sponsored competition uploads no scorer, reference or input data: it is scored by a house template';

/** The refusal of a harness that names no house template, by what it holds instead. */
function templateRefusal(input: unknown): string {
  const uploads = uploadKeysIn({ harness: input });
  const named = (input as { template?: unknown } | null)?.template;
  // The templates a sponsor names: a setup-only one (code-tests) is the make.fun team's, reached by a custom brief.
  const choose = `name a house template in harness.template: ${orList(SPONSOR_PICKABLE_TEMPLATE_IDS)}`;
  if (uploads.length > 0) return `${UPLOADS_REFUSED} (${uploads.join(', ')}); ${choose}`;
  if (typeof named === 'string') return `${JSON.stringify(named)} is not a house template; ${choose}`;
  return choose;
}

/** The refusal of a value a template does not list: what it should be, and the choices. */
function notListed(input: unknown, what: string, ids: readonly string[]): string {
  return input === undefined ? `name ${what}: one of ${orList(ids)}` : `${JSON.stringify(input)} is not ${what}: one of ${orList(ids)}`;
}

/** The refusal of a key a template's choice does not take: an upload, or a knob of another template. */
function unknownKeys(id: string) {
  return (iss: { code?: string; keys?: string[] }) =>
    iss.code === 'unrecognized_keys' && iss.keys !== undefined ? `${iss.keys.join(', ')}: ${iss.keys.some(isUploadKey) ? UPLOADS_REFUSED : `not a choice ${id} takes`}` : undefined;
}

/** The runtimes an entry may use on template `id` (default every one the template runs), each once. */
const runtimesOf = (id: string, knob: { readonly allowed: readonly z.infer<typeof Runtime>[]; readonly default: readonly z.infer<typeof Runtime>[] }) =>
  z
    .array(Runtime)
    .min(1, 'at least one runtime')
    .refine((rs) => new Set(rs).size === rs.length, 'a runtime is listed once')
    .refine((rs) => rs.every((r) => knob.allowed.includes(r)), `${id} runs ${orList(knob.allowed)} only`)
    .default(() => [...knob.default]);

const k = PUMPFUN_REPLAY.knobs;
/** An integer knob of template `id`, inside its bounds. */
const boundedOn = (id: string, name: string, knob: { min: number; max: number }, unit = '') =>
  z
    .int({ error: `${name} is a whole number, ${knob.min} to ${knob.max}${unit}` })
    .min(knob.min, `${name} is at least ${knob.min}${unit} on ${id}`)
    .max(knob.max, `${name} is at most ${knob.max}${unit} on ${id}`);
const bounded = (name: string, knob: { min: number; max: number; default: number }, unit = '') => boundedOn(PUMPFUN_REPLAY_ID, name, knob, unit).default(knob.default);

/** A choice of the pumpfun-replay template (server/proposals/templates.ts PUMPFUN_REPLAY): its window, its metric, its knobs. */
export const PumpfunReplayChoice = z.strictObject(
  {
    template: z.literal(PUMPFUN_REPLAY_ID),
    /** The forward window the final phase replays. */
    dataset: z.enum(PUMPFUN_REPLAY_DATASET_IDS, { error: (iss) => notListed(iss.input, `a dataset window ${PUMPFUN_REPLAY_ID} accepts`, PUMPFUN_REPLAY_DATASET_IDS) }),
    /** The leaderboard column entries rank by. */
    metric: z.enum(PUMPFUN_REPLAY_METRIC_IDS, { error: (iss) => notListed(iss.input, `a metric ${PUMPFUN_REPLAY_ID} ranks by`, PUMPFUN_REPLAY_METRIC_IDS) }),
    /** The runtimes an entry may use (default every one the template runs), each once. */
    runtimes: runtimesOf(PUMPFUN_REPLAY_ID, k.runtimes),
    /** The activity bar: coins each holding a round trip of at least the house's floor. */
    min_distinct_mints: bounded('min_distinct_mints', k.min_distinct_mints),
    /** The drawdown bar, in whole percent of equity. */
    max_drawdown_pct: bounded('max_drawdown_pct', k.max_drawdown_pct, '%'),
  },
  { error: unknownKeys(PUMPFUN_REPLAY_ID) },
);

/**
 * A choice of the solana-bars-1h template (server/proposals/templates.ts SOLANA_BARS): its one window,
 * its one metric, its runtimes. Nothing else moves: solana-bars-1h-01's harness block runs verbatim,
 * and its buy-and-hold baseline sets the prize bar.
 */
export const SolanaBarsChoice = z.strictObject(
  {
    template: z.literal(SOLANA_BARS_ID),
    /** The forward window the final phase is: 7 whole UTC days from a UTC midnight. */
    dataset: z.enum(SOLANA_BARS_DATASET_IDS, { error: (iss) => notListed(iss.input, `a dataset window ${SOLANA_BARS_ID} accepts`, SOLANA_BARS_DATASET_IDS) }),
    /** The leaderboard column entries rank by. */
    metric: z.enum(SOLANA_BARS_METRIC_IDS, { error: (iss) => notListed(iss.input, `a metric ${SOLANA_BARS_ID} ranks by`, SOLANA_BARS_METRIC_IDS) }),
    runtimes: runtimesOf(SOLANA_BARS_ID, SOLANA_BARS.knobs.runtimes),
  },
  { error: unknownKeys(SOLANA_BARS_ID) },
);

/**
 * A choice of the solana-clmm-lp template (server/proposals/templates.ts SOLANA_CLMM): its one window,
 * its one metric, its runtimes. Nothing else moves: solana-clmm-lp-01's harness block runs verbatim,
 * and its two baselines set the prize bar.
 */
export const SolanaClmmChoice = z.strictObject(
  {
    template: z.literal(SOLANA_CLMM_ID),
    /** The forward window the final phase is: 7 whole UTC days from a UTC midnight. */
    dataset: z.enum(SOLANA_CLMM_DATASET_IDS, { error: (iss) => notListed(iss.input, `a dataset window ${SOLANA_CLMM_ID} accepts`, SOLANA_CLMM_DATASET_IDS) }),
    /** The leaderboard column entries rank by. */
    metric: z.enum(SOLANA_CLMM_METRIC_IDS, { error: (iss) => notListed(iss.input, `a metric ${SOLANA_CLMM_ID} ranks by`, SOLANA_CLMM_METRIC_IDS) }),
    runtimes: runtimesOf(SOLANA_CLMM_ID, SOLANA_CLMM.knobs.runtimes),
  },
  { error: unknownKeys(SOLANA_CLMM_ID) },
);

/** The code kinds the make.fun team may attach code-tests with: those offered now (the house cannot run the rest yet). */
const objectiveNotOffered = (iss: { input?: unknown }) => `${String(iss.input)} is not offered yet: the objective is one of ${orList(CODE_TESTS.knobs.objective.one_of)}`;

/**
 * The test pack a code-tests choice is graded on (server/proposals/packs.ts): the pack record's id (the blob
 * the house keeps it by, which the setup reads its checks and its proposal from) and its trees' digests
 * (ProgramPack, the bundle's harness.pack), so the composed bundle, and the escrow's rules_sha256, bind the
 * hidden cases. The make.fun team's, never a sponsor's upload.
 */
export const CodeTestsPack = ProgramPack.safeExtend({ id: Sha256Hex });

/** The code kind a build allowance and a build meter go with: Cheapest to build, ranked on the metered build cost. */
export const BUILD_ALLOWANCE_CODE_KIND = 'code-cheapest' as const satisfies CodeKindIdT;

/** "Cheapest to build (code-cheapest)": the kind a build allowance goes with, as a refusal names it. */
const ALLOWANCE_KIND_WORDS = `${CODE_KINDS[BUILD_ALLOWANCE_CODE_KIND].label} (${BUILD_ALLOWANCE_CODE_KIND})`;

/**
 * A code-cheapest choice's build keys (CodeTestsChoice.build): each entrant's share of the sponsor's build
 * allowance and the model globs its key may call, as the composed bundle's build meter carries them
 * (contracts/competition.ts BuildMeter per_entrant_usd and models; the share is clamped to the allowance
 * there). The make.fun team's, set at setup.
 */
export const CodeTestsBuild = z.strictObject({
  per_entrant_usd: BuildKeyShareUsd,
  models: BuildKeyModels,
});

/**
 * A choice of the code-tests template (server/proposals/templates.ts CODE_TESTS): the make.fun team's alone
 * (setup only: server/routes/sponsor.ts refuses it from a sponsor, server/routes/admin/proposals.ts attaches
 * it to a custom brief). Its objective, a code kind the house offers now (contracts/code-kinds.ts), picks
 * the winner; its runtimes, exactly one for a kind that compares entries in one language; its pack, the
 * hidden test cases the team wrote and sealed for this proposal; on code-cheapest alone, optionally its
 * build keys (CodeTestsBuild; absent, the house's defaults, and no key appears). No dataset window or
 * metric: the pack is its data, the objective its rank.
 */
export const CodeTestsChoice = z
  .strictObject(
    {
      template: z.literal(CODE_TESTS_ID),
      objective: z
        .enum(CODE_KIND_IDS, { error: (iss) => notListed(iss.input, `an objective ${CODE_TESTS_ID} ranks by (a code kind)`, CODE_TESTS.knobs.objective.one_of) })
        .refine((id) => CODE_KINDS[id].offered, { error: objectiveNotOffered }),
      runtimes: runtimesOf(CODE_TESTS_ID, CODE_TESTS.knobs.runtimes),
      pack: CodeTestsPack,
      build: CodeTestsBuild.optional(),
    },
    { error: unknownKeys(CODE_TESTS_ID) },
  )
  .superRefine((c, ctx) => {
    // zod skips this when a field is the wrong type, so CODE_KINDS is read only for a kind it holds; guarded all the same.
    if (!isCodeKindId(c.objective)) return;
    if (!codeKindRuntimesFit(c.objective, c.runtimes)) {
      const kind = CODE_KINDS[c.objective];
      ctx.addIssue({ code: 'custom', path: ['runtimes'], message: `${kind.id} (${kind.label}) compares every entry in one language: name exactly one runtime (${orList(CODE_TESTS.knobs.runtimes.allowed)}), not ${c.runtimes.length}`, input: c.runtimes });
    }
    if (c.build !== undefined && c.objective !== BUILD_ALLOWANCE_CODE_KIND) {
      const kind = CODE_KINDS[c.objective];
      ctx.addIssue({
        code: 'custom',
        path: ['build'],
        message: `build sets the metered build keys of a ${ALLOWANCE_KIND_WORDS} bounty alone, and the objective is ${kind.id} (${kind.label}), which meters no build: drop build`,
        input: c.build,
      });
    }
  });

const ja = JUDGED_ARTIFACT.knobs;
const JUDGED_CAP_KEYS = ['max_chars', 'max_bytes', 'max_width', 'max_height'] as const;

/** A house anchor's file name under the judge directory's anchors/: a plain name, never a path. */
const AnchorName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'an anchor is named as a plain file: 1 to 64 letters, digits, dots, underscores and hyphens, starting with a letter or digit');

/** A house anchor the team attached: its file name and its bytes' sha256, the blob it was attached as. */
export const JudgedArtifactAnchor = z.strictObject({ name: AnchorName, sha256: Sha256Hex });

/**
 * A judged artifact's calibrated ladder, the make.fun team's (server/proposals/templates.ts JudgedArtifactLadderT): the
 * blob of the house judge's calibration record (calibration.json, grade-local --calibrate's) and at most
 * JUDGED_ARTIFACT_MAX_RUNGS rungs, house artifacts of the medium named as anchors are, none an anchor's bytes and no two
 * alike (the medium's file endings, distinct names: checked with the choice). Whether the record calibrates this judge
 * and these members is the grader's to hold (grader/judge-ladder-tree.ts readJudgeLadder): this contract cannot read it.
 */
export const JudgedArtifactLadder = z.strictObject(
  {
    calibration_sha256: Sha256Hex,
    rungs: z.array(JudgedArtifactAnchor).max(JUDGED_ARTIFACT_MAX_RUNGS, `at most ${JUDGED_ARTIFACT_MAX_RUNGS} rungs: each is a member of the calibration's round robin`).optional(),
  },
  { error: (iss) => (iss.code === 'unrecognized_keys' && iss.keys !== undefined ? `${iss.keys.join(', ')}: not a key a ${JUDGED_ARTIFACT_ID} ladder takes (calibration_sha256, rungs)` : undefined) },
);

/**
 * The judged-artifact choice (the make.fun team's alone; server/proposals/templates.ts JudgedArtifactTemplate). From
 * the sponsor's brief: the medium, the judge's persona (prompt) and the medium's caps, each inside its bound and
 * absent for its default; the other medium's caps are refused. The team's: the judge's model call (a HouseAgent but
 * its prompt file, which is always prompt.md) and at least PROGRAM_JUDGE_MIN_ANCHORS anchors of the medium (distinct
 * bytes, distinct names); and, once it has calibrated the composed bundle's judge, its ladder (JudgedArtifactLadder),
 * absent until then. House judging has no spend cap: the choice sets none.
 */
export const JudgedArtifactChoice = z
  .strictObject(
    {
      template: z.literal(JUDGED_ARTIFACT_ID),
      media: z.enum(SPONSOR_JUDGE_MEDIA, { error: (iss) => notListed(iss.input, `a medium ${JUDGED_ARTIFACT_ID} judges`, ja.media.one_of) }),
      prompt: z
        .string({ error: "write the judge's persona: the prompt it judges by" })
        .max(JUDGED_ARTIFACT_PROMPT_MAX, `the judge's persona is at most ${JUDGED_ARTIFACT_PROMPT_MAX} characters`)
        .refine((s) => s.trim().length > 0, "write the judge's persona: the prompt it judges by"),
      runtimes: runtimesOf(JUDGED_ARTIFACT_ID, ja.runtimes),
      max_chars: boundedOn(JUDGED_ARTIFACT_ID, 'max_chars', ja.max_chars, ' characters').optional(),
      max_bytes: boundedOn(JUDGED_ARTIFACT_ID, 'max_bytes', ja.max_bytes, ' bytes').optional(),
      max_width: boundedOn(JUDGED_ARTIFACT_ID, 'max_width', ja.max_width, ' pixels').optional(),
      max_height: boundedOn(JUDGED_ARTIFACT_ID, 'max_height', ja.max_height, ' pixels').optional(),
      agent: HouseAgent.omit({ prompt: true }),
      anchors: z
        .array(JudgedArtifactAnchor)
        .min(PROGRAM_JUDGE_MIN_ANCHORS, `at least ${PROGRAM_JUDGE_MIN_ANCHORS} anchors: the judge's fixed points, weak to strong`)
        .max(JUDGED_ARTIFACT_MAX_ANCHORS, `at most ${JUDGED_ARTIFACT_MAX_ANCHORS} anchors: each is in every heat's field`),
      // The judge spend cap a choice set up before house judging lost its caps still names: a whole number, read by
      // nothing (judgedArtifactHarnessOf composes no cap key), kept so a stored proposal's choice parses as it was stored.
      max_total_usd: z.int({ error: 'max_total_usd is a whole number of USD' }).optional(),
      ladder: JudgedArtifactLadder.optional(),
    },
    { error: unknownKeys(JUDGED_ARTIFACT_ID) },
  )
  .superRefine((c, ctx) => {
    const medium = JUDGED_ARTIFACT.media[c.media];
    const an = c.media === 'image' ? 'an image' : 'a text';
    for (const key of JUDGED_CAP_KEYS) {
      if (c[key] === undefined || medium.caps.includes(key)) continue;
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is not a cap of ${an} artifact, whose caps are ${medium.caps.join(', ')}: drop ${key}`, input: c[key] });
    }
    const names = new Set<string>();
    const digests = new Set<string>();
    c.anchors.forEach((a, i) => {
      if (!medium.anchor_extensions.some((ext) => a.name.endsWith(ext)))
        ctx.addIssue({ code: 'custom', path: ['anchors', i, 'name'], message: `${an} anchor's file name ends in ${orList(medium.anchor_extensions)}`, input: a.name });
      if (names.has(a.name)) ctx.addIssue({ code: 'custom', path: ['anchors', i, 'name'], message: `anchor ${a.name} is named twice`, input: a.name });
      if (digests.has(a.sha256)) ctx.addIssue({ code: 'custom', path: ['anchors', i, 'sha256'], message: `anchor ${a.name} has another anchor's bytes: each anchor is distinct`, input: a.sha256 });
      names.add(a.name);
      digests.add(a.sha256);
    });
    // The rungs: artifacts of the medium, one ladder member each, apart from the anchors (readJudgeLadder refuses a twin).
    const rungNames = new Set<string>();
    const rungDigests = new Set<string>();
    (c.ladder?.rungs ?? []).forEach((r, i) => {
      const at = ['ladder', 'rungs', i];
      if (!medium.anchor_extensions.some((ext) => r.name.endsWith(ext))) ctx.addIssue({ code: 'custom', path: [...at, 'name'], message: `${an} rung's file name ends in ${orList(medium.anchor_extensions)}`, input: r.name });
      if (rungNames.has(r.name)) ctx.addIssue({ code: 'custom', path: [...at, 'name'], message: `rung ${r.name} is named twice`, input: r.name });
      if (digests.has(r.sha256)) ctx.addIssue({ code: 'custom', path: [...at, 'sha256'], message: `rung ${r.name} has an anchor's bytes: a rung is a ladder member apart from the anchors`, input: r.sha256 });
      else if (rungDigests.has(r.sha256)) ctx.addIssue({ code: 'custom', path: [...at, 'sha256'], message: `rung ${r.name} has another rung's bytes: each rung is distinct`, input: r.sha256 });
      rungNames.add(r.name);
      rungDigests.add(r.sha256);
    });
  });

/** The harness: a house template choice, by template id (code-tests and judged-artifact the make.fun team's alone). */
export const ProposalHarness = z.discriminatedUnion('template', [PumpfunReplayChoice, SolanaBarsChoice, SolanaClmmChoice, CodeTestsChoice, JudgedArtifactChoice], { error: (iss) => templateRefusal(iss.input) });

/**
 * The final phase's window, set by the house with the competition's dates (server/proposals/schedule.ts
 * houseDates): scores are graded on it and shown once an admin finalizes it. It starts the
 * schedule's final gap (the house's 10 minutes) or more after the deadline. Its data starts the template's
 * lead after starts_at; on a window of whole UTC days (solana-bars-1h, solana-clmm-lp) the phase is the
 * window exactly, starts_at a UTC midnight and ends_at its end; a code bounty's test pack (code-tests),
 * and a custom brief until its template is attached, collect no data, so ends_at need only follow
 * starts_at: the final grades are queued when the final phase is locked (the deadline at the earliest) and
 * the result is posted once the final phase's results are published and its checks pass, not at the final
 * window's end, so the window need not hold the grading (server/proposals/checks.ts proposal_schedule,
 * described in server/entries/checks.ts).
 */
export const ProposalFinal = z.strictObject({
  starts_at: ProposalInstant,
  ends_at: ProposalInstant,
});

export const ProposalSubmissionRule = z.strictObject({
  max_per_day: z.int().min(1).max(PROPOSAL_CAPS.max_per_day).default(5),
  max_total: z.int().min(1).max(PROPOSAL_CAPS.max_total).nullable().default(null),
  strategy_note_required: z.boolean().default(false),
});

/**
 * The challenge window a sponsor may choose for its escrow, whole hours (escrow.challenge_hours). At least
 * `min`, 24: the release build's MIN_CHALLENGE_WINDOW (chain/programs/prize_escrow/src/constants.rs; server/
 * chain/terms.ts DEFAULT_WINDOWS gives a sponsored escrow exactly that unless the sponsor chose longer), which
 * the program refuses to go under for any sponsor but a house one. At most `max`, 720 (30 days): the longest
 * window of the house's terms (DEFAULT_WINDOWS' 30-day claim window), far under the program's MAX_WINDOW
 * (i32::MAX seconds), since every hour of it delays the winners' claim and pushes the escrow's hard deadline,
 * the sponsor's refund backstop, out with it (terms.ts earliestHardDeadlineOf: resolve_deadline plus every
 * window plus ARBITER_SLACK). Written out here, so this contract loads none of the chain code;
 * tests/unit/sponsor-proposal-challenge-window.test.ts holds `min` to the program's minimum and DEFAULT_WINDOWS.
 */
export const PROPOSAL_CHALLENGE_HOURS = Object.freeze({ min: 24, max: 720 });

const challengeHoursWords = `a whole number of hours, ${PROPOSAL_CHALLENGE_HOURS.min} to ${PROPOSAL_CHALLENGE_HOURS.max} (30 days)`;

/**
 * The sponsor's escrow choices: its challenge window, how long a posted result stays open to challenge
 * before the winners can claim (PROPOSAL_CHALLENGE_HOURS). The whole block is optional: absent, the escrow
 * opens with the house's 24 hours (raised to the program Config's floor, should the Config hold a longer
 * one), and no key appears, so a proposal without it parses, stores and hashes as it always did.
 */
export const ProposalEscrow = z.strictObject(
  {
    challenge_hours: z
      .int({ error: `escrow.challenge_hours is ${challengeHoursWords}` })
      .min(PROPOSAL_CHALLENGE_HOURS.min, `escrow.challenge_hours is at least ${PROPOSAL_CHALLENGE_HOURS.min}: no sponsored escrow's challenge window is shorter than the program's ${PROPOSAL_CHALLENGE_HOURS.min} hours, which is also the default; leave escrow out for it`)
      .max(
        PROPOSAL_CHALLENGE_HOURS.max,
        `escrow.challenge_hours is at most ${PROPOSAL_CHALLENGE_HOURS.max} (30 days): the winners claim only once the window has passed, and the escrow's refund backstop moves out with it`,
      ),
  },
  { error: (iss) => (iss.code === 'unrecognized_keys' && iss.keys !== undefined ? `${iss.keys.join(', ')}: not an escrow choice a sponsor makes (escrow takes challenge_hours alone)` : undefined) },
);

/** The challenge window a proposal chose (escrow.challenge_hours), in seconds, as server/chain/terms.ts takes it (challengeSeconds); undefined when it chose none (the default). */
export function proposalChallengeSeconds(p: { escrow?: { challenge_hours: number } | undefined }): number | undefined {
  return p.escrow === undefined ? undefined : p.escrow.challenge_hours * 3600;
}

export const ProposalPrize = z.strictObject({
  /** Optional, and only placement: an escrowed competition pays placement prizes alone. */
  kind: z.literal('placement', { error: 'a sponsored competition pays placement prizes only' }).optional(),
  place: z.int().min(1).max(PROPOSAL_CAPS.prizes),
  /** Above $0 in whole cents; the pool's floor (SPONSOR_MIN_PRIZE_FLOOR_USD, $10 at the least) and a server's ceiling are proposal_prizes'. */
  amount_usd: UsdAmount.refine((n) => n > 0, 'a prize pays more than zero'),
  title: text(PROPOSAL_CAPS.prize_title).nullable().default(null),
});

/** The choices of a brief's code kind, for a refusal: the kinds offered now, or none. */
const KIND_CHOICES = `one of ${orList(OFFERED_CODE_KIND_IDS)}, or leave kind out for Something else`;

/** A code kind a brief may name: one the catalogue offers now (contracts/code-kinds.ts). */
const ProposalCodeKind = z
  .enum(CODE_KIND_IDS, { error: (iss) => `${JSON.stringify(iss.input)} is not a code kind: ${KIND_CHOICES}` })
  .refine((id) => CODE_KINDS[id].offered, { error: (iss) => `${String(iss.input)} is not offered yet: ${KIND_CHOICES}` });

/**
 * A custom scoring brief: when no house template fits, the sponsor says in plain words what wins and
 * how to judge it (and, optionally, worked examples), and requests the make.fun team's setup (POST
 * /api/sponsor/proposals/:id/request-setup). The team attaches a house template and its knobs (the
 * harness), or returns the proposal with a note; no deposit is taken before then, since the escrow
 * commits the rules' digest. Words only: never a scorer, reference data or input data.
 *
 * A code bounty names its code kind (contracts/code-kinds.ts: what wins once make.fun writes the
 * hidden tests from the brief) and the runtimes an entry may use; a kind that compares entries in one
 * language (Smallest code, Fastest) takes exactly one. No kind is Something else: the team reads the
 * brief alone.
 */
export const ProposalCustomScoring = z
  .strictObject(
    {
      /** What wins and how to judge it, in plain words; for a code kind, what the program must do and what it reads and writes. */
      brief: z
        .string()
        .trim()
        .min(SCORING_BRIEF_CAPS.brief_min, `say what wins and how to judge it, in at least ${SCORING_BRIEF_CAPS.brief_min} characters`)
        .max(SCORING_BRIEF_CAPS.brief),
      /** Worked examples of entries and how they would rank, in plain words. */
      examples: z.string().trim().max(SCORING_BRIEF_CAPS.examples).nullable().default(null),
      /** The code kind that picks the winner (contracts/code-kinds.ts), one offered now. Absent: Something else. */
      kind: ProposalCodeKind.optional(),
      /**
       * The runtimes an entry may use, each once: exactly one for a kind that compares entries in one
       * language. Absent: every runtime the house runs (refused for a one-language kind).
       */
      runtimes: z
        .array(Runtime)
        .refine((rs) => new Set(rs).size === rs.length, 'a runtime is listed once')
        .optional(),
    },
    {
      error: (iss) =>
        iss.code === 'unrecognized_keys' ? `${iss.keys.join(', ')}: ${iss.keys.some(isUploadKey) ? UPLOADS_REFUSED : 'not a field of a custom scoring brief (brief, examples, kind and runtimes)'}` : undefined,
    },
  )
  .superRefine((c, ctx) => {
    // zod skips this when a field is the wrong type, so an unknown kind never reaches CODE_KINDS; guarded all the same.
    if (c.kind !== undefined && !isCodeKindId(c.kind)) return;
    if (c.kind === undefined ? c.runtimes?.length !== 0 : codeKindRuntimesFit(c.kind, c.runtimes)) return;
    const kind = c.kind === undefined ? undefined : CODE_KINDS[c.kind];
    const n = c.runtimes?.length ?? 0;
    const message =
      kind?.runtimes === 'one'
        ? `${kind.id} (${kind.label}) compares every entry in one language: name exactly one runtime (${orList(RUNTIMES)})${n === 0 ? '' : `, not ${n}`}`
        : 'at least one runtime, or leave runtimes out for every one the house runs';
    ctx.addIssue({ code: 'custom', path: ['runtimes'], message, input: c.runtimes });
  });

/** The scoring block of a proposal no house template fits: its custom brief. */
export const ProposalScoring = z.strictObject(
  { custom: ProposalCustomScoring },
  { error: (iss) => (iss.code === 'unrecognized_keys' ? `${iss.keys.join(', ')}: scoring takes a custom brief only (scoring.custom); a house template is named in harness instead` : undefined) },
);

/** Root keys the house template sets, refused with why. */
const TEMPLATE_SETS = new Set(['leaderboard', 'limits', 'phases']);

function rootKeysRefusal(keys: string[], scoredBy: 'harness' | 'scoring'): string {
  const list = keys.join(', ');
  if (keys.some(isUploadKey)) return `${list}: ${UPLOADS_REFUSED}`;
  if (keys.some((key) => TEMPLATE_SETS.has(key))) return `${list}: not a field a sponsor writes (the house template sets the harness block, the leaderboard, the phases' data and the sandbox limits)`;
  if (keys.includes(scoredBy === 'harness' ? 'scoring' : 'harness'))
    return `${list}: a proposal is scored by a house template (harness) or, when none fits, by a custom brief the make.fun team sets up (scoring.custom), not both: drop one`;
  return `${list}: not a field a sponsor writes`;
}

const proposalFields = {
  version: z.literal(SPONSOR_PROPOSAL_VERSION),
  competition: ProposalCompetition,
  final: ProposalFinal,
  submission_rule: ProposalSubmissionRule.default(() => ({ max_per_day: 5, max_total: null, strategy_note_required: false })),
  prizes: z.array(ProposalPrize).min(1).max(PROPOSAL_CAPS.prizes),
  /**
   * The build allowance, in USD on top of the prizes: on a Cheapest to build bounty (code-cheapest) alone
   * (allowanceIssue), it pays for the entrants' metered build keys (the composed bundle's build meter,
   * contracts/competition.ts BuildMeter). Not a prize, so no part of the escrow's pot. Its bounds are the
   * proposal checks' (see the header). Absent: none, and no key appears, so a proposal without it parses
   * as it always did.
   */
  allowance_usd: UsdAmount.optional(),
  /**
   * The entry fee, in USD (the composed bundle's entry_fee.amount_usd, contracts/competition.ts EntryFee): what
   * each account pays once to enter, into the bounty's escrow vault, where it joins the pot. Above 0, in whole
   * cents (EntryFeeUsd). Absent: entry is free, and no key appears, so a proposal without it parses, composes
   * and hashes as it always did.
   */
  entry_fee_usd: EntryFeeUsd.optional(),
  /**
   * The sponsor's escrow choices (ProposalEscrow): a challenge window longer than the house's 24 hours,
   * chosen when the proposal is written. Absent: the default, and no key appears, so a proposal without it
   * parses, composes and hashes as it always did.
   */
  escrow: ProposalEscrow.optional(),
};

/** What proposalCodeKind reads of a proposal: its harness (a template choice), or its custom brief. */
export type CodeKindBearing = { harness: { template: string; objective?: unknown } } | { scoring: { custom: { kind?: unknown } } };

/**
 * The code kind a proposal names (contracts/code-kinds.ts): its harness's objective on code-tests, its
 * custom brief's kind; undefined on any other template, or a brief that names none (Something else).
 */
export function proposalCodeKind(p: CodeKindBearing): CodeKindIdT | undefined {
  const kind = 'harness' in p ? (p.harness.template === CODE_TESTS_ID ? p.harness.objective : undefined) : p.scoring.custom.kind;
  return isCodeKindId(kind) ? kind : undefined;
}

/** Whether a proposal may carry a build allowance (allowance_usd): its code kind is code-cheapest. */
export function takesBuildAllowance(p: CodeKindBearing): boolean {
  return proposalCodeKind(p) === BUILD_ALLOWANCE_CODE_KIND;
}

/** The refusal of a build allowance on a proposal of another kind (allowance_usd present, takesBuildAllowance false), naming the field; null when it holds. */
export function allowanceIssue(p: CodeKindBearing & { allowance_usd?: number }): string | null {
  if (p.allowance_usd === undefined || takesBuildAllowance(p)) return null;
  const kind = proposalCodeKind(p);
  const named =
    kind !== undefined
      ? `its code kind is ${kind} (${CODE_KINDS[kind].label})`
      : 'harness' in p
        ? `it is scored by the house template ${p.harness.template}`
        : 'its brief names no code kind (Something else)';
  return `allowance_usd is the build allowance of a ${ALLOWANCE_KIND_WORDS} bounty alone, which pays for its entrants' metered build keys, and ${named}: drop allowance_usd`;
}

/** Refuses a build allowance on any kind but code-cheapest (allowanceIssue), at allowance_usd. */
function refuseAllowance(p: CodeKindBearing & { allowance_usd?: number }, ctx: z.RefinementCtx): void {
  const message = allowanceIssue(p);
  if (message !== null) ctx.addIssue({ code: 'custom', path: ['allowance_usd'], message, input: p.allowance_usd });
}

/** A proposal string carrying a make.fun API key: where it stands, and the sentence that refuses it. */
export interface ProposalApiKeyIssue {
  path: (string | number)[];
  message: string;
}

/**
 * The first string of a proposal document (as written or as parsed: objects and arrays walked in order, keys
 * left to the strict schemas) that carries a make.fun API key (holdsMakefunApiKey), or null. Credentials only:
 * no other content is judged here.
 */
export function proposalApiKeyIssue(raw: unknown): ProposalApiKeyIssue | null {
  const walk = (v: unknown, path: (string | number)[]): ProposalApiKeyIssue | null => {
    if (typeof v === 'string') {
      if (!holdsMakefunApiKey(v)) return null;
      return {
        path,
        message: `this carries ${MAKEFUN_API_KEY_WHAT}: a proposal is read by the make.fun team and, once approved, by everyone, and whoever reads the key acts as your account. Take it out`,
      };
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const found = walk(v[i], [...path, i]);
        if (found !== null) return found;
      }
      return null;
    }
    if (typeof v === 'object' && v !== null) {
      for (const [key, x] of Object.entries(v)) {
        const found = walk(x, [...path, key]);
        if (found !== null) return found;
      }
    }
    return null;
  };
  return walk(raw, []);
}

/** Refuses a proposal any string of which carries a make.fun API key (proposalApiKeyIssue), at that string's path. */
function refuseApiKeys(p: unknown, ctx: z.RefinementCtx): void {
  const issue = proposalApiKeyIssue(p);
  if (issue !== null) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
}

/** A proposal on a house template: the only kind composed and checked in full, and deposited with its rules named. */
export const SponsorProposal = z
  .strictObject({ ...proposalFields, harness: ProposalHarness }, { error: (iss) => (iss.code === 'unrecognized_keys' ? rootKeysRefusal(iss.keys, 'harness') : undefined) })
  .superRefine(refuseAllowance)
  .superRefine(refuseApiKeys);

/**
 * A proposal no house template fits: every field as written, its scoring a custom brief instead of
 * a harness. It is checked but for the template's checks and funds first: never composed, it
 * deposits with its rules unset (rules_sha256 all zeros, no bundle), the landing asking the make.fun
 * team's setup (the proposal's setup record, the brief kept on it), and it is in review while the
 * team sets how it is scored. It becomes a SponsorProposal when the team attaches the harness, its
 * rules set on chain at approval (set_proposal_rules). A request made before funding came first
 * (status setup_requested) waits for the team's setup, then deposits as a SponsorProposal.
 */
export const CustomScoringProposal = z
  .strictObject({ ...proposalFields, scoring: ProposalScoring }, { error: (iss) => (iss.code === 'unrecognized_keys' ? rootKeysRefusal(iss.keys, 'scoring') : undefined) })
  .superRefine(refuseAllowance)
  .superRefine(refuseApiKeys);

/**
 * Whether a stored or submitted proposal is written with a custom scoring brief (a `scoring` key and
 * no `harness`): such a document parses as CustomScoringProposal, any other as SponsorProposal.
 */
export function isCustomScoringDocument(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) && 'scoring' in raw && !('harness' in raw);
}

export type SponsorProposalT = z.infer<typeof SponsorProposal>;
export type SponsorProposalInput = z.input<typeof SponsorProposal>;
export type CustomScoringProposalT = z.infer<typeof CustomScoringProposal>;
export type ProposalCustomScoringT = z.infer<typeof ProposalCustomScoring>;
export type ProposalPrizeT = z.infer<typeof ProposalPrize>;
export type ProposalHarnessT = z.infer<typeof ProposalHarness>;

// The registry's hand-written choice type is the contract's parse: a drift fails the typecheck.
type Same<A, B> = [A, B] extends [B, A] ? true : false;
type Holds<T extends true> = T;
type _ProposalHarnessIsRegistryChoice = Holds<Same<ProposalHarnessT, TemplateChoiceT>>;
// The code kinds catalogue imports nothing of contracts/ (./code-kinds.ts), so it is held to the
// competition contract here: a kind's submission rule is a Codabench rule.
type _CodeKindSubmissionIsARule = Holds<CodeKindT['submission'] extends (typeof CODABENCH_SUBMISSION_RULES)[number] ? true : false>;
