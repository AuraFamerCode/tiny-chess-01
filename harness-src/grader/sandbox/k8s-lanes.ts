// The lanes pod: one gVisor sandbox pod a grader makes for itself, holding a `pod` trial's key-holding programs (an
// agent trial's two forwarders, a scrape heat's recording gateway) and the door as children of ONE root program the
// grader reaches by ONE `kubectl exec -i` stream (server/sandbox-host/lanes.ts; the grader's client is
// server/sandbox-host/services.ts). This file is the pod and nothing else: its spec (lanesPodSpec) and its driver
// (lanesPodOf, K8sLanesPod), over what grader/sandbox/k8s.ts exports, which it does not edit; its size is its caller's
// (server/pipeline/index.ts lanesPodSizeOf, deploy/k8s/base/grader.yaml's arithmetic, from the floors named here). What weakens against `split`, plainly: a grader's lanes share one gVisor sandbox where today each
// forwarder is a sandbox of its own; uids stand between them, not a sandbox. A replay lane shares the pod's egress,
// where a replay forwarder's pod has none today.
//
// The pod (lanesPodSpec) is podObject's shape (k8s.ts) but where a sandbox that lives as long as its grader and holds
// many lanes needs otherwise, each difference for a reason:
//
//   name makefun-sbx-lanes-<8 hex> (podName('lanes'): the admission policy's prefix, and `<pod>-llm` its policy name)
//   labels makefun.io/role=sandbox (makefun-sandbox-deny selects it), makefun.io/sandbox=lanes, makefun.egress=1 (a
//     live forwarder's reach: the egress policy's public internet and cluster DNS, an entrant's own provider key being
//     dialled there) and makefun.pod=<name> (its own `-llm` policy selects it by it; one pod a grader mints one
//     Cilium identity a grader, not one a trial). NOT makefun.grader=1: sweepStale and `makefun-k8s.sh reap` take
//     whatever carries it past six hours (STALE_AFTER_MS), and a grader's lanes pod lives as long as the grader (the
//     race pod's precedent, k8s.ts's header)
//   the creator annotation (CREATOR_ANNOTATION), so K8sSandbox.reapOrphans takes it, with its `-llm` policy, once its
//     grader is no running pod; ownerReferences naming the creator's pod and uid, blockOwnerDeletion false (ownedByPod,
//     as an env Secret is owned by its pod), so the garbage collector deletes it once the grader pod's object is gone:
//     after the whole drain (probe L8: it stays through its owner's grace and is gone 16 ms after the object), and at
//     once on a force delete
//   NO activeDeadlineSeconds: podObject's six hours would end a grader's every lane at once, mid-drain or not; the
//     owner reference, the reap and close() bound its life instead
//   runtimeClassName required (the pod is a gVisor sandbox or nothing: under runc its root and DAC_OVERRIDE would be
//     the node's), NO nodeSelector: the data claim's own node affinity alone places it, on the one node that holds the
//     claim, where its grader runs (s18 on dsh-makefun). The sandbox's nodeSelector (MAKEFUN_K8S_NODE_SELECTOR,
//     makefun.io/gvisor=true) names the gVisor pool, whose nodes hold no claim: a lanes pod carrying it stays Pending
//     (2026-11-14: every `pod` trial of free-model-aggregator-01 held `harness_fault`, the scheduler saying `1 node(s)
//     didn't match Pod's node affinity/selector, 3 node(s) didn't match PersistentVolume's node affinity`). It is the
//     one sandbox pod that does not take the sandbox's placement. serviceAccountName with automountServiceAccountToken
//     false, enableServiceLinks false, restartPolicy Never, terminationGracePeriodSeconds 0, as podObject
//   dnsPolicy ClusterFirst with ndots 0: an egress pod's (a forwarder's) resolver
//   runAsUser/Group 0, runAsNonRoot false, seccomp RuntimeDefault; one container `main`: the pinned node22 image by
//     digest, imagePullPolicy Never; command LANES_INIT_COMMAND, a perl loop that reaps every second, where podObject's
//     is `sleep infinity`: an orphan a lane leaves is reparented to pid 1, and `sleep infinity` reaps nothing (probe
//     a2's zombie; L8z: the reaper leaves none). The root program is exec'd into the pod once it is Ready, never its
//     command (k8s.ts's header: the default-deny race before Ready)
//   env SANDBOX_ENV alone: no key and no spec env sits in the pod; what a lane needs reaches it over the stream
//   allowPrivilegeEscalation false, readOnlyRootFilesystem, capabilities drop ALL and add LANES_CAPS: SETUID and
//     SETGID for the drop to each lane's own uid (probe L1), KILL to end a lane's processes, DAC_OVERRIDE to copy a
//     lane's config in and its record out across uids (L3); all four admitted by the cluster kit's admission policy
//     and by Pod Security baseline, none a launcher's pod lacks but DAC_OVERRIDE, which the meter's has
//   requests and limits as its caller gives them (required, requests never past limits: the pipeline's lanesPodSizeOf),
//     read each time a pod is made when the caller gives a function: a raise in the grader's trial width widens the
//     next pod (the one a moved gateway or a loss replaces), while a pod already made keeps the size it was made with
//   mounts: the lanes directory (`<work root>/lanes/<grader pod>`, a subPath of the data claim) at its own absolute
//     path, read-write, so a path means the same in the grader and in the pod; `/tmp` an emptyDir of medium Memory,
//     LANES_TMP_SIZE (charged to the pod's memory, L5: lanes do not work there); `/work` an emptyDir on disk, where
//     each lane's private directory lives (L5: not charged as the pod's memory). No /bot, no house, no /dev/shm mount
//
// The driver (lanesPodOf → K8sLanesPod). A pod is, for each open():
//
//   (the node22 preflight, K8sSandbox.preflight: once per process)
//   kubectl -n <ns> get pod/<creator> -o jsonpath={.metadata.uid}         the owner's uid
//   kubectl -n <ns> get pods -l makefun.io/sandbox=lanes -o json          this creator's lanes pods left by an earlier
//   kubectl -n <ns> delete pod/<p> networkpolicy/<p>-llm ...              run of the same pod (a container restart
//                                                                         keeps the pod's name; reapOrphans cannot
//                                                                         see it), deleted first
//   kubectl -n <ns> create -f - -o CREATED_JSONPATH                       the pod (a List of one)
//   kubectl -n <ns> create -f -                                           with an LLM gateway, its <pod>-llm policy
//                                                                         (gatewayPolicy for the addresses resolved
//                                                                         now), owned by the pod
//   kubectl -n <ns> wait --for=condition=Ready pod/<pod>                  awaitPod, within the ready budget
//   kubectl -n <ns> get pod/<pod> -o json                                 its IP
//   kubectl -n <ns> exec <pod> -c main -- <POLICY_WAIT_ARGV.node22>       with an LLM gateway, the policy wait (below):
//     <POLICY_WAIT_MS> <address> <port> ...                               then open() resolves { address }
//   kubectl -n <ns> exec -i <pod> -c main -- <argv>                       exec(): ONE stream for the pod's life
//   kubectl -n <ns> delete pod/<pod> [networkpolicy/<pod>-llm] ...        close(), once
//
// One stream a pod (probe L7): execs into one gVisor pod are served one at a time, and a burst whose clients died left
// the pod refusing execs for about 7 minutes. So exec() runs once a pod, nothing here execs into it to poll or probe
// on a hot path (what the program must say it says on the stream), and a second exec() is refused. When the stream
// ends the driver never opens another into the same pod: its client (services.ts) ends every hosted process as a
// driver failure, says so in one `[grader] ALERT:` line, and close()s the pod; the next open() makes a fresh one under
// a new name. The one other exec is the policy wait, ONE a pod at its creation, run to its end before open() resolves
// (so before the stream or any lane exists), never repeated for the pod's life.
//
// The policy wait. A lanes pod's `-llm` policy is owned by the pod, so it is made AFTER the pod, where a forwarder's
// comes first; until the CNI enforces it the pod's dial to the gateway is refused, and a lane's first upstream call
// would meet that. So with an LLM gateway, once the pod is Ready, the pod dials each address its policy names on the
// gateway's port from inside (POLICY_WAIT_ARGV in node22, the pod's runtime, within POLICY_WAIT_MS: an entry pod's
// policy wait, k8s.ts), measured, never assumed from Ready. All taking a connection is the pass; none within the
// wait, or a wait that did not run, is the driver's failure: what was made is deleted and open() throws a
// SandboxError, no stream opened and no lane started. With no gateway there is no wait and no exec.
//
// What ends a lanes pod no delete reached. The shared delete's warning (deleteObjects) names activeDeadlineSeconds,
// which a lanes pod has not; the driver's deletes say instead what ends it (LANES_LEFT_BEHIND).
//
// One driver a process. open() deletes every lanes pod this creator's annotation names, so two drivers of one creator
// would delete each other's: a second driver's open() is refused while another of the same namespace and creator
// holds a pod (LANES_HELD).
//
// The gateway's address. A forwarder pod's `-llm` policy is made from the gateway host resolved at its trial, so a
// moved gateway is picked up by the next trial. A lanes pod lives as long as its grader, so gatewayMoved() (called at
// each lane start) resolves a configured host that is a name again and compares it with the addresses the pod's policy
// was made with: on a change it says so in ONE `[grader] ALERT:` line and answers true from then on, and the client
// replaces the pod once it holds no lane, new lanes waiting for the new pod; nothing here deletes or re-makes a policy
// under live lanes. A literal address is never resolved, and nothing of this runs for it.

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { posix } from 'node:path';
import { imageFor, imageRef, type ImageTableT } from '../images.ts';
import {
  awaitPod,
  CONTAINER,
  CREATED_JSONPATH,
  createdUid,
  CREATOR_ANNOTATION,
  deleteObjects,
  gatewayPolicy,
  GATEWAY_POLICY_SUFFIX,
  kubectl,
  KUBECTL_TIMEOUT_MS,
  kubectlExec,
  kubectlStream,
  NO_ROOM_RE,
  NodeRoomError,
  ownedByPod,
  POD_LABEL,
  POD_PREFIX,
  PodNames,
  podName,
  POLICY_WAIT_ARGV,
  POLICY_WAIT_MS,
  READY_TIMEOUT_MS,
  readPod,
  ROLE_LABEL,
  SANDBOX_KIND_LABEL,
  subPathOf,
  why,
  type K8sContext,
  type K8sObject,
  type K8sSandbox,
  type KubectlChild,
  type KubectlExec,
  type KubectlResult,
  type KubectlStream,
  type PodPlacement,
} from './k8s.ts';
import { EGRESS_LABEL } from './network.ts';
import { checkHostPath, SANDBOX_ENV, SandboxError } from './types.ts';

