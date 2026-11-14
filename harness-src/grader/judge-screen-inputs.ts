// A screened final's screen inputs (judge heat v4's F1, grader/judge-heat.ts JudgeHeatScreenInputs) from the dev
// phase's ladder records: pure, no clock and no I/O. grader/worker.ts reads each final entry's latest dev grade run and
// the v3 record it links, and the bundle's ladder; this turns them into one input per entrant member of the final's
// field, fixed before the heat's first call (the partial keeps them).
//
//   rated            an entry is rated only when ALL hold, checked in this order (the first that fails is its reason):
//     no_record      its latest dev grade run finished and links a record that loads;
//     incomplete     the record is a v3 provisional ladder heat that holds (judgeHeatVerdicts) on the bundle's judge
//                    directory, media and artifact, on the bundle's ladder (its ladder_sha256 and calibration_sha256),
//                    with every adaptive round of the bundle's design played (its rounds and games at least the
//                    bundle's; a scrutinised record's extra rounds count on top), and its rating has a Fixed9 form;
//     other_judge    every judge its calls name (judgeHeatJudgesOf) is one of the final's judges, the same model on
//                    the same door (no guard on the judge-overflow switch: a final on another judge than dev's finds
//                    every rating other_judge, and every entry enters at the line);
//     other_artifact the record's subject (its one entrant member) is the final's artifact, byte for byte.
//   the rating       p^ = grader/judge-ladder.ts judgeLadderEstimate over the record's games against its ladder's fixed
//                    strengths; its log-scale screen se (judgeScreenSe) the larger of the model's, sqrt(phi) / sqrt(I),
//                    phi the ladder's dispersion and I the subject's Fisher information p^/(p^+1)^2 + sum_j c_j p^
//                    p_j/(p^+p_j)^2 (the virtual draw included, opponents in sha256 order: judgeLadderScore's own sum),
//                    and the record's leave-one-opponent-out jackknife (its k opponents, k at least 2: sqrt((k-1)/k x
//                    sum_j (log p^_-j - mean)^2), judgeLadderLeaveOneOut's p^ without opponent j): a record whose games
//                    cluster by opponent reads as wide as its games bear. Each from the record alone, so a regrade
//                    re-derives a member's se from its own record, whichever other records it holds. As Fixed9; with the
//                    dev score the board showed (the record's verdict on the subject: win rate, se and interval in
//                    millionths, the model's, never the jackknife's: only the screen's cut and round-0 order read it)
//   a member         byte-identical entries are one member: any unrated entry makes it unrated (its first unrated
//                    entry's reason, entries in code-unit order: it enters at the line, the inclusive side); else the
//                    rating whose hi = log p^ + z se (grader/judge-race.ts judgeRaceLog, on the Fixed9 values the screen
//                    reads) is highest, the first such entry's on an exact tie
//   the anchors      each anchor member's calibration strength, from the bundle's ladder (every judge anchor is a
//                    ladder member), in sha256 order
//   contender        the sealed dev contender rounds (grader/judge-contender.ts, agent-fun/judge-contender/v1), when
//                    the caller hands in their chain (judgeScreenContenderOf: the chain held to the bundle's judge
//                    directory, media, artifact, ladder and contender design, its head, rounds, judge and
//                    judgeContenderRatings of its fold). The chain rates an artifact (judgeScreenContenderRatings) when
//                    ALL hold: the bundle's contender_games is above 0; the chain's judge (judgeHeatJudgesOf of its
//                    agent) is one of the final's judges, the same model on the same door; and the artifact (the
//                    final's bytes) is a chain member with at least one contender game, whose rating holds as a
//                    screen's (a strength above 0). A member is contender-rated when the chain rates it AND it is
//                    rated by the rules above (its house-only dev rating): it keeps that rating, every number of it,
//                    and carries the chain's beside it as its `contender` sub-rating (the contender fit's strength and
//                    se, and record_sha256 the chain's head; no millionths), as does each of its entries' verdicts.
//                    The sub-rating places it against the line and in round 0's order (judge-heat.ts
//                    judgeHeatScreenOf), never in a score, and never cuts a member its house-only rating keeps
//                    (judgeHeatScreenOf's house-only floor, which is why the house-only rating stays whole beside
//                    it, and why a member the chain never rated is held to the house-only line as well as the
//                    contender one): a screened-out member scores its house-only dev rating, a
//                    shortlisted one the final's games. A member the chain rates and the rules above leave unrated
//                    stays unrated (it enters at the line, never screened out, so it has no score to take from the
//                    chain). The screen names the chain (`contender`: the head and its rounds) when some member is
//                    contender-rated; with none it names none, and every byte is the house-only screen's
//
// Only + - * / and Math.sqrt over games folded into whole counts (and grader/judge-race.ts judgeRaceLog, built of
// them), sums in sha256 order: the same bits on every host.

