// The k8s sandbox's recurring list reads (k8s.ts's header, Room on the node) asked of the API server in-process, not of
// a kubectl spawned for each. A grader reads the nodes and the pods bound to each (K8sSandbox.nodePodRooms), its live
// graders (runningGraders) and the sandbox pods its namespace holds (sandboxPodsHeld) every few seconds, idle or not.
// Measured on makefun-prod (2026-11-12): kubectl decodes every pod whole even for `-o name` (0.54 s of CPU for s18's
// 1.07 MB list, about 0.94 s for one room read), so those reads cost a grader about 0.135 cores idle, 17% of its CPU,
// and 0.47 cores a process while jobs wait for room. The same counts asked as a Table (`Accept:
// application/json;as=Table;g=meta.k8s.io;v=v1`, `includeObject=None`: one row of cells per object, 16 KB for s18) cost
// 1.3-1.6 ms each, with the same `list` verbs the Role and node-read.yaml grant already.
//
// apiListExec is a KubectlExec over the API server: it answers the argv shapes of those reads, `[-n <ns>] get
// pods|nodes [--all-namespaces] [-l <sel>] [--field-selector <sel>] -o name|json`, as kubectl would print them (`pod/<name>`
// lines from the Table's first cell; the API server's own JSON list), and hands every other argv to kubectl. A 403 is
// kubectl's `Error from server (Forbidden): <message>` (what K8sSandbox's refusal path reads); a call its budget or its
// signal cut is kubectl's cut (`error`), never sent again. A shed (HTTP 429, or any 5xx: the API server's Priority and
// Fairness rejecting a queued request, its own timeout, etcd's) is a cut too, never handed to kubectl: kubectl's full
// JSON list is the heavier ask of the same congested flow, and its client-go retries a 429 up to ten times itself. The
// shed opens a streak (said once, and once more when a list answers again): no list is asked until its Retry-After
// (APF's: 1 to 32 s) or LIST_SHED_FIRST_MS doubling on each shed in a row, whichever is longer, up to LIST_SHED_MAX_MS;
// meanwhile each list read answers the streak's cut at once, which every caller reads as unknown. Each list asks with
// `timeout=` a little under its budget (listTimeoutParam), so the API server stops a request no one waits for, and
// APF's queue holds it at most a quarter of that before it answers 429 rather than leave the budget to cut it. Any
// other failure (a token or CA that cannot be read, TLS, a connection refused, another status, a body that is no
// list), the in-process client unable to ask, is that one call sent to kubectl, said once until it changes. In a pod
// (KUBERNETES_SERVICE_HOST and _PORT set, no KUBECONFIG, the service-account token mounted: inClusterApiGet) it reads
// the token and CA from the mount on every call, since a projected token rotates. Node's https alone: no client
// library. Each shed answer counts on makefun_k8s_api_sheds_total{resource,code} (server/ops/metrics.ts), which the
// Capacity board and the k8s-api-sheds rule read.
//
// A `-o json` list is never parsed on the event loop: s18's pod lists run to megabytes, and a JSON.parse of one held a
// grader's and the worker's loop 60-80 ms, twice over (once here to see it is a list, once by the caller to read it).
// projectListBody, run on the off-thread pool (projectListTask, server/offthread), parses the body and hands back only
// the fields a caller reads (ListKeep: the caller's paths into each item), as a ListDoc. apiListExec keeps the doc it
// made with the result (listedDocOf), so the caller that asked under the same keep reads it with no second parse; any
// other list's stdout (kubectl's) is projected by its caller off the loop the same way (listDocOf). The pool saturated
// or failing is the list's cut (`error`), which every caller reads as unknown: never parsed on the loop instead.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Agent, request } from 'node:https';
import type { LookupFunction } from 'node:net';
import { join } from 'node:path';
import { defineOffThreadTask, runOffThread } from '../../server/offthread/index.ts';
import type { KubectlExec, KubectlResult } from './k8s.ts';

/** Where a pod's service-account token, CA and namespace are mounted. */
export const SERVICE_ACCOUNT_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';