/** The lanes pod's kind (SANDBOX_KIND_LABEL) and its name's label: makefun-sbx-lanes-<8 hex>. */
export const LANES_KIND = 'lanes';
/**
 * The pod's own command, pid 1: perl (perl-base is in the pinned image) reaping every exited child each second, as
 * probe L8z ran it; TERM ends it. Every orphan a lane leaves is reparented to it.
 */
export const LANES_INIT_COMMAND: readonly string[] = Object.freeze([
  'perl',
  '-e',
  'use POSIX ":sys_wait_h"; $SIG{TERM} = sub { exit 0 }; while (1) { 1 while waitpid(-1, WNOHANG) > 0; sleep 1 }',
]);
/** The root program's capabilities: the drop to each lane's uid (SETUID, SETGID), ending lanes (KILL), the copy in and out across uids (DAC_OVERRIDE). */
export const LANES_CAPS: readonly string[] = Object.freeze(['SETUID', 'SETGID', 'KILL', 'DAC_OVERRIDE']);
/** The memory `/tmp`'s size: charged to the pod's memory (probe L5), so small; a lane works on `/work`. */
export const LANES_TMP_SIZE = '64Mi';
/** Where the pod's on-disk emptyDir is mounted: each lane's private directory lives under it. */
export const LANES_WORK_DIR = '/work';
/** The floor of the pod's CPU request (server/pipeline/index.ts lanesPodSizeOf), the most podObject ever requests. */
export const LANES_CPU_REQUEST_MIN_MILLI = 250;
/** The floor of the pod's CPU limit, in millicores: two whole cores. */
export const LANES_CPU_LIMIT_MIN_MILLI = 2000;
/** The step a memory limit is rounded up to. */
export const LANES_MEMORY_STEP_MI = 64;
/** A lane's CPU headroom in the limit over its measured cost. */
export const LANES_CPU_HEADROOM = 2;
/**
 * What a lanes pod's delete that never succeeded says ends the pod, in place of the shared warning's
 * activeDeadlineSeconds, which a lanes pod has not (lanesPodSpec).
 */