import { parseFixed9, toFixed9 } from '../contracts/primitives.ts';
import { judgeShortlistPlaces, type PrizeT, type ProgramJudgeScreenedT, type ProgramJudgeT } from '../contracts/competition.ts';
import type { ProgramJudgeScoreT } from '../contracts/score.ts';
import { canonicalJson, compareCodeUnits } from '../sim/canonical.ts';
import { lastPaidPlace } from '../server/competitions/load.ts';
import type { JudgeOfHeatT } from '../server/judging/pool.ts';
import { judgeContenderRatings, type JudgeContenderDesignT, type JudgeContenderFoldT, type JudgeContenderLadderT, type JudgeContenderRatingT } from './judge-contender.ts';
import {
  JUDGE_HEAT_FORMAT_V3,
  JudgeHeatError,
  JudgeHeatScreenInputs,
  judgeHeatJudgesOf,
  judgeHeatVerdicts,
  type JudgeHeatRecordT,
  type JudgeHeatScreenInputsT,
  type JudgeLadderStrengthT,
  type JudgeScreenContenderRatingT,
  type JudgeScreenMemberT,
  type JudgeScreenRatingT,
  type JudgeScreenUnratedT,
} from './judge-heat.ts';
import { judgeLadderEstimate, judgeLadderFromFixed9, judgeLadderLeaveOneOut, judgeLadderStrengths, judgeLadderToFixed9, type JudgeLadderGameT } from './judge-ladder.ts';
import { judgeRaceLog, judgeRaceNumber } from './judge-race.ts';

/** A final entry the screen rates: its id (as the final's field names it), the final's artifact, and its dev record (null: none). */
export interface JudgeScreenEntryT {
  entry: string;
  artifact_sha256: string;
  /** The v3 record its latest dev grade run links, and that link; null when it has none (or none that loads). */
  dev: { record_sha256: string; record: JudgeHeatRecordT } | null;
}

/** The bundle's ladder as the screen holds a dev record to it: its digests, its design and every member's fixed strength. */
export interface JudgeScreenLadderT {
  ladder_sha256: string;
  calibration_sha256: string;
  rounds: number;
  games: number;
  /** Every ladder member's calibration strength (the judge anchors and the rungs), Fixed9. */
  strengths: readonly JudgeLadderStrengthT[];
}

/**
 * The sealed dev contender chain a screen reads (the header's contender; judgeScreenContenderOf): its head record's
 * sha256, how many rounds it holds, the judge that judged it (its agent's one named model on its door,
 * judgeHeatJudgesOf), and judgeContenderRatings of its fold (each member with a contender game, by artifact sha256).
 */
export interface JudgeScreenContenderT {
  head_sha256: string;
  rounds: number;
  judge: Pick<JudgeOfHeatT, 'model' | 'door'>;
  ratings: ReadonlyMap<string, JudgeContenderRatingT>;
}

export interface JudgeScreenInputsOptions {
  /** The final heat's entries, each with its dev record. */
  entries: readonly JudgeScreenEntryT[];
  /** The final field's anchor members (sha256s). */
  anchors: readonly string[];
  /**
   * The bundle's judge: its directory digest, media and artifact, and its screened block's z and contender_games
   * (absent: 0, no member contender-rated whatever `contender` holds).
   */
  judge: Pick<ProgramJudgeT, 'judge_sha256' | 'media' | 'artifact'> & { screened: { z: string; contender_games?: number } };
  ladder: JudgeScreenLadderT;
  /** The judges the final calls on (its plan's, else its block's one named model on its door). */
  judges: readonly Pick<JudgeOfHeatT, 'model' | 'door'>[];
  /** The dev phase's contender chain (the header's contender); absent: none, every member rated house-only. */
  contender?: JudgeScreenContenderT;
}

/** One entry's screen verdict: its rating, or why it has none. */
export type JudgeScreenEntryVerdictT = { entry: string; artifact_sha256: string } & ({ rated: JudgeScreenRatingT } | { unrated: JudgeScreenUnratedT; why: string });