/** A list as a Table (meta.k8s.io/v1): one row per object, its cells the printer's columns, the name first. */
export const TABLE_ACCEPT = 'application/json;as=Table;g=meta.k8s.io;v=v1';
export const JSON_ACCEPT = 'application/json';

/** One answer of the API server: its status and its body. */
export interface ApiAnswer {
  status: number;
  body: string;
  /** Its Retry-After header, when it sent one (APF's 429 does: whole seconds). */
  retryAfter?: string;
}

/** The least wait after a shed list with no longer Retry-After: doubled for each shed in a row. */
export const LIST_SHED_FIRST_MS = 2_000;
/** The longest wait after a shed list, its Retry-After's included. */
export const LIST_SHED_MAX_MS = 60_000;

/** Whether an answer's status is a shed: 429, or any 5xx. */
export const isShed = (status: number): boolean => status === 429 || (status >= 500 && status <= 599);

/** A Retry-After header (delay-seconds or an HTTP-date) in ms from `now`, or 0 when absent or unreadable. */
export function retryAfterMs(value: string | undefined, now: number = Date.now()): number {
  if (value === undefined) return 0;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? 0 : Math.max(0, at - now);
}

/** The wait after the `streak`-th shed in a row (1 the first): its Retry-After or the doubled floor, the longer, capped. */
export function shedWaitMs(streak: number, retryAfter: number, first: number = LIST_SHED_FIRST_MS, max: number = LIST_SHED_MAX_MS): number {
  const floor = first * 2 ** Math.min(Math.max(0, streak - 1), 20);
  return Math.min(max, Math.max(retryAfter, floor));
}

/**
 * The `timeout` query value of a list asked within `budgetMs`: 90% of it in whole seconds, at least one. The API server
 * ends the request there (its request deadline), and APF's queue holds it at most a quarter of that.
 */
export function listTimeoutParam(budgetMs: number): string {
  return `${Math.max(1, Math.floor((budgetMs * 0.9) / 1000))}s`;
}

export interface ApiGetOptions {
  accept: string;
  /** No answer within it: an ApiCut. */
  timeoutMs: number;
  /** Aborting it cuts the request: an ApiCut. */
  signal?: AbortSignal;
}

/** A GET of `path` (with its query) on the API server; throws ApiCut when cut, any other Error when it could not be asked. */
export type ApiGet = (path: string, opts: ApiGetOptions) => Promise<ApiAnswer>;

/** A request its budget or its signal cut: kubectl's SIGKILL, said the same way, and not asked again. */
export class ApiCut extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiCut';
  }
}

/** The API server and the credentials apiGet reads per call. */
export interface ApiTarget {
  host: string;
  port: number;
  /** The bearer token's file, read on every call. */
  tokenFile: string;
  /** The CA bundle the server's certificate is checked against, read on every call. */
  caFile: string;
  /** How `host` resolves (default the system's); tests point a name at a local server. */
  lookup?: LookupFunction;
}

/**
 * GETs on `target`: the token and CA read fresh each call, over one keep-alive agent per CA (a new CA, a new agent),
 * the request destroyed at its budget or its signal.
 */