export const LANES_LEFT_BEHIND =
  "a lanes pod has no activeDeadlineSeconds: its owner reference ends it once its grader's pod is gone, K8sSandbox.reapOrphans takes it once its creator is no running pod, and its creator's next open() sweeps it";

const [EGRESS_KEY, EGRESS_VALUE] = EGRESS_LABEL.split('=') as [string, string];
const DATA_VOLUME = 'data';
const TMP_VOLUME = 'tmp';
const WORK_VOLUME = 'work';
const LANES_NAME_RE = new RegExp(`^${POD_PREFIX}${LANES_KIND}-[a-z0-9]([-a-z0-9]{0,42}[a-z0-9])?$`);
const DNS_SUBDOMAIN_RE = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
/** Where deleteObjects' warning names activeDeadlineSeconds: the driver's deletes say LANES_LEFT_BEHIND from here on. */
const SHARED_DEADLINE = '; its activeDeadlineSeconds';
const LIVE_PODS = ['get', 'pods', '--field-selector', 'status.phase!=Succeeded,status.phase!=Failed', '-o', 'name'];

/** A lanes pod's CPU and memory, requests and limits: its caller's (server/pipeline/index.ts lanesPodSizeOf). */
export interface LanesPodResources {
  requests: { cpuMilli: number; memoryMi: number };
  limits: { cpuMilli: number; memoryMi: number };
}

/** A lanes pod's size as its caller gave it, checked: whole positive millicores and Mi, requests never past limits. */
function checkResources(r: LanesPodResources): LanesPodResources {
  const n = (v: number, what: string): number => {
    if (!Number.isInteger(v) || v < 1) throw new SandboxError(`lanes pod ${what} ${v} is not a positive integer`);
    return v;
  };
  const out = {
    requests: { cpuMilli: n(r?.requests?.cpuMilli, 'CPU request'), memoryMi: n(r?.requests?.memoryMi, 'memory request') },
    limits: { cpuMilli: n(r?.limits?.cpuMilli, 'CPU limit'), memoryMi: n(r?.limits?.memoryMi, 'memory limit') },
  };
  if (out.requests.cpuMilli > out.limits.cpuMilli || out.requests.memoryMi > out.limits.memoryMi) {
    throw new SandboxError(`lanes pod requests (${out.requests.cpuMilli}m, ${out.requests.memoryMi}Mi) exceed its limits (${out.limits.cpuMilli}m, ${out.limits.memoryMi}Mi)`);
  }
  return out;
}