export interface JudgeScreenInputsResultT {
  /** The heat's screen inputs (judge-heat.ts JudgeHeatScreenInputs): one per entrant member in sha256 order, and the anchors' strengths. */
  inputs: JudgeHeatScreenInputsT;
  /** Each entry's own verdict, in the entries' code-unit order: what the worker logs. */
  entries: JudgeScreenEntryVerdictT[];
  /**
   * With a contender chain handed in: how many members carry its sub-rating (contender-rated, the header's contender),
   * and when none, why (`off`: contender_games 0, another judge, no final member in the chain, or every member it rates
   * unrated on its ladder record); absent with none handed in.
   */
  contender?: { members: number; off: string | null };
}

/** A value from 0 as Fixed9 (an se): toFixed9 of its billionths, rounded. RangeError past 2^53 billionths or not finite. */
function fixed9From0(x: number, what: string): string {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) throw new RangeError(`${what} ${String(x)} is not a finite number from 0`);
  const scaled = Math.round(x * 1e9);
  if (scaled >= 2 ** 53) throw new RangeError(`${what} ${String(x)} is 2^53 billionths or more`);
  return toFixed9(BigInt(scaled));
}

/** A subject's screen se (judgeScreenSe): the model's, the jackknife's (null under two opponents) and the one the screen reads, the larger. */
export interface JudgeScreenSeT {
  /** p^, judgeLadderEstimate's. */
  p: number;
  /** sqrt(phi) / sqrt(I): the ladder model's log-scale se. */
  model: number;
  /** The leave-one-opponent-out jackknife's log-scale se; null when the subject played fewer than two opponents. */
  jackknife: number | null;
  /** The se the screen reads: max(model, jackknife), the model's on a tie or with no jackknife. */
  se: number;
}

/**
 * A subject's screen se from its dev ladder games (the header's rating): p^ = judgeLadderEstimate; the model's
 * log-scale se sqrt(phi) / sqrt(I), I the subject's Fisher information p^/(p^+1)^2 + sum_j c_j p^ p_j/(p^+p_j)^2
 * (opponents in sha256 order); and the leave-one-opponent-out jackknife's over its k opponents (k at least 2):
 * l_j = judgeRaceLog of judgeLadderLeaveOneOut's p^ without opponent j, m their mean, se = sqrt((k - 1) / k x
 * sum_j (l_j - m)^2), sums in sha256 order. The screen reads the larger, so a record whose games cluster by opponent
 * (its outcome hanging on which opponents it drew) is never held to a narrower interval than its games bear; the
 * dev score the board shows keeps the model's (judgeLadderScore). Only + - * / and Math.sqrt: the same bits on every
 * host, for any order of the games. `phi` finite and above 0.
 */
export function judgeScreenSe(subject: string, games: readonly JudgeLadderGameT[], strengths: ReadonlyMap<string, number>, phi: number): JudgeScreenSeT {
  const p = judgeLadderEstimate(subject, games, strengths);
  const left = judgeLadderLeaveOneOut(subject, games, strengths);
  // `left` is in sha256 order, one per opponent with its games: judgeLadderScore's information sum.
  let info = p / ((p + 1) * (p + 1));
  for (const { opponent, games: c } of left) {
    const pj = strengths.get(opponent)!;
    const s = p + pj;
    info += (c * p * pj) / (s * s);
  }
  const model = Math.sqrt(phi) / Math.sqrt(info);
  const k = left.length;
  if (k < 2) return { p, model, jackknife: null, se: model };
  const logs = left.map((l) => judgeRaceLog(l.p));
  let sum = 0;
  for (const l of logs) sum += l;
  const mean = sum / k;
  let squares = 0;
  for (const l of logs) squares += (l - mean) * (l - mean);
  const jackknife = Math.sqrt(((k - 1) * squares) / k);
  return { p, model, jackknife, se: jackknife > model ? jackknife : model };
}

/**
 * The subject's rating from a v3 ladder record (the header's rating): its strength p^ and screen se (judgeScreenSe) as
 * Fixed9, and the record's verdict on it in millionths. RangeError when p^ or se has no Fixed9 form.
 */