export function apiGet(target: ApiTarget): ApiGet {
  let held: { ca: string; agent: Agent } | null = null;
  return async (path, opts) => {
    if (opts.signal?.aborted === true) throw new ApiCut('cut off');
    const [token, ca] = await Promise.all([readFile(target.tokenFile, 'utf8'), readFile(target.caFile, 'utf8')]);
    const bearer = token.trim();
    if (bearer === '') throw new Error(`the service-account token ${target.tokenFile} is empty`);
    if (held === null || held.ca !== ca) {
      held?.agent.destroy();
      held = { ca, agent: new Agent({ keepAlive: true, maxSockets: 4, ca }) };
    }
    const agent = held.agent;
    return new Promise<ApiAnswer>((resolve, reject) => {
      let cut: string | null = null;
      let settled = false;
      const timer = setTimeout(() => stop(`no answer within ${opts.timeoutMs} ms`), opts.timeoutMs);
      timer.unref();
      const onAbort = (): void => stop('cut off');
      const finish = (): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        return true;
      };
      const fail = (err: Error): void => {
        if (finish()) reject(cut === null ? err : new ApiCut(cut));
      };
      const req = request(
        {
          hostname: target.host,
          port: target.port,
          path,
          method: 'GET',
          agent,
          headers: { accept: opts.accept, authorization: `Bearer ${bearer}` },
          ...(target.lookup === undefined ? {} : { lookup: target.lookup }),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (b: Buffer) => chunks.push(b));
          res.on('error', fail);
          res.on('end', () => {
            const retryAfter = res.headers['retry-after'];
            if (finish()) resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), ...(typeof retryAfter === 'string' ? { retryAfter } : {}) });
          });
          res.on('close', () => {
            if (!res.complete) fail(new Error('the API server closed its answer before its end'));
          });
        },
      );
      function stop(why: string): void {
        cut ??= why;
        req.destroy(new Error(why));
      }
      req.on('error', fail);
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      req.end();
    });
  };
}

/**
 * The API server this process's pod reaches with its own service account, as kubectl's in-cluster config finds it:
 * KUBERNETES_SERVICE_HOST and KUBERNETES_SERVICE_PORT set, no KUBECONFIG (kubectl would read that instead), and the
 * token mounted in `dir`. Null anywhere else (a run from outside the cluster, the e2e rig, k3s from a shell).
 */
export function inClusterApiGet(env: NodeJS.ProcessEnv = process.env, dir: string = SERVICE_ACCOUNT_DIR): ApiGet | null {
  const host = env.KUBERNETES_SERVICE_HOST;
  const port = Number(env.KUBERNETES_SERVICE_PORT);
  if (host === undefined || host === '' || !Number.isInteger(port) || port <= 0 || port > 65_535) return null;
  if (env.KUBECONFIG !== undefined && env.KUBECONFIG !== '') return null;
  const tokenFile = join(dir, 'token');
  if (!existsSync(tokenFile)) return null;
  return apiGet({ host, port, tokenFile, caFile: join(dir, 'ca.crt') });
}

/** One list read apiListExec answers: what it asks and how kubectl would print the answer. */
export interface ListRead {
  resource: 'pods' | 'nodes';
  path: string;
  accept: string;
  /** `-o name` (a Table, printed by `print`) or `-o json` (the server's list as it sent it, once projectListBody reads one). */
  output: 'name' | 'json';
  /** `-o name`'s lines (null: no list in it); null for `-o json`, whose list is read off the loop (projectListBody). */
  print: ((body: string) => string | null) | null;
}

const SINGULAR = { pods: 'pod', nodes: 'node' } as const;

/** `-o name` from a Table (cells[0] of each row), or from a plain list should the server answer one: `<kind>/<name>` lines. */
function printNames(kind: string, body: string): string | null {
  let doc: { kind?: unknown; rows?: unknown; items?: unknown };
  try {
    doc = JSON.parse(body) as typeof doc;
  } catch {
    return null;
  }
  let names: unknown[];
  if (doc?.kind === 'Table' && Array.isArray(doc.rows)) names = doc.rows.map((r: { cells?: unknown[] } | null) => r?.cells?.[0]);
  else if (Array.isArray(doc?.items)) names = doc.items.map((i: { metadata?: { name?: unknown } } | null) => i?.metadata?.name);
  else return null;
  if (!names.every((n): n is string => typeof n === 'string' && n !== '')) return null;
  return names.map((n) => `${kind}/${n}\n`).join('');
}

// ---------------------------------------------------------------- a JSON list, off the loop

/**
 * Paths into a listed object, one per field a caller reads: keys in order, `*` for each element of an array (its keys
 * then apply to every element). A path that ends keeps its value whole.
 */
export type ListKeep = readonly (readonly string[])[];