/**
 * The lanes directory, checked: an absolute normalized host path under the data root (subPathOf), never at or under
 * the pod's own `/tmp` or `/work`, which would shadow it or be shadowed. Its subPath of the claim.
 */
function lanesSubPath(dataRoot: string, dir: string): string {
  checkHostPath(dir);
  if (posix.normalize(dir) !== dir || dir.endsWith('/')) throw new SandboxError(`lanes directory ${JSON.stringify(dir)} is not a normalized path`);
  for (const own of ['/tmp', LANES_WORK_DIR]) {
    if (dir === own || dir.startsWith(`${own}/`)) throw new SandboxError(`lanes directory ${dir} lies in the pod's own ${own}`);
  }
  return subPathOf(dataRoot, dir);
}

/** A lanes pod's own (lanesPodSpec): its placement (a RuntimeClass and a creator required), name, image, directory, owner's uid and size. */
export interface LanesPodOptions extends PodPlacement {
  name: string;
  image: string;
  digest: string;
  /** The lanes directory on the claim, mounted read-write at its own path. */
  dir: string;
  /** The creator's pod's uid, which the pod's ownerReferences name. */
  creatorUid: string;
  resources: LanesPodResources;
}

/** The lanes pod (the header), pure: every field pinned by tests/unit/sandbox-k8s-lanes.test.ts. */
export function lanesPodSpec(opts: LanesPodOptions): K8sObject {
  if (typeof opts.name !== 'string' || !LANES_NAME_RE.test(opts.name) || opts.name.length > 62) {
    throw new SandboxError(`lanes pod name ${JSON.stringify(opts.name)} is not ${POD_PREFIX}${LANES_KIND}-<suffix> (podName('${LANES_KIND}'))`);
  }
  if (opts.runtimeClass === null || opts.runtimeClass === undefined) throw new SandboxError('a lanes pod runs under a gVisor RuntimeClass or not at all: the sandbox has none');
  const creator = opts.creator;
  if (typeof creator !== 'string' || !DNS_SUBDOMAIN_RE.test(creator)) throw new SandboxError(`a lanes pod is owned by its creator's pod: creator ${JSON.stringify(creator ?? null)} is no pod name`);
  const subPath = lanesSubPath(opts.dataRoot, opts.dir);
  const r = checkResources(opts.resources);
  const spec: Record<string, unknown> = { runtimeClassName: opts.runtimeClass };
  if (opts.nodeSelector !== null && Object.keys(opts.nodeSelector).length > 0) spec.nodeSelector = { ...opts.nodeSelector };
  spec.serviceAccountName = opts.serviceAccount;
  spec.automountServiceAccountToken = false;
  spec.enableServiceLinks = false;
  spec.restartPolicy = 'Never';
  spec.terminationGracePeriodSeconds = 0;
  spec.dnsPolicy = 'ClusterFirst';
  spec.dnsConfig = { options: [{ name: 'ndots', value: '0' }] };
  spec.securityContext = { runAsUser: 0, runAsGroup: 0, runAsNonRoot: false, seccompProfile: { type: 'RuntimeDefault' } };
  spec.containers = [
    {
      name: CONTAINER,
      image: imageRef({ image: opts.image }, opts.digest),
      imagePullPolicy: 'Never',
      command: [...LANES_INIT_COMMAND],
      env: Object.entries(SANDBOX_ENV).map(([name, value]) => ({ name, value })),
      resources: {
        limits: { cpu: `${r.limits.cpuMilli}m`, memory: `${r.limits.memoryMi}Mi` },
        requests: { cpu: `${r.requests.cpuMilli}m`, memory: `${r.requests.memoryMi}Mi` },
      },
      securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'], add: [...LANES_CAPS] } },
      volumeMounts: [
        { name: DATA_VOLUME, mountPath: opts.dir, subPath, readOnly: false },
        { name: TMP_VOLUME, mountPath: '/tmp' },
        { name: WORK_VOLUME, mountPath: LANES_WORK_DIR },
      ],
    },
  ];
  spec.volumes = [
    { name: DATA_VOLUME, persistentVolumeClaim: { claimName: opts.dataPvc } },
    { name: TMP_VOLUME, emptyDir: { medium: 'Memory', sizeLimit: LANES_TMP_SIZE } },
    { name: WORK_VOLUME, emptyDir: {} },
  ];
  const pod: K8sObject = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: opts.name,
      namespace: opts.namespace,
      labels: { [ROLE_LABEL]: 'sandbox', [SANDBOX_KIND_LABEL]: LANES_KIND, [EGRESS_KEY]: EGRESS_VALUE, [POD_LABEL]: opts.name },
      annotations: { [CREATOR_ANNOTATION]: creator },
    },
    spec,
  };
  return ownedByPod(pod, { name: creator, uid: opts.creatorUid });
}