function ratingOf(recordSha: string, record: JudgeHeatRecordT, subject: string, verdict: Pick<ProgramJudgeScoreT, 'win_rate_micro' | 'se_micro' | 'interval_low_micro' | 'interval_high_micro'>): JudgeScreenRatingT {
  const ladder = record.ladder!;
  const { p, se } = judgeScreenSe(subject, record.games, judgeLadderStrengths(ladder.strengths), judgeLadderFromFixed9(ladder.dispersion));
  return {
    record_sha256: recordSha,
    strength: judgeLadderToFixed9(p),
    se: fixed9From0(se, 'the se'),
    win_rate_micro: verdict.win_rate_micro,
    se_micro: verdict.se_micro,
    interval_low_micro: verdict.interval_low_micro,
    interval_high_micro: verdict.interval_high_micro,
  };
}

/** Whether a judge the dev record names is one of the final's: the same model on the same door. */
function oneOf(judge: Pick<JudgeOfHeatT, 'model' | 'door'>, finals: readonly Pick<JudgeOfHeatT, 'model' | 'door'>[]): boolean {
  return finals.some((f) => f.model === judge.model && f.door === judge.door);
}

/** One entry's screen verdict (the header's rated rule): its rating, or the first rule it fails and why. */
function verdictOf(e: JudgeScreenEntryT, o: JudgeScreenInputsOptions): JudgeScreenEntryVerdictT {
  const base = { entry: e.entry, artifact_sha256: e.artifact_sha256 };
  const unrated = (why: JudgeScreenUnratedT, words: string): JudgeScreenEntryVerdictT => ({ ...base, unrated: why, why: words });
  if (e.dev === null) return unrated('no_record', 'its latest dev grade links no ladder record');
  const { record, record_sha256: sha } = e.dev;
  const ladder = record.ladder;
  if (record.format !== JUDGE_HEAT_FORMAT_V3 || record.stage !== 'provisional' || ladder === undefined) {
    return unrated('incomplete', `its dev record ${sha} is a ${record.format} ${record.stage} heat's, no ladder heat`);
  }
  if (record.judge_sha256 !== o.judge.judge_sha256 || record.media !== o.judge.media || record.artifact !== o.judge.artifact) {
    return unrated('incomplete', `its dev record ${sha} judged another judge directory, media or artifact than the bundle's`);
  }
  if (ladder.ladder_sha256 !== o.ladder.ladder_sha256 || ladder.calibration_sha256 !== o.ladder.calibration_sha256) {
    return unrated('incomplete', `its dev record ${sha} played another ladder than the bundle's`);
  }
  if (ladder.rounds < o.ladder.rounds || ladder.games < o.ladder.games) {
    return unrated('incomplete', `its dev record ${sha} played ${ladder.rounds} rounds of ${ladder.games} games, short of the bundle's ${o.ladder.rounds} of ${o.ladder.games}`);
  }
  const subjects = record.field.filter((m) => m.entries.length > 0);
  if (subjects.length !== 1) return unrated('incomplete', `its dev record ${sha} judges no one entrant member`);
  const subject = subjects[0]!.artifact_sha256;
  let verdict: ProgramJudgeScoreT;
  try {
    const got = judgeHeatVerdicts(record).get(subject);
    if (got === undefined) return unrated('incomplete', `its dev record ${sha} holds no verdict on its entry`);
    verdict = got;
  } catch (err) {
    if (err instanceof JudgeHeatError) return unrated('incomplete', `its dev record ${sha} does not hold: ${err.message}`);
    throw err;
  }
  let devJudges: JudgeOfHeatT[];
  try {
    devJudges = judgeHeatJudgesOf(record);
  } catch (err) {
    if (err instanceof Error) return unrated('other_judge', `its dev record ${sha} names no judge the final's could be (${err.message})`);
    throw err;
  }
  const off = devJudges.find((j) => !oneOf(j, o.judges));
  if (off !== undefined) return unrated('other_judge', `its dev record ${sha} was judged by ${off.model} on ${off.door}, none of the final's judges (${o.judges.map((j) => `${j.model} on ${j.door}`).join(', ')})`);
  if (subject !== e.artifact_sha256) return unrated('other_artifact', `its dev record ${sha} rated the artifact ${subject}, and its final's is ${e.artifact_sha256}`);
  try {
    return { ...base, rated: ratingOf(sha, record, subject, verdict) };
  } catch (err) {
    if (err instanceof RangeError) return unrated('incomplete', `its dev record ${sha}'s rating has no Fixed9 form: ${err.message}`);
    throw err;
  }
}

