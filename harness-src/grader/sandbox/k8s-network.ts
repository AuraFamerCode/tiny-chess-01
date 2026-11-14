// The k8s driver's trial networks (MAKEFUN_SANDBOX=k8s, K8sSandbox.networks): network.ts's docker networks
// in NetworkPolicy form. A trial's network is one NetworkPolicy in the worker's namespace, made before any
// of the trial's pods (deploy/k8s/README.md d4: a fresh pod's first connect can get out before Ready):
//
//   makefun-net-<trial>   labels makefun.grader=1, makefun.net=<trial>[, makefun.trial=<ownerLabel(owner)>]
//     [annotation makefun.io/trial-owner=<owner>]
//     podSelector makefun.net=<trial>; policyTypes Ingress and Egress;
//     ingress from and egress to podSelector makefun.net=<trial>
//
// NetworkPolicies only add allows to the namespace's own (deploy/k8s/base/networkpolicies.yaml):
// makefun-sandbox-deny selects every sandbox pod and allows nothing, makefun-sandbox-egress lets a pod
// labelled makefun.egress=1 out to the world minus every private range and the fleet's servers. So a
// trial's pods reach one another, its forwarders (`llm`, and `house` with a target) or scrape gateway the
// world besides (and a forwarder its LLM gateway: k8s.ts gatewayPolicy), and nothing reaches a trial's pod
// from outside its trial; within it the forwarders admit their callers by a credential
// (grader/gateway/server.ts GatewayClient). The names its pods answer to are K8sSandbox's PodNames
// (hostAliases); its owner is what its pods are labelled with:
// k8s.ts ownerLabel of it (the owner itself when it is a label value, else a hash of it: a label value is at
// most 63 characters, an owner up to 128), the owner whole in the annotation makefun.io/trial-owner.
//
// remove deletes the trial's pods (makefun.net=<trial>), then its policy; reap every pod and policy of an
// owner (makefun.trial=<ownerLabel(owner)>), listed again REAP_ROUNDS times while any is left; sweepStale every grader
// pod and policy (makefun.grader=1) older than STALE_AFTER_MS. Each pod delete is k8s.ts KUBECTL_DELETE_FLAGS' graceful
// one, so a pod deleted is listed (a metadata.deletionTimestamp) until the kubelet has ended it: reap counts it as
// gone, and sweepStale passes over it. Secrets need none of it: an env Secret is
// owned by its pod (k8s.ts ownedByPod) and Kubernetes deletes it with the pod. ensureEgress only checks that
// makefun-sandbox-egress is there: the worker's Role may not write the namespace's own policies, and
// `makefun-k8s.sh bootstrap` applies them.
//
// All of the above is the `split` layout's (grader/sandbox/layout.ts), which a contest born before the `pod` layout's
// go-live, or listed on SPLIT_COMPETITIONS, keeps for its whole life. Beside it, a `pod` trial makes no trial network:
// its one pod's members reach one another on the pod's own loopback (`store` a hostAlias of 127.0.0.1), its pod carries
// makefun.egress=lanes and no makefun.net or makefun.trial, and its one way out of itself is the door of the lanes pods
// (makefun.io/sandbox=lanes) on the door's three ports: two static policies of the kit's own, makefun-sandbox-to-lanes
// and makefun-sandbox-lanes (deploy/k8s/components/one-pod), which nothing here makes or deletes. Its reap by owner is
// k8s.ts K8sOnePodTrialNetworks: this file's reap, then its plan pods by the owner annotation. A grader's lanes pod
// keeps a forwarder pod's reach (makefun.egress=1 and its own `<pod>-llm`). What shares a sandbox on `pod`: the env's
// hidden state and house token with the entrant's code, sharing the network namespace (loopback, abstract unix sockets)
// and the CPU and memory totals; and a grader's lanes with one another (their kernel, loopback, egress, CPU and memory
// total and root program). Both are weaker than `split`, and no NetworkPolicy stands between the members of one sandbox.
//
// Isolation (probeK8sIsolation) is network.ts's probe in pod form, five roles in four node22 pods made at
// once with the probe trial's policy, each reach run by exec once its pod is Ready:
//
//   listener  an egress pod running ISOLATION_LISTENER_SCRIPT on SERVICE_PORT (as a forwarder is)
//   control   the listener reaches its own address: the probe works at all
//   pair      the allowed pair: a pod on the probe trial's network (`inside`, as an entry is) must reach another on
//             it (`peer`, running the same listener, as a service is), the two kept apart by their own soft spread
//             (k8s.ts pairSpread), so they prefer two nodes; dialled as the entry's policy wait dials
//             (ISOLATION_PAIR_SCRIPT), and timed
//   sibling   another egress pod must not reach the listener: the egress pods of concurrent trials are
//             kept apart (docker's enable_icc=false), so the namespace's policies are enforced at all
//   inside    the pair's pod on the probe trial's network must reach neither the listener nor the world
//             (ISOLATION_WORLD)
//
// The control runs again after the sibling, so a listener that died is not taken for a kept-apart pair. A trial's pods
// may sit on different nodes (s18 and s9), so the pair runs first, and a pair that did not connect is a fault of its
// own, never read as enforcement (a SandboxError naming both pods' nodes; the peer's own control tells a listener that
// never answered from routing that failed). The pair's spread is a preference: on dsh-makefun s18 is often out of pod
// addresses, so the pair may share s9. Such a probe still gives its verdict on the reaches as it always did, a blocked
// reach between nodes included, and a verdict that holds says the pair shared a node and routing between nodes is not
// proven by it; failing it instead would leave every agent trial waiting on a probe that cannot pass. Every verdict
// names the node each of the probe's pods ran on, and one that holds says how long after both pair pods were Ready its
// first connect came, at most: the driver's clock from the later Ready to the dial's exec, plus the dial's own time on
// the pod's clock (what POLICY_WAIT_MS, k8s.ts, is set from). Its verdict is kept as docker's is (an EngineIsolation of
// this probe): one that holds for the process, a refusal for ISOLATION_RECHECK_MS; a probe that could not run rejects
// with a SandboxError and is run again by the next ask. A refusal's faults are the k8s driver's own (types.ts
// IsolationFault): policy_not_enforced (an egress pod reached another) and trial_pod_escapes (a pod on a trial's
// network got past it); its verdicts say driver k8s.
//
// k8s.ts imports this module for K8sSandbox and this one k8s.ts for its kubectl helpers: nothing here reads
// a k8s.ts binding as the module loads, only once called.