/** A lanes pod's `-llm` policy (gatewayPolicy): egress to the gateway's addresses on its port, labelled makefun.pod alone, owned by the pod. */
export function lanesGatewayPolicy(opts: { name: string; namespace: string; uid: string; addresses: readonly string[]; port: number }): K8sObject {
  const policy = gatewayPolicy({ name: opts.name, namespace: opts.namespace, labels: { [POD_LABEL]: opts.name }, addresses: opts.addresses, port: opts.port });
  return ownedByPod(policy, { name: opts.name, uid: opts.uid });
}

/** What of a K8sSandbox the driver reads: where its pods go, its images, gateway, creator, warnings and preflight. */
export type LanesSandbox = Pick<K8sSandbox, 'placement' | 'images' | 'llmGateway' | 'creator' | 'warn' | 'preflight'>;

export interface LanesPodOfOptions {
  /** The lanes directory on the claim (`<work root>/lanes/<grader pod>`). */
  dir: string;
  /**
   * The pod's requests and limits: a value fixes the size of every pod this driver makes; a function is read each
   * time one is made (server/pipeline/index.ts lanesPodSizeOf on the width in force then), so a replacement after a
   * loss or a moved gateway is sized afresh rather than at the boot figure.
   */
  resources: LanesPodResources | (() => LanesPodResources);
  /** The kubectl CLI for the defaults below (default `kubectl`). */
  kubectl?: string;
  /** How to run kubectl to its end (default kubectlExec(kubectl)); tests pass a fake. */
  exec?: KubectlExec;
  /** How to start `kubectl exec -i` (default kubectlStream(kubectl)); tests pass a fake. */
  stream?: KubectlStream;
  /** A host name's addresses (default the system resolver's). */
  lookup?: (host: string) => Promise<string[]>;
  /** How long the pod may take to be Ready (default READY_TIMEOUT_MS, the sandbox's own default). */
  readyTimeoutMs?: number;
}

/** What open() resolves: the pod's IP, the door's address. */
export interface LanesPodOpen {
  address: string;
}

/** The pods of the namespace and creators a driver holds a lanes pod for (the header's One driver a process). */
const LANES_HELD = new Map<string, K8sLanesPod>();

interface Session {
  readonly name: string;
  readonly abort: AbortController;
  opening: Promise<LanesPodOpen>;
  address: string | null;
  /** The addresses its `-llm` policy was made with (null: no gateway). */
  policy: readonly string[] | null;
  created: boolean;
  stream: KubectlChild | null;
  moved: boolean;
  resolveSaid: string | null;
  closing: Promise<void> | null;
  ended: Promise<void> | null;
}

/** The lanes pod's driver (the header): open(), one exec(), close(), creators(), gatewayMoved(). */
export class K8sLanesPod {
  readonly #sandbox: LanesSandbox;
  readonly #ctx: K8sContext;
  /** #ctx whose warn says LANES_LEFT_BEHIND in place of the shared activeDeadlineSeconds line: every deleteObjects here. */
  readonly #deleteCtx: K8sContext;
  readonly #placement: PodPlacement & { creator: string; runtimeClass: string };
  readonly #creator: string;
  readonly #key: string;
  readonly #dir: string;
  /** Its size now: a given value returned as it is, or its caller's function read afresh at each pod (LanesPodOfOptions.resources). */
  readonly #resources: () => LanesPodResources;
  readonly #image: { image: string; digest: string };
  readonly #gateway: { host: string; port: number } | null;
  readonly #lookup: (host: string) => Promise<string[]>;
  #session: Session | null = null;