/**
 * A bundle's contender design (grader/judge-contender.ts JudgeContenderDesign) from its screened block and prizes: the
 * most contender games a member plays (contender_games), the line's places M (judgeShortlistPlaces over the prizes'
 * last paid place), and its z, phi_margin and epsilon. What a chain's every round plays by, and what a final holds a
 * chain's design to (judgeScreenContenderOf).
 */
export function judgeContenderDesignOf(
  screened: Pick<ProgramJudgeScreenedT, 'contender_games' | 'shortlist_per_paid' | 'shortlist_min' | 'z' | 'phi_margin' | 'epsilon'>,
  prizes: readonly Pick<PrizeT, 'kind' | 'place' | 'amount_usd'>[],
): JudgeContenderDesignT {
  return {
    games: screened.contender_games,
    line_places: judgeShortlistPlaces(screened, lastPaidPlace(prizes)),
    z: screened.z,
    phi_margin: screened.phi_margin,
    epsilon: screened.epsilon,
  };
}

/**
 * A dev contender chain as a final's screen reads it (the header's contender): its fold held to the bundle's judge
 * directory, media and artifact, its sealed ladder (judge-contender.ts JudgeContenderLadder, as worker.ts
 * judgeContenderLadderOf builds it) and its contender design (judgeContenderDesignOf), then its head, its rounds (the
 * fold's round + 1), its judge (judgeHeatJudgesOf of its agent: one named model on its door) and its ratings
 * (judgeContenderRatings). `{ refused }`, saying why, when the chain is not one this bundle's final reads: the screen
 * then rates every member house-only.
 */
export function judgeScreenContenderOf(
  fold: JudgeContenderFoldT,
  o: { judge: Pick<ProgramJudgeT, 'judge_sha256' | 'media' | 'artifact'>; ladder: JudgeContenderLadderT; design: JudgeContenderDesignT },
): JudgeScreenContenderT | { refused: string } {
  if (fold.judge.judge_sha256 !== o.judge.judge_sha256 || fold.judge.media !== o.judge.media || fold.judge.artifact !== o.judge.artifact) {
    return { refused: "the chain was judged on another judge directory, media or artifact than the bundle's" };
  }
  if (canonicalJson(fold.ladder) !== canonicalJson(o.ladder)) return { refused: "the chain rates on another ladder than the bundle's sealed one (its digests, strengths, anchors or phi)" };
  if (canonicalJson(fold.design) !== canonicalJson(o.design)) return { refused: "the chain plays another design than the bundle's screened block (its games, line places, z, phi_margin or epsilon)" };
  let judge: JudgeOfHeatT;
  try {
    const judges = judgeHeatJudgesOf({ agent: fold.judge.agent });
    if (judges.length !== 1) return { refused: 'the chain names no one judge' };
    judge = judges[0]!;
  } catch (err) {
    if (err instanceof Error) return { refused: `the chain names no judge a final's could be (${err.message})` };
    throw err;
  }
  let ratings: Map<string, JudgeContenderRatingT>;
  try {
    ratings = judgeContenderRatings(fold);
  } catch (err) {
    if (err instanceof JudgeHeatError || err instanceof RangeError) return { refused: `the chain's ratings do not fit: ${err.message}` };
    throw err;
  }
  return { head_sha256: fold.head_sha256, rounds: fold.round + 1, judge: { model: judge.model, door: judge.door }, ratings };
}

/**
 * The contender sub-ratings the chain gives the final's artifacts (the header's contender), whatever their dev records
 * say: each by artifact sha256 (the chain's strength and se, record_sha256 its head; never a millionth of its verdict),
 * or why it gives none (`off`). Empty with no chain handed in. judgeScreenInputs attaches one only to a member it rates
 * house-only; grader/regrade.ts judgeScreenChainIssues holds a record's sub-ratings to these.
 */
export function judgeScreenContenderRatings(
  o: Pick<JudgeScreenInputsOptions, 'entries' | 'judges' | 'contender'> & { judge: { screened: { contender_games?: number } } },
): { rated: Map<string, JudgeScreenContenderRatingT>; off: string | null } {
  const rated = new Map<string, JudgeScreenContenderRatingT>();
  const c = o.contender;
  if (c === undefined) return { rated, off: null };
  if ((o.judge.screened.contender_games ?? 0) <= 0) return { rated, off: "the bundle's contender_games is 0: no contender rounds rate a member" };
  if (!oneOf(c.judge, o.judges)) return { rated, off: `the contender rounds were judged by ${c.judge.model} on ${c.judge.door}, none of the final's judges (${o.judges.map((j) => `${j.model} on ${j.door}`).join(', ')})` };
  for (const e of o.entries) {
    const r = c.ratings.get(e.artifact_sha256);
    if (r === undefined || r.games <= 0 || rated.has(e.artifact_sha256)) continue;
    // A rating a screen cannot hold (no strength above 0) rates its member house-only, never the final's fault.
    if (!(parseFixed9(r.strength) > 0n)) continue;
    rated.set(e.artifact_sha256, { record_sha256: c.head_sha256, strength: r.strength, se: r.se });
  }
  return { rated, off: rated.size > 0 ? null : 'no final member is a member of the chain with a contender game' };
}