import { randomBytes } from 'node:crypto';
import { imageFor, type ImageTableT } from '../images.ts';
import { CONTAINER_LABEL } from './docker.ts';
import {
  awaitPod,
  beingDeleted,
  CONTAINER,
  deleteObjects,
  isolationPodSpec,
  kubectl,
  KUBECTL_CREATE,
  KUBECTL_DELETE_FLAGS,
  labelValue,
  ownerAnnotations,
  ownerLabel,
  POD_PREFIX,
  podName,
  readPod,
  why,
  type K8sContext,
  type K8sObject,
  type KubectlResult,
  type PodPlacement,
} from './k8s.ts';
import {
  EGRESS_LABEL,
  EngineIsolation,
  ISOLATION_LISTENER_S,
  ISOLATION_LISTENER_SCRIPT,
  ISOLATION_PROBE_MS,
  ISOLATION_REACH_SCRIPT,
  ISOLATION_RECHECK_MS,
  NETWORK_EXISTS_HINT,
  NETWORK_LABEL,
  OWNER_LABEL,
  parseDockerTime,
  readReach,
  REAP_ROUNDS,
  SERVICE_PORT,
  STALE_AFTER_MS,
  trialNetworkName,
  type DriverVerdict,
  type Reach,
} from './network.ts';
import { SandboxError, TRIAL_NETWORK_PREFIX, type IsolationVerdict, type ReapResult, type SweepResult, type TrialNetworks } from './types.ts';

/** The namespace's egress policy (deploy/k8s/base/networkpolicies.yaml): what ensureEgress checks is there. */
export const EGRESS_POLICY = 'makefun-sandbox-egress';
/** Where the isolation probe's inside pod must not get to: an address the world answers on (README e1). */
export const ISOLATION_WORLD: Readonly<{ host: string; port: number }> = Object.freeze({ host: '1.1.1.1', port: 443 });
/**
 * The allowed pair's dial (`node -e`, argv: host, port, ms), as an entry's policy wait dials (k8s.ts POLICY_WAIT_ARGV:
 * 250 ms an attempt, 20 ms apart, any failure tried again), so what it times is what that wait sees: until host:port
 * takes a connection or the deadline passes. Prints one line, {reached, how, ms, attempts}: how it ended (`connect`, or
 * the last attempt's error code), the ms from the script's start to that end, and how many attempts it made.
 */