/**
 * A `-o json` list as projectListBody reads it: `parsed` false when the text is no JSON. Otherwise `doc` is the
 * parsed document cut to what a caller reads: `null` or a primitive as it was; an object as `{ items }` alone (absent
 * when the document has none), `items` an array of each item cut to `keep` (a field a path names copied where it is
 * present: an object or array descended into, anything else as it was), or, when it is no array, as it was. So
 * `doc?.items` and every `item?.a?.b` a path names read as they would on the whole document.
 */
export type ListDoc = { parsed: false } | { parsed: true; doc: unknown };

type KeepTrie = { [key: string]: KeepTrie } | null;

function keepTrie(keep: ListKeep): KeepTrie {
  const root: { [key: string]: KeepTrie } = {};
  let whole = false;
  for (const path of keep) {
    if (path.length === 0) whole = true;
    let at: { [key: string]: KeepTrie } = root;
    for (let i = 0; i < path.length; i++) {
      const key = path[i]!;
      const last = i === path.length - 1;
      const next = Object.hasOwn(at, key) ? at[key]! : undefined;
      if (last) {
        at[key] = null;
        break;
      }
      if (next === null) break; // a shorter path keeps it whole already
      at = at[key] = next ?? {};
    }
  }
  return whole ? null : root;
}

function project(value: unknown, trie: KeepTrie): unknown {
  if (trie === null || value === null || typeof value !== 'object') return value;
  const keys = Object.keys(trie);
  if (Object.hasOwn(trie, '*')) {
    if (!Array.isArray(value)) return value;
    const each = trie['*']!;
    return value.map((v) => project(v, each));
  }
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = Array.isArray(value) ? ([] as unknown as Record<string, unknown>) : {};
  for (const key of keys) if (Object.hasOwn(src, key)) out[key] = project(src[key], trie[key]!);
  return out;
}

/** A `-o json` list's text read and cut to `keep` (ListDoc). Pure: the off-thread task projectListTask runs it. */
export function projectListBody(input: { body: string; keep: ListKeep }): ListDoc {
  let doc: unknown;
  try {
    doc = JSON.parse(input.body);
  } catch {
    return { parsed: false };
  }
  if (doc === null || typeof doc !== 'object') return { parsed: true, doc };
  if (!Object.hasOwn(doc, 'items')) return { parsed: true, doc: {} };
  const items = (doc as { items: unknown }).items;
  if (!Array.isArray(items)) return { parsed: true, doc: { items } };
  const trie = keepTrie(input.keep);
  return { parsed: true, doc: { items: items.map((item) => project(item, trie)) } };
}

/** projectListBody on the off-thread pool: a list's parse never holds the event loop. */
export const projectListTask = defineOffThreadTask<typeof projectListBody>('k8s.list-project', import.meta.url, 'projectListBody', { timeoutMs: 30_000 });

/** The ListDoc apiListExec made of a result's list, and the keep it was cut to. */
const listedDocs = new WeakMap<KubectlResult, { keep: ListKeep; doc: ListDoc }>();

/** The ListDoc apiListExec made of `result`'s list under `keep` (the same array), or null. */
export function listedDocOf(result: KubectlResult, keep: ListKeep): ListDoc | null {
  const kept = listedDocs.get(result);
  return kept !== undefined && kept.keep === keep ? kept.doc : null;
}

/**
 * `result`'s `-o json` stdout as a ListDoc cut to `keep`: apiListExec's own when it made one under that keep, else
 * projectListBody of it run off the loop. Rejects with the pool's OffThreadError when the pool cannot run it (the
 * caller reads the list as unknown), never parses on the loop.
 */
export async function listDocOf(result: KubectlResult, keep: ListKeep): Promise<ListDoc> {
  return listedDocOf(result, keep) ?? (await runOffThread(projectListTask, { body: result.stdout, keep }));
}

/** A list's items from a ListDoc as `(JSON.parse(stdout) as { items?: unknown } | null)?.items` reads them; undefined for a text that is no JSON. */
export function listItemsOf(listed: ListDoc): unknown {
  return listed.parsed ? (listed.doc as { items?: unknown } | null)?.items : undefined;
}