/**
 * The screen inputs of a screened final (the header): each entry's verdict, then one input per entrant member (the
 * final's distinct artifacts, in sha256 order) and each anchor's calibration strength; and, when some member is
 * contender-rated, the contender chain (the header's contender). Every rated member's rating is its house-only dev
 * rating; a contender-rated one carries the chain's beside it (`contender`), never in place of it. The result parses
 * as JudgeHeatScreenInputs. RangeError when an anchor is no ladder member; TypeError on an entry listed twice.
 */
export function judgeScreenInputs(o: JudgeScreenInputsOptions): JudgeScreenInputsResultT {
  const z = judgeRaceNumber(o.judge.screened.z, 'z', 0, true);
  const ids = o.entries.map((e) => e.entry);
  if (new Set(ids).size !== ids.length) throw new TypeError('the screen lists an entry twice');
  const chain = judgeScreenContenderRatings(o);
  // Each entry rated house-only; a rated one of an artifact the chain rates carries the chain's sub-rating beside it.
  const entries = [...o.entries]
    .sort((x, y) => compareCodeUnits(x.entry, y.entry))
    .map((e): JudgeScreenEntryVerdictT => {
      const v = verdictOf(e, o);
      const c = chain.rated.get(e.artifact_sha256);
      return c === undefined || !('rated' in v) ? v : { ...v, rated: { ...v.rated, contender: { ...c } } };
    });
  const byMember = new Map<string, JudgeScreenEntryVerdictT[]>();
  for (const v of entries) byMember.set(v.artifact_sha256, [...(byMember.get(v.artifact_sha256) ?? []), v]);
  // The house-only rating's hi picks among byte-identical entries; their sub-rating, the chain's, is the same on each.
  const hiOf = (r: JudgeScreenRatingT): number => judgeRaceLog(judgeRaceNumber(r.strength, 'the strength', 0, true)) + z * judgeRaceNumber(r.se, 'the se', 0);
  const members: JudgeScreenMemberT[] = [...byMember.keys()].sort(compareCodeUnits).map((sha) => {
    const list = byMember.get(sha)!;
    const off = list.find((v) => 'unrated' in v);
    if (off !== undefined && 'unrated' in off) return { artifact_sha256: sha, unrated: off.unrated };
    let best: JudgeScreenRatingT | null = null;
    let bestHi = -Infinity;
    for (const v of list) {
      if (!('rated' in v)) continue;
      const hi = hiOf(v.rated);
      if (best === null || hi > bestHi) {
        best = v.rated;
        bestHi = hi;
      }
    }
    const c = best!.contender;
    return { artifact_sha256: sha, rated: { ...best!, ...(c === undefined ? {} : { contender: { ...c } }) } };
  });
  const flaggedMembers = members.filter((m) => 'rated' in m && m.rated.contender !== undefined).length;
  const strengths = new Map(o.ladder.strengths.map((s) => [s.artifact_sha256, s.strength]));
  const anchor_strengths = [...new Set(o.anchors)].sort(compareCodeUnits).map((sha) => {
    const strength = strengths.get(sha);
    if (strength === undefined) throw new RangeError(`the anchor ${sha} is no member of the bundle's ladder, so it has no calibration strength`);
    parseFixed9(strength);
    return { artifact_sha256: sha, strength };
  });
  const flagged = flaggedMembers > 0 && o.contender !== undefined ? { contender: { record_sha256: o.contender.head_sha256, rounds: o.contender.rounds } } : {};
  const off = flaggedMembers > 0 ? null : (chain.off ?? 'every final member the chain rates is unrated on its ladder record, so it enters at the line');
  return {
    inputs: JudgeHeatScreenInputs.parse({ members, anchor_strengths, ...flagged }),
    entries,
    ...(o.contender === undefined ? {} : { contender: { members: flaggedMembers, off } }),
  };
}