export const ISOLATION_PAIR_SCRIPT = [
  "const net = require('node:net');",
  'const [host, port, ms] = process.argv.slice(1);',
  'const start = Date.now();',
  'const deadline = start + Number(ms);',
  'let attempts = 0;',
  'const done = (reached, how) => {',
  "  process.stdout.write(JSON.stringify({ reached, how, ms: Date.now() - start, attempts }) + '\\n');",
  '  process.exit(0);',
  '};',
  'const attempt = () => {',
  '  attempts += 1;',
  '  let over = false;',
  '  const s = net.connect({ host, port: Number(port) });',
  '  const end = (how) => {',
  '    if (over) return;',
  '    over = true;',
  '    clearTimeout(timer);',
  '    s.destroy();',
  "    if (how === 'connect') done(true, how);",
  '    else if (Date.now() + 20 < deadline) setTimeout(attempt, 20);',
  '    else done(false, how);',
  '  };',
  "  const timer = setTimeout(() => end('TIMEOUT'), Math.max(1, Math.min(250, deadline - Date.now())));",
  "  s.once('connect', () => end('connect'));",
  "  s.once('error', (e) => end(String(e.code || e.message)));",
  '};',
  'attempt();',
].join('\n');

/** What the allowed pair's dial (ISOLATION_PAIR_SCRIPT) found. */
export interface PairDial {
  reached: boolean;
  how: string;
  /** From the script's start to its end, on the pod's clock. */
  ms: number;
  attempts: number;
}
/** The kubectl resource name of a NetworkPolicy, as `-o name` prints it. */
const POLICY_RESOURCE = 'networkpolicy.networking.k8s.io';
/**
 * reap's list: one line per pod or policy, `<kind>/<name>`, then its metadata.deletionTimestamp after a space when it is
 * being deleted (kubectl prints nothing for a missing key); nothing at all for none.
 */
export const REAP_LIST_JSONPATH = 'jsonpath={range .items[*]}{.kind}/{.metadata.name} {.metadata.deletionTimestamp}{"\\n"}{end}';
const NOT_FOUND_RE = /\(NotFound\)|not found/i;
const EXISTS_RE = /\(AlreadyExists\)|already exists/i;

/**
 * Trial `trial`'s NetworkPolicy (the header's): its pods reach one another, both ways, and nothing else it
 * allows. Labelled with its owner's label when one is given (ownerLabel: what reap finds it by), and
 * annotated with the owner whole.
 */
export function trialPolicy(trial: string, opts: { namespace: string; owner: string | null }): K8sObject {
  const name = trialNetworkName(trial);
  const net = labelValue(trial, 'trial');
  const [graderKey, graderValue] = CONTAINER_LABEL.split('=') as [string, string];
  const labels: Record<string, string> = { [graderKey]: graderValue, [NETWORK_LABEL]: net };
  if (opts.owner !== null) labels[OWNER_LABEL] = ownerLabel(opts.owner);
  const annotations = ownerAnnotations(opts.owner);
  const peers = () => ({ podSelector: { matchLabels: { [NETWORK_LABEL]: net } } });
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name, namespace: opts.namespace, labels, ...(annotations === undefined ? {} : { annotations }) },
    spec: {
      podSelector: { matchLabels: { [NETWORK_LABEL]: net } },
      policyTypes: ['Ingress', 'Egress'],
      ingress: [{ from: [peers()] }],
      egress: [{ to: [peers()] }],
    },
  };
}

export interface K8sTrialNetworksOptions {
  /** kubectl in the sandbox's namespace, and its PodNames (K8sSandbox's). */
  ctx: K8sContext;
  /** Where the isolation probe's pods run: the sandbox's own placement. */
  placement: PodPlacement;
  /** The image table the probe's node22 image comes from. */
  images: ImageTableT;
  /** Age past which sweepStale removes a grader pod or policy (default STALE_AFTER_MS). */
  staleAfterMs?: number;
  /** The clock (default Date.now). */
  now?: () => number;
  /** Each reach's budget in the isolation probe (default ISOLATION_PROBE_MS). */
  probeMs?: number;
  /** How long a refusal is kept before the probe runs again (default ISOLATION_RECHECK_MS). */
  recheckMs?: number;
  /** Where the probe's inside pod must not get to (default ISOLATION_WORLD). */
  world?: { host: string; port: number };
}