  constructor(sandbox: LanesSandbox, opts: LanesPodOfOptions) {
    const placement = sandbox.placement;
    if (placement.runtimeClass === null) throw new SandboxError('a lanes pod runs under a gVisor RuntimeClass or not at all: this sandbox has none (MAKEFUN_K8S_RUNTIME_CLASS)');
    const creator = sandbox.creator;
    if (creator === null) throw new SandboxError("a lanes pod is owned by its creator's pod: a process that names no pod of its own (POD_NAME) makes none, nothing would bound its life");
    this.#sandbox = sandbox;
    this.#creator = creator;
    // The claim places this pod, never the sandbox's nodeSelector: its lanes directory is a subPath of the data claim
    // (a ReadWriteOnce local-path volume, its node affinity the one node holding it), so the only node it can run on is
    // its grader's. The sandbox's selector names the gVisor pool, whose nodes hold no claim (k8s-lanes.ts's header).
    this.#placement = { ...placement, runtimeClass: placement.runtimeClass, creator, nodeSelector: null };
    this.#key = `${placement.namespace}\n${creator}`;
    this.#dir = opts.dir;
    const given = opts.resources;
    this.#resources = typeof given === 'function' ? given : () => given;
    const entry = imageFor('node22', sandbox.images as ImageTableT);
    this.#image = { image: entry.image, digest: entry.digest };
    this.#gateway = sandbox.llmGateway;
    this.#lookup = opts.lookup ?? (async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address));
    const cli = opts.kubectl ?? 'kubectl';
    this.#ctx = {
      namespace: placement.namespace,
      exec: opts.exec ?? kubectlExec(cli),
      stream: opts.stream ?? kubectlStream(cli),
      names: new PodNames(),
      warn: sandbox.warn,
      readyTimeoutMs: opts.readyTimeoutMs ?? READY_TIMEOUT_MS,
    };
    this.#deleteCtx = {
      ...this.#ctx,
      warn: (line) => {
        const at = line.indexOf(SHARED_DEADLINE);
        sandbox.warn(at < 0 ? line : `${line.slice(0, at)}; ${LANES_LEFT_BEHIND}`);
      },
    };
    // Built now so a bad directory or size throws here, not at the first lane.
    this.#spec(podName(LANES_KIND), '00000000-0000-0000-0000-000000000000');
  }

  /** The current (or last) pod's name; null before the first open(). */
  get name(): string | null {
    return this.#session?.name ?? null;
  }

  #spec(name: string, creatorUid: string): K8sObject {
    return lanesPodSpec({ ...this.#placement, name, image: this.#image.image, digest: this.#image.digest, dir: this.#dir, creatorUid, resources: this.#resources() });
  }

  #refs(name: string): string[] {
    return [`pod/${name}`, ...(this.#gateway === null ? [] : [`networkpolicy/${name}${GATEWAY_POLICY_SUFFIX}`])];
  }

  /**
   * The pod, made and Ready and, with an LLM gateway, its policy waited for (the header's calls and The policy wait),
   * resolving its address. While a pod is opening or open, the same promise; after close() (or an open that failed,
   * whose pod is deleted) a fresh pod under a new name. A pod the node has no room for is deleted and thrown as a
   * NodeRoomError; any other failure (a policy wait no address passed included) deletes what was made and throws a
   * SandboxError.
   */
  open(): Promise<LanesPodOpen> {
    const prev = this.#session;
    if (prev !== null && prev.closing === null) return prev.opening;
    const s: Session = {
      name: podName(LANES_KIND),
      abort: new AbortController(),
      opening: Promise.resolve({ address: '' }),
      address: null,
      policy: null,
      created: false,
      stream: null,
      moved: false,
      resolveSaid: null,
      closing: null,
      ended: null,
    };
    this.#session = s;
    const before = prev?.closing ?? Promise.resolve();
    s.opening = before.then(() => this.#open(s));
    s.opening.catch(() => undefined);
    return s.opening;
  }

  async #open(s: Session): Promise<LanesPodOpen> {
    const closed = (): SandboxError => new SandboxError(`lanes pod ${s.name} was closed before it was ready`);
    try {
      if (s.abort.signal.aborted) throw closed();
      const holder = LANES_HELD.get(this.#key);
      if (holder !== undefined && holder !== this) {
        throw new SandboxError(`another lanes pod driver of creator ${this.#creator} holds a pod in namespace ${this.#ctx.namespace}: one driver a process, since each open() deletes its creator's lanes pods`);
      }
      LANES_HELD.set(this.#key, this);
      await this.#sandbox.preflight('node22');
      if (s.abort.signal.aborted) throw closed();
      const ownerUid = await this.#creatorUid();
      await this.#sweep();
      if (s.abort.signal.aborted) throw closed();
      const addresses = this.#gateway === null ? null : await this.#addressesOf(this.#gateway.host);
      const pod = this.#spec(s.name, ownerUid);
      if (s.abort.signal.aborted) throw closed();
      s.created = true;
      const made = await kubectl(this.#ctx, ['create', '-f', '-', '-o', CREATED_JSONPATH], { input: JSON.stringify({ apiVersion: 'v1', kind: 'List', items: [pod] }), signal: s.abort.signal });
      if (s.abort.signal.aborted) throw closed();
      if (made.code !== 0 || made.error !== undefined) {
        const said = why(made);
        const message = `kubectl could not create lanes pod ${s.name}: ${said}`;
        throw made.error === undefined && NO_ROOM_RE.test(said) ? new NodeRoomError(message, said) : new SandboxError(message);
      }
      if (this.#gateway !== null && addresses !== null) {
        const uid = createdUid(made.stdout, s.name);
        if (uid === null) throw new SandboxError(`kubectl create did not say lanes pod ${s.name}'s uid, which its ${GATEWAY_POLICY_SUFFIX} policy is owned by (${JSON.stringify(made.stdout.slice(0, 200))})`);
        const policy = lanesGatewayPolicy({ name: s.name, namespace: this.#ctx.namespace, uid, addresses, port: this.#gateway.port });
        const owned = await kubectl(this.#ctx, ['create', '-f', '-'], { input: JSON.stringify(policy), signal: s.abort.signal });
        if (s.abort.signal.aborted) throw closed();
        if (owned.code !== 0 || owned.error !== undefined) throw new SandboxError(`kubectl could not create lanes pod ${s.name}'s ${GATEWAY_POLICY_SUFFIX} policy: ${why(owned)}`);
        s.policy = addresses;
      }
      const ready = await awaitPod(this.#ctx, s.name, 'Ready', this.#ctx.readyTimeoutMs, s.abort.signal);
      if (s.abort.signal.aborted) throw closed();
      if (!ready.ok) {
        const message = `lanes pod ${s.name} never became ready: ${ready.why}`;
        throw ready.noRoom === undefined ? new SandboxError(message) : new NodeRoomError(message, ready.noRoom);
      }
      const read = await readPod(this.#ctx, s.name);
      if (s.abort.signal.aborted) throw closed();
      const ip = 'pod' in read ? read.pod.status?.podIP : undefined;
      if (typeof ip !== 'string' || isIP(ip) === 0) {
        throw new SandboxError(`lanes pod ${s.name} is ready without an IP (${'pod' in read ? 'none in its status' : 'gone' in read ? read.gone : read.error})`);
      }
      if (this.#gateway !== null && s.policy !== null) {
        const missed = await this.#reachGateway(s, s.policy, this.#gateway.port);
        if (s.abort.signal.aborted) throw closed();
        if (missed !== null) {
          throw new SandboxError(`lanes pod ${s.name} could not reach its LLM gateway within ${POLICY_WAIT_MS} ms of Ready, so its ${GATEWAY_POLICY_SUFFIX} policy is not enforced for it (${missed})`);
        }
      }
      s.address = ip;
      return { address: ip };
    } catch (err) {
      // Cut by close() (read before the end below aborts it too): the failure is the close, whatever the call said.
      const cut = s.abort.signal.aborted;
      const end = this.#end(s);
      s.closing ??= end;
      await end;
      throw cut && !(err instanceof NodeRoomError) ? closed() : err;
    }
  }

  /**
   * The policy wait (the header's): ONE exec, from inside the pod each address its policy names takes a connection on
   * the gateway's port (POLICY_WAIT_ARGV in node22, the pod's runtime) within POLICY_WAIT_MS, bounded as an entry's
   * by POLICY_WAIT_MS + KUBECTL_TIMEOUT_MS. Null once all did, else what failed.
   */
  async #reachGateway(s: Session, addresses: readonly string[], port: number): Promise<string | null> {
    const targets = addresses.flatMap((a) => [a, String(port)]);
    const r = await kubectl(this.#ctx, ['exec', s.name, '-c', CONTAINER, '--', ...POLICY_WAIT_ARGV.node22, String(POLICY_WAIT_MS), ...targets], {
      signal: s.abort.signal,
      timeoutMs: POLICY_WAIT_MS + KUBECTL_TIMEOUT_MS,
    });
    if (r.code === 0 && r.error === undefined) return null;
    const said = r.stdout.trim().split('\n').at(-1) ?? '';
    const [at] = said.split(' ');
    if (r.code === 1 && r.error === undefined && addresses.some((a) => `${a}:${port}` === at)) return `the gateway at ${said}`;
    return `the wait did not run: ${why(r)}`;
  }

  /** This process's own pod's uid: what the pod's ownerReferences name. */
  async #creatorUid(): Promise<string> {
    const r = await kubectl(this.#ctx, ['get', `pod/${this.#creator}`, '-o', 'jsonpath={.metadata.uid}']);
    if (r.code !== 0 || r.error !== undefined) throw new SandboxError(`kubectl get pod/${this.#creator} (the lanes pod's owner): ${why(r)}`);
    return r.stdout.trim();
  }

  /** Delete every lanes pod this creator's annotation names, with its `-llm` policy: an earlier run of the same pod left them. */
  async #sweep(): Promise<void> {
    const list = await kubectl(this.#ctx, ['get', 'pods', '-l', `${SANDBOX_KIND_LABEL}=${LANES_KIND}`, '-o', 'json']);
    if (list.code !== 0 || list.error !== undefined) throw new SandboxError(`kubectl get pods -l ${SANDBOX_KIND_LABEL}=${LANES_KIND}: ${why(list)}`);
    let items: unknown;
    try {
      items = (JSON.parse(list.stdout) as { items?: unknown }).items;
    } catch {
      items = undefined;
    }
    if (!Array.isArray(items)) throw new SandboxError(`kubectl get pods -l ${SANDBOX_KIND_LABEL}=${LANES_KIND} printed no list: ${JSON.stringify(list.stdout.slice(0, 200))}`);
    type Item = { metadata?: { name?: unknown; annotations?: Record<string, unknown> } };
    const left = (items as Item[])
      .map((i) => ({ name: i?.metadata?.name, creator: i?.metadata?.annotations?.[CREATOR_ANNOTATION] }))
      .filter((i): i is { name: string; creator: string } => typeof i.name === 'string' && i.name.startsWith(POD_PREFIX) && i.creator === this.#creator)
      .map((i) => i.name);
    if (left.length === 0) return;
    this.#sandbox.warn(`k8s lanes: deleting lanes pod(s) an earlier run of ${this.#creator} left (${left.join(' ')})`);
    await deleteObjects(
      this.#deleteCtx,
      left.flatMap((n) => [`pod/${n}`, `networkpolicy/${n}${GATEWAY_POLICY_SUFFIX}`]),
    );
  }

  /** A host's addresses, sorted and unique: itself when it is one. */
  async #addressesOf(host: string): Promise<string[]> {
    if (isIP(host) !== 0) return [host];
    let addresses: string[];
    try {
      addresses = await this.#lookup(host);
    } catch (err) {
      throw new SandboxError(`the LLM gateway's host ${host} does not resolve: ${(err as Error).message}`);
    }
    const out = [...new Set(addresses)].sort();
    if (out.length === 0) throw new SandboxError(`the LLM gateway's host ${host} resolves to no address`);
    return out;
  }

  /**
   * `kubectl exec -i <pod> -c main -- <argv>`: the pod's ONE stream (the header's One exec a pod). A SandboxError before
   * open() resolved, after close(), or for a second exec into the same pod.
   */
  exec(argv: readonly string[]): KubectlChild {
    const s = this.#session;
    if (s === null || s.address === null) throw new SandboxError('the lanes pod is not open: open() it first');
    if (s.closing !== null) throw new SandboxError(`lanes pod ${s.name} is closed: open() a fresh one`);
    if (s.stream !== null) throw new SandboxError(`lanes pod ${s.name} has had its one exec (execs into one gVisor pod are served one at a time): close it and open a fresh one`);
    if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string')) throw new SandboxError('a lanes pod exec takes a non-empty argv of strings');
    s.stream = this.#ctx.stream(['-n', this.#ctx.namespace, 'exec', '-i', s.name, '-c', CONTAINER, '--', ...argv]);
    return s.stream;
  }

  /** Cut the stream and delete the pod and its policy, once; idempotent, resolving once the delete was sent. */
  close(): Promise<void> {
    const s = this.#session;
    if (s === null) return Promise.resolve();
    s.closing ??= (async () => {
      s.abort.abort();
      s.stream?.kill();
      await s.opening.catch(() => undefined);
      await this.#end(s);
    })();
    return s.closing;
  }

  /** A session's end, once: its stream cut, what its create made deleted, the process's hold released. */
  #end(s: Session): Promise<void> {
    s.ended ??= (async () => {
      s.abort.abort();
      s.stream?.kill();
      if (s.created) await deleteObjects(this.#deleteCtx, this.#refs(s.name));
      if (LANES_HELD.get(this.#key) === this) LANES_HELD.delete(this.#key);
    })();
    return s.ended;
  }

  /**
   * The namespace's pods not finished (reapOrphans' list), or null when it cannot be read or does not hold this
   * process's own pod (then it is not trusted to say which creators are gone).
   */
  async creators(): Promise<ReadonlySet<string> | null> {
    let r: KubectlResult;
    try {
      r = await kubectl(this.#ctx, LIVE_PODS);
    } catch {
      return null;
    }
    if (r.code !== 0 || r.error !== undefined) return null;
    const alive = new Set(
      r.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('pod/'))
        .map((l) => l.slice(4)),
    );
    return alive.has(this.#creator) ? alive : null;
  }

  /**
   * Whether the LLM gateway moved off the addresses the open pod's `-llm` policy was made with (the header's The
   * gateway's address): a configured host that is a name resolved again and compared; on a change ONE `[grader] ALERT:`
   * line, and true from then on for this pod. False with no open pod, no gateway, a literal address, or a resolve that
   * fails (said once: the policy is kept).
   */
  async gatewayMoved(): Promise<boolean> {
    const s = this.#session;
    const gateway = this.#gateway;
    if (s === null || s.closing !== null || s.policy === null || gateway === null || isIP(gateway.host) !== 0) return false;
    if (s.moved) return true;
    let now: string[];
    try {
      now = await this.#addressesOf(gateway.host);
    } catch (err) {
      const said = (err as Error).message;
      if (s.resolveSaid !== said) this.#sandbox.warn(`k8s lanes: lanes pod ${s.name} keeps its ${GATEWAY_POLICY_SUFFIX} policy (${s.policy.join(' ')}): ${said}`);
      s.resolveSaid = said;
      return false;
    }
    if (now.length === s.policy.length && now.every((a, i) => a === s.policy![i])) return false;
    if (s.moved) return true;
    s.moved = true;
    this.#sandbox.warn(
      `[grader] ALERT: the LLM gateway ${gateway.host} moved from ${s.policy.join(' ')} to ${now.join(' ')}: lanes pod ${s.name}'s ${GATEWAY_POLICY_SUFFIX} policy reaches only the old addresses, so it is replaced once it holds no lane and new lanes wait for the new pod`,
    );
    return true;
  }
}

/**
 * The lanes pod driver for `sandbox` (the header): refused for a sandbox with no RuntimeClass or no creator, or a
 * lanes directory or size lanesPodSpec refuses.
 */
export function lanesPodOf(sandbox: LanesSandbox, opts: LanesPodOfOptions): K8sLanesPod {
  return new K8sLanesPod(sandbox, opts);
}