/**
 * The list read an argv asks for, or null for every argv apiListExec leaves to kubectl: `[-n|--namespace <ns>] get
 * pods|nodes` with only `--all-namespaces`/`-A`, `-l`/`--selector`, `--field-selector` (each as one word with `=` or
 * as two) and `-o`/`--output` name or json. Pods need a namespace or every one; nodes take neither.
 */
export function listRead(args: readonly string[]): ListRead | null {
  let i = 0;
  let namespace: string | null = null;
  if (args[0] === '-n' || args[0] === '--namespace') {
    namespace = args[1] ?? null;
    if (namespace === null || namespace === '') return null;
    i = 2;
  }
  if (args[i] !== 'get') return null;
  const resource = args[i + 1];
  if (resource !== 'pods' && resource !== 'nodes') return null;
  let all = false;
  let labels: string | null = null;
  let fields: string | null = null;
  let output: string | null = null;
  for (let j = i + 2; j < args.length; j++) {
    const a = args[j]!;
    const eq = a.indexOf('=');
    const flag = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
    const inline = flag === a ? null : a.slice(eq + 1);
    if (flag === '--all-namespaces' || flag === '-A') {
      if (inline !== null) return null;
      all = true;
      continue;
    }
    const value = inline ?? args[++j];
    if (value === undefined) return null;
    if (flag === '-l' || flag === '--selector') labels = value;
    else if (flag === '--field-selector') fields = value;
    else if (flag === '-o' || flag === '--output') output = value;
    else return null;
  }
  if (output !== 'name' && output !== 'json') return null;
  let base: string;
  if (resource === 'nodes') {
    if (namespace !== null || all) return null;
    base = '/api/v1/nodes';
  } else if (all) base = '/api/v1/pods';
  else if (namespace !== null) base = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`;
  else return null;
  const query = new URLSearchParams();
  if (labels !== null && labels !== '') query.set('labelSelector', labels);
  if (fields !== null && fields !== '') query.set('fieldSelector', fields);
  if (output === 'name') query.set('includeObject', 'None');
  const q = query.toString();
  const kind = SINGULAR[resource];
  return {
    resource,
    path: q === '' ? base : `${base}?${q}`,
    accept: output === 'name' ? TABLE_ACCEPT : JSON_ACCEPT,
    output,
    print: output === 'name' ? (body) => printNames(kind, body) : null,
  };
}

/** A Status body's message (a refusal's words), else the body's first line. */
function statusMessage(body: string): string {
  try {
    const m = (JSON.parse(body) as { message?: unknown })?.message;
    if (typeof m === 'string' && m !== '') return m;
  } catch {
    // not a Status
  }
  return body.trim().split('\n')[0]?.slice(0, 300) ?? '';
}

export interface ApiListOptions {
  /** A call's budget when it names none (kubectlExec's: KUBECTL_TIMEOUT_MS). */
  timeoutMs: number;
  /** Where a fall back to kubectl, and a shed streak's start and end, are said, once until its reason changes. */
  warn: (line: string) => void;
  /** The clock a shed's wait is timed by (default Date.now). */
  now?: () => number;
  /**
   * What the callers of a `-o json` list read of each item, by resource (ListKeep): the doc apiListExec makes of the
   * list is cut to it and kept with the result (listedDocOf), so the caller reads it with no second parse. None: the
   * list is read whole by its caller (listDocOf), this read only seeing that it is one.
   */
  keep?: Partial<Record<ListRead['resource'], ListKeep>>;
}

/** The keep a list is checked under when its caller named none: nothing of an item. */
const NO_FIELDS: ListKeep = [];

/** A KubectlExec that answers the list reads listRead knows from `get` and hands everything else to `kubectl` (the header). */
export function apiListExec(get: ApiGet, kubectl: KubectlExec, opts: ApiListOptions): KubectlExec {
  const now = opts.now ?? Date.now;
  let said: string | null = null;
  // The open shed streak: how many in a row, the first one's words, and when a list is asked again.
  let shed: { streak: number; problem: string; until: number } | null = null;
  const shedCut = (resource: string, problem: string): KubectlResult => ({
    code: null,
    stdout: '',
    stderr: '',
    error: `kubectl get ${resource}: the API server shed the in-process lists (${problem}): none is asked until it may be again`,
  });
  return async (args, call = {}) => {
    const read = call.input === undefined ? listRead(args) : null;
    if (read === null) return kubectl(args, call);
    if (shed !== null && now() < shed.until) return shedCut(read.resource, shed.problem);
    const viaKubectl = (problem: string): Promise<KubectlResult> => {
      if (problem !== said) opts.warn(`k8s sandbox: the API server's list of ${read.resource} could not be read in-process (${problem}): kubectl reads it instead until it can`);
      said = problem;
      return kubectl(args, call);
    };
    const budget = call.timeoutMs ?? opts.timeoutMs;
    const path = `${read.path}${read.path.includes('?') ? '&' : '?'}timeout=${listTimeoutParam(budget)}`;
    let answer: ApiAnswer;
    try {
      answer = await get(path, { accept: read.accept, timeoutMs: budget, ...(call.signal === undefined ? {} : { signal: call.signal }) });
    } catch (err) {
      if (err instanceof ApiCut) return { code: null, stdout: '', stderr: '', error: `kubectl get ${read.resource}: ${err.message}` };
      return viaKubectl((err as Error).message);
    }
    if (isShed(answer.status)) {
      // makefun_k8s_api_sheds_total: every shed answer, where the line below says only a streak's first. Imported here,
      // not at the top: projectListTask's threads import this module, and the metrics module starts collectors at import.
      const { countK8sApiShed } = await import('../../server/ops/metrics.ts');
      countK8sApiShed(read.resource, answer.status);
      const problem = `HTTP ${answer.status}: ${statusMessage(answer.body)}`;
      const streak = (shed?.streak ?? 0) + 1;
      const wait = shedWaitMs(streak, retryAfterMs(answer.retryAfter, now()));
      if (shed === null) {
        opts.warn(
          `k8s sandbox: the API server shed the in-process list of ${read.resource} (${problem}${answer.retryAfter === undefined ? '' : `, Retry-After ${answer.retryAfter}`}): no list is asked of it for ${wait} ms, longer while it sheds, and each list read answers unknown meanwhile; kubectl is not asked instead`,
        );
      }
      shed = { streak, problem: shed?.problem ?? problem, until: now() + wait };
      return shedCut(read.resource, shed.problem);
    }
    const answered = (): void => {
      if (shed !== null) opts.warn(`k8s sandbox: the API server answers the in-process lists again, after ${shed.streak} shed in a row`);
      shed = null;
    };
    if (answer.status === 403) {
      answered();
      said = null;
      return { code: 1, stdout: '', stderr: `Error from server (Forbidden): ${statusMessage(answer.body)}\n` };
    }
    if (answer.status !== 200) return viaKubectl(`HTTP ${answer.status}: ${statusMessage(answer.body)}`);
    const noList = (): Promise<KubectlResult> => viaKubectl(`HTTP 200 with no list: ${JSON.stringify(answer.body.slice(0, 120))}`);
    if (read.print !== null) {
      const stdout = read.print(answer.body);
      if (stdout === null) return noList();
      answered();
      said = null;
      return { code: 0, stdout, stderr: '' };
    }
    // -o json: the body is the stdout as kubectl prints it, once the pool has read it as a list (and cut it to the keep)
    const keep = opts.keep?.[read.resource] ?? NO_FIELDS;
    let listed: ListDoc;
    try {
      listed = await runOffThread(projectListTask, { body: answer.body, keep }, call.signal === undefined ? {} : { signal: call.signal });
    } catch (err) {
      return { code: null, stdout: '', stderr: '', error: `kubectl get ${read.resource}: its list could not be read off the event loop (${(err as Error).message})` };
    }
    if (!Array.isArray(listItemsOf(listed))) return noList();
    answered();
    said = null;
    const result: KubectlResult = { code: 0, stdout: answer.body, stderr: '' };
    listedDocs.set(result, { keep, doc: listed });
    return result;
  };
}