/** The k8s driver's TrialNetworks (the header's). */
export class K8sTrialNetworks implements TrialNetworks {
  readonly #opts: K8sTrialNetworksOptions;
  readonly #isolation: EngineIsolation;

  constructor(opts: K8sTrialNetworksOptions) {
    this.#opts = opts;
    this.#isolation = new EngineIsolation({ probe: () => this.#probe(), recheckMs: opts.recheckMs, now: opts.now });
  }

  get #ctx(): K8sContext {
    return this.#opts.ctx;
  }

  async create(trial: string, opts: { owner: string | null }): Promise<string> {
    const policy = trialPolicy(trial, { namespace: this.#ctx.namespace, owner: opts.owner });
    const name = policy.metadata.name;
    const r = await kubectl(this.#ctx, KUBECTL_CREATE, { input: JSON.stringify(policy) });
    if (failed(r)) {
      const hint = r.error === undefined && EXISTS_RE.test(r.stderr) ? NETWORK_EXISTS_HINT : '';
      throw new SandboxError(`kubectl could not create network policy ${name}: ${why(r)}${hint}`);
    }
    this.#ctx.names.forget(name);
    if (opts.owner !== null) this.#ctx.names.setOwner(name, opts.owner);
    return name;
  }

  /** Every pod still on the trial's network first (the harness kills its own: this is the backstop), then its policy; either gone already is fine. */
  async remove(trial: string): Promise<void> {
    const name = trialNetworkName(trial);
    const net = labelValue(trial, 'trial');
    const pods = await kubectl(this.#ctx, ['delete', 'pods', '-l', `${NETWORK_LABEL}=${net}`, ...KUBECTL_DELETE_FLAGS]);
    const policy = await kubectl(this.#ctx, ['delete', `networkpolicy/${name}`, '--ignore-not-found']);
    this.#ctx.names.forget(name);
    const problems = [...(failed(pods) ? [`its pods: ${why(pods)}`] : []), ...(failed(policy) ? [`its policy: ${why(policy)}`] : [])];
    if (problems.length > 0) throw new SandboxError(`kubectl could not remove network ${name} (${problems.join('; ')})`);
  }

  /**
   * Every pod and policy labelled makefun.trial=<ownerLabel(owner)> (an exact match, the label every object of
   * the owner's was made with; what is no trial owner is a SandboxError), listed, deleted, and listed again:
   * REAP_ROUNDS deletes in all while any is left (one made meanwhile). A pod already being deleted is not left: the
   * graceful delete (KUBECTL_DELETE_FLAGS) keeps it listed, with its deletionTimestamp (REAP_LIST_JSONPATH), until the
   * kubelet has ended it. Never throws for what it could not list or delete: the result says.
   */
  async reap(owner: string): Promise<ReapResult> {
    const selector = `${OWNER_LABEL}=${ownerLabel(owner)}`;
    const res: ReapResult = { owner, containers: [], networks: [], errors: [] };
    for (let round = 0; ; round++) {
      const ls = await kubectl(this.#ctx, ['get', 'pods,networkpolicies', '-l', selector, '-o', REAP_LIST_JSONPATH]);
      if (failed(ls)) {
        res.errors.push(`kubectl get pods,networkpolicies -l ${selector}: ${why(ls)}`);
        return res;
      }
      const left = notBeingDeleted(ls.stdout);
      if (left.length === 0) return res;
      if (round === REAP_ROUNDS) {
        res.errors.push(`${left.join(' ')} still there (after ${REAP_ROUNDS} tries)`);
        return res;
      }
      const del = await kubectl(this.#ctx, ['delete', 'pods,networkpolicies', '-l', selector, ...KUBECTL_DELETE_FLAGS, '-o', 'name']);
      record(res, lines(del.stdout));
      if (failed(del)) res.errors.push(`kubectl delete pods,networkpolicies -l ${selector}: ${why(del)}`);
    }
  }

  /** The namespace's egress policy is there and is the grader's; the worker never makes it (its Role may not). */
  async ensureEgress(): Promise<void> {
    await ensureEgressPolicy(this.#ctx);
  }

  /**
   * Every grader pod (makefun-sbx-*) and grader policy (a trial's, or a forwarder's makefun-sbx-*-llm) older
   * than staleAfterMs: what a crashed grader left. Never throws for one it could not remove.
   */
  async sweepStale(): Promise<SweepResult> {
    const res: SweepResult = { containers: [], networks: [], errors: [] };
    const cutoff = (this.#opts.now ?? Date.now)() - (this.#opts.staleAfterMs ?? STALE_AFTER_MS);
    const ls = await kubectl(this.#ctx, ['get', 'pods,networkpolicies', '-l', CONTAINER_LABEL, '-o', 'json']);
    if (failed(ls)) {
      res.errors.push(`kubectl get pods,networkpolicies -l ${CONTAINER_LABEL}: ${why(ls)}`);
      return res;
    }
    const items = listed(ls.stdout);
    if (items === null) {
      res.errors.push(`kubectl get pods,networkpolicies printed no list: ${JSON.stringify(ls.stdout.slice(0, 200))}`);
      return res;
    }
    const stale: string[] = [];
    for (const item of items) {
      const name = item?.metadata?.name;
      const ref = item?.kind === 'Pod' ? 'pod' : item?.kind === 'NetworkPolicy' ? 'networkpolicy' : null;
      if (ref === null || typeof name !== 'string') continue;
      if (!name.startsWith(POD_PREFIX) && !(ref === 'networkpolicy' && name.startsWith(TRIAL_NETWORK_PREFIX))) continue;
      // Already being deleted (a graceful delete, KUBECTL_DELETE_FLAGS): going, never deleted again.
      if (beingDeleted(item)) continue;
      const created = parseDockerTime(item.metadata?.creationTimestamp);
      if (created === null) res.errors.push(`${ref}/${name}: no creation time`);
      else if (created < cutoff) stale.push(`${ref}/${name}`);
    }
    if (stale.length === 0) return res;
    const del = await kubectl(this.#ctx, ['delete', ...stale, ...KUBECTL_DELETE_FLAGS, '-o', 'name']);
    record(res, lines(del.stdout));
    if (failed(del)) res.errors.push(`kubectl delete ${stale.join(' ')}: ${why(del)}`);
    return res;
  }

  isolation(): Promise<IsolationVerdict> {
    return this.#isolation.verdict();
  }

  #probe(): Promise<DriverVerdict> {
    const { image, digest } = imageFor('node22', this.#opts.images);
    return probeK8sIsolation({
      ctx: this.#ctx,
      placement: this.#opts.placement,
      image,
      digest,
      probeMs: this.#opts.probeMs ?? ISOLATION_PROBE_MS,
      world: this.#opts.world ?? ISOLATION_WORLD,
    });
  }
}

/** The namespace's egress policy, checked (ensureEgress); a SandboxError naming the bootstrap when it is missing or not the grader's. */
export async function ensureEgressPolicy(ctx: K8sContext): Promise<void> {
  const r = await kubectl(ctx, ['get', `networkpolicy/${EGRESS_POLICY}`, '-o', 'json']);
  if (failed(r)) {
    if (r.error === undefined && NOT_FOUND_RE.test(r.stderr)) {
      throw new SandboxError(`network policy ${EGRESS_POLICY} is missing from namespace ${ctx.namespace}, so no forwarder or gateway can reach out: run \`makefun-k8s.sh bootstrap\` (deploy/k8s/base/networkpolicies.yaml)`);
    }
    throw new SandboxError(`kubectl could not read network policy ${EGRESS_POLICY}: ${why(r)}`);
  }
  type Policy = { spec?: { podSelector?: { matchLabels?: Record<string, unknown> }; policyTypes?: unknown } };
  let policy: Policy | null = null;
  try {
    policy = JSON.parse(r.stdout) as Policy | null;
  } catch {
    policy = null;
  }
  const [key, value] = EGRESS_LABEL.split('=') as [string, string];
  const types = policy?.spec?.policyTypes;
  if (policy?.spec?.podSelector?.matchLabels?.[key] !== value || !Array.isArray(types) || !types.includes('Egress')) {
    throw new SandboxError(
      `network policy ${EGRESS_POLICY} exists but is not the grader's egress policy (podSelector ${JSON.stringify(policy?.spec?.podSelector ?? null)}, policyTypes ${JSON.stringify(types ?? null)}): run \`makefun-k8s.sh bootstrap\` (deploy/k8s/base/networkpolicies.yaml)`,
    );
  }
}

export interface K8sIsolationOptions {
  ctx: K8sContext;
  placement: PodPlacement;
  /** The probe's node22 image and its digest. */
  image: string;
  digest: string;
  /** Each reach's budget. */
  probeMs: number;
  /** Where the inside pod must not get to. */
  world: { host: string; port: number };
}

/** The probe's roles, each one pod (the header's). */
type ProbeRole = 'listener' | 'sibling' | 'inside' | 'peer';

/** Where one of the probe's pods ran, once Ready: its address and its node. */
interface Placed {
  ip: string;
  node: string;
}

/**
 * The cluster's verdict on keeping trials apart (the header's roles); a SandboxError when it could not find out, a
 * pair that did not connect among those. Removes what it made, whatever happens.
 */
export async function probeK8sIsolation(o: K8sIsolationOptions): Promise<DriverVerdict> {
  const ctx = o.ctx;
  const engine = await clusterEngine(ctx, o.placement.runtimeClass);
  await ensureEgressPolicy(ctx);
  const trial = `isolation-${randomBytes(4).toString('hex')}`;
  const pods: Record<ProbeRole, string> = { listener: podName('isolation'), sibling: podName('isolation'), inside: podName('isolation'), peer: podName('isolation') };
  const sleep = ['sleep', 'infinity'];
  const listen = ['node', '-e', ISOLATION_LISTENER_SCRIPT, String(ISOLATION_LISTENER_S)];
  const spec = (name: string, trialOf: string | null, egress: boolean, command: readonly string[], apart = false) =>
    isolationPodSpec({ ...o.placement, name, image: o.image, digest: o.digest, trial: trialOf, egress, command, ...(apart ? { apart } : {}) });
  const objects = [
    trialPolicy(trial, { namespace: ctx.namespace, owner: null }),
    spec(pods.listener, null, true, listen),
    spec(pods.sibling, null, true, sleep),
    spec(pods.inside, trial, false, sleep, true),
    spec(pods.peer, trial, false, listen, true),
  ];
  const roles = Object.entries(pods) as Array<[ProbeRole, string]>;
  const refs = [...roles.map(([, pod]) => `pod/${pod}`), `networkpolicy/${trialNetworkName(trial)}`];
  try {
    const made = await kubectl(ctx, KUBECTL_CREATE, { input: JSON.stringify({ apiVersion: 'v1', kind: 'List', items: objects }) });
    if (failed(made)) throw new SandboxError(`kubectl could not create the isolation probe's pods: ${why(made)}`);
    // When the driver saw each pod Ready: the pair's first connect is timed from the later of its two.
    const readyAt = new Map<string, number>();
    const ready = await Promise.all(
      roles.map(([, pod]) =>
        awaitPod(ctx, pod, 'Ready', ctx.readyTimeoutMs).then((w) => {
          readyAt.set(pod, Date.now());
          return w;
        }),
      ),
    );
    ready.forEach((w, i) => {
      if (!w.ok) throw new SandboxError(`the isolation probe's ${roles[i]![0]} pod ${roles[i]![1]} never became ready: ${w.why}`);
    });
    const placed = Object.fromEntries(await Promise.all(roles.map(async ([role, pod]) => [role, await placedOf(ctx, role, pod)] as const))) as Record<ProbeRole, Placed>;
    const ran = `the probe's pods ran on: ${roles.map(([role]) => `${role} ${placed[role].node}`).join(', ')}`;
    const ip = placed.listener.ip;
    const at = `${ip}:${SERVICE_PORT}`;
    const reach = (pod: string, host: string, port: number, what: string) => reachIn(ctx, pod, host, port, o.probeMs, what);
    const fix = 'enforce NetworkPolicies on the cluster (k3s: its embedded network policy controller, never --disable-network-policy; or a CNI that enforces them) and apply deploy/k8s/base/networkpolicies.yaml (makefun-k8s.sh bootstrap)';

    // The allowed pair first: until it has connected, no blocked reach below says anything about a policy.
    const { inside: from, peer: to } = placed;
    const across = from.node !== to.node;
    const pairAt = `${to.ip}:${SERVICE_PORT}`;
    const pairReadyAt = Math.max(readyAt.get(pods.inside)!, readyAt.get(pods.peer)!);
    const dialAt = Date.now();
    const pair = await dialIn(ctx, pods.inside, to.ip, SERVICE_PORT, o.probeMs);
    if (!pair.reached) {
      const own = await reach(pods.peer, to.ip, SERVICE_PORT, 'peer control');
      if (!own.reached) throw new SandboxError(`the isolation probe's peer did not answer at its own address ${pairAt} (${own.how}): its allowed pair proves nothing (${ran})`);
      const between = across ? `between nodes ${from.node} and ${to.node}` : `between pods on node ${from.node}`;
      throw new SandboxError(
        `the isolation probe's allowed pair did not connect: its inside pod on node ${from.node} did not reach its peer on node ${to.node} (${pairAt}), both on the probe trial's network, within ${o.probeMs} ms (${pair.how}, ${pair.attempts} attempts), though the peer answers at its own address, so routing ${between} failed and no blocked reach would prove a policy held: fix pod-to-pod routing ${between} (the CNI) (${ran})`,
      );
    }
    const afterReadyMs = Math.max(0, dialAt - pairReadyAt) + pair.ms;

    const control = await reach(pods.listener, ip, SERVICE_PORT, 'control');
    if (!control.reached) throw new SandboxError(`the isolation probe's listener did not answer at its own address ${at} (${control.how}): the probe proves nothing`);
    const sibling = await reach(pods.sibling, ip, SERVICE_PORT, 'sibling');
    if (sibling.reached) {
      return {
        enforced: false,
        driver: 'k8s',
        engine,
        fault: 'policy_not_enforced',
        reason: `a pod under ${EGRESS_POLICY} reached another (${at}), so concurrent trials' forwarders and gateways reach one another: the namespace's NetworkPolicies are not enforced (${ran})`,
        fix,
      };
    }
    const again = await reach(pods.listener, ip, SERVICE_PORT, 'control');
    if (!again.reached) throw new SandboxError(`the isolation probe's listener stopped answering at ${at} (${again.how}): the sibling's result proves nothing`);
    const inside = await reach(pods.inside, ip, SERVICE_PORT, 'inside');
    const world = inside.reached ? null : await reach(pods.inside, o.world.host, o.world.port, 'inside');
    if (inside.reached || world?.reached === true) {
      const where = inside.reached ? `an egress pod (${at})` : `${o.world.host}:${o.world.port}`;
      return {
        enforced: false,
        driver: 'k8s',
        engine,
        fault: 'trial_pod_escapes',
        reason: `a pod on a trial's network (NetworkPolicy ${trialNetworkName(trial)}) reached ${where} past it, so a trial's entry is not kept to its trial (${ran})`,
        fix,
      };
    }
    const where = across ? `across nodes, ${from.node} to ${to.node}` : `on one node, ${from.node}`;
    // A pair that shared a node (its spread a preference: the other may have no room) proves no routing between nodes,
    // and the verdict stands on the reaches alone, saying so.
    const shared = across ? '' : `; the allowed pair shared node ${from.node}: routing between nodes not proven by this probe`;
    return {
      enforced: true,
      driver: 'k8s',
      engine,
      detail: `a pod on a trial's network reached another on it (${pairAt}, ${where}: its first connect at most ${afterReadyMs} ms after both were Ready, the dial's own ${pair.ms} ms in ${pair.attempts} attempts); an egress pod did not reach another (${at}: ${sibling.how}); a pod on a trial's network reached neither it (${inside.how}) nor ${o.world.host}:${o.world.port} (${world!.how})${shared}; ${ran}`,
    };
  } finally {
    await deleteObjects(ctx, refs);
  }
}

/** One reach of the probe, by exec in `pod` (ISOLATION_REACH_SCRIPT): what it found, or a SandboxError when it did not run. */
async function reachIn(ctx: K8sContext, pod: string, host: string, port: number, ms: number, what: string): Promise<Reach> {
  const r = await kubectl(ctx, ['exec', pod, '-c', CONTAINER, '--', 'node', '-e', ISOLATION_REACH_SCRIPT, host, String(port), String(ms)]);
  if (failed(r)) throw new SandboxError(`the isolation probe's ${what} did not run: ${why(r)}`);
  return readReach(r.stdout, what);
}

/** The allowed pair's dial, by exec in `pod` (ISOLATION_PAIR_SCRIPT): what it found, or a SandboxError when it did not run. */
async function dialIn(ctx: K8sContext, pod: string, host: string, port: number, ms: number): Promise<PairDial> {
  const r = await kubectl(ctx, ['exec', pod, '-c', CONTAINER, '--', 'node', '-e', ISOLATION_PAIR_SCRIPT, host, String(port), String(ms)]);
  if (failed(r)) throw new SandboxError(`the isolation probe's allowed pair did not run: ${why(r)}`);
  return readPairDial(r.stdout);
}

/** The pair's dial line (its stdout's last): SandboxError when it printed anything else. */
export function readPairDial(stdout: string): PairDial {
  let doc: Partial<PairDial> | null = null;
  try {
    doc = JSON.parse(lines(stdout).at(-1) ?? '') as Partial<PairDial> | null;
  } catch {
    doc = null;
  }
  const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (doc === null || typeof doc !== 'object' || typeof doc.reached !== 'boolean' || typeof doc.how !== 'string' || !count(doc.ms) || !count(doc.attempts)) {
    throw new SandboxError(`the isolation probe's allowed pair printed ${JSON.stringify(stdout.slice(0, 200))}, not what it found`);
  }
  return { reached: doc.reached, how: doc.how, ms: doc.ms, attempts: doc.attempts };
}

/** A probe pod's address and node, once Ready. */
async function placedOf(ctx: K8sContext, role: ProbeRole, pod: string): Promise<Placed> {
  const read = await readPod(ctx, pod);
  const ip = 'pod' in read ? read.pod.status?.podIP : undefined;
  const node = 'pod' in read ? read.pod.spec?.nodeName : undefined;
  const said = 'pod' in read ? 'none in its status' : 'gone' in read ? read.gone : read.error;
  if (typeof ip !== 'string' || ip === '') throw new SandboxError(`the isolation probe's ${role} pod ${pod} is ready without an IP (${said})`);
  if (typeof node !== 'string' || node === '') throw new SandboxError(`the isolation probe's ${role} pod ${pod} is ready without a node (${'pod' in read ? 'none in its spec' : said})`);
  return { ip, node };
}

/** What the verdict calls the cluster: its server version and the pods' RuntimeClass. */
async function clusterEngine(ctx: K8sContext, runtimeClass: string | null): Promise<string> {
  const r = await kubectl(ctx, ['version', '-o', 'json']);
  let version: unknown;
  try {
    version = (JSON.parse(r.stdout) as { serverVersion?: { gitVersion?: unknown } }).serverVersion?.gitVersion;
  } catch {
    version = undefined;
  }
  if (failed(r) || typeof version !== 'string') throw new SandboxError(`kubectl version gave no server version: ${failed(r) ? why(r) : JSON.stringify(r.stdout.slice(0, 200))}`);
  return `${version}, RuntimeClass ${runtimeClass ?? 'none'}`;
}

/** Each `kind/name` kubectl printed into the result: pods as containers, policies as networks. */
function record(res: { containers: string[]; networks: string[] }, refs: readonly string[]): void {
  for (const ref of refs) {
    const slash = ref.indexOf('/');
    const [kind, name] = [ref.slice(0, slash), ref.slice(slash + 1)];
    if (slash < 0 || name === '') continue;
    if (kind === 'pod' && !res.containers.includes(name)) res.containers.push(name);
    else if (kind === POLICY_RESOURCE && !res.networks.includes(name)) res.networks.push(name);
  }
}

/** The part of a listed pod or policy (`kubectl get pods,networkpolicies -o json`'s items) reap and sweepStale read. */
type ListedItem = { kind?: unknown; metadata?: { name?: unknown; creationTimestamp?: unknown; deletionTimestamp?: unknown } };

/** `kubectl get … -o json`'s items; null when it printed no list. */
function listed(stdout: string): ListedItem[] | null {
  let items: unknown;
  try {
    items = (JSON.parse(stdout) as { items?: unknown }).items;
  } catch {
    items = undefined;
  }
  return Array.isArray(items) ? (items as ListedItem[]) : null;
}

/**
 * Of reap's list (REAP_LIST_JSONPATH's lines, `<kind>/<name>[ <deletionTimestamp>]`), each pod or policy not being
 * deleted, named as `kubectl -o name` prints it (`pod/<name>`, `networkpolicy.networking.k8s.io/<name>`).
 */
function notBeingDeleted(stdout: string): string[] {
  const left: string[] = [];
  for (const line of lines(stdout)) {
    const [ref = '', deleting = ''] = line.split(/\s+/, 2);
    const slash = ref.indexOf('/');
    const [kind, name] = [ref.slice(0, slash), ref.slice(slash + 1)];
    if (slash < 0 || name === '' || deleting !== '') continue;
    left.push(kind === 'Pod' ? `pod/${name}` : kind === 'NetworkPolicy' ? `${POLICY_RESOURCE}/${name}` : ref);
  }
  return left;
}

function failed(r: KubectlResult): boolean {
  return r.code !== 0 || r.error !== undefined;
}

function lines(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}
