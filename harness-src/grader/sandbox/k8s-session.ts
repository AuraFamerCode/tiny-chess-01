// A case session's pod (types.ts's header: sessions; grader/program.ts executePerCase): the cases of one per-file
// program/v1 execution run one after another in ONE sandbox pod, each by its own exec into `main`, where a sandbox pod
// each ran them before. This file is the session's pure pieces: the pod (sessionPodSpec), `main`'s PID 1
// (SESSION_PID1_SCRIPT), the per-case namespace launcher (CASE_LAUNCHER_SCRIPT) and the exec wrapper around it
// (SESSION_EXEC_WRAPPER), the reset between two cases (SESSION_RESET_SCRIPT) and the restage of each case's read-only
// mounts (restageCommand), and what drives them (K8sSession, the session runtime: K8sSandbox.sessions.open with
// K8sSandboxOptions.caseSessions true), over what grader/sandbox/k8s.ts exports (k8s-lanes.ts's precedent; k8s.ts's
// header: Case sessions). k8s.ts imports K8sSession from here and this file imports k8s.ts, so nothing at this file's top
// level reads a value of k8s.ts's (k8s-network.ts's cycle, the same): SESSION_EXEC_WRAPPER and SESSION_REPORT_TAG are
// defined there, beside SentinelScanner, which reads the report, and re-exported here.
//
// What a session makes, per execution (K8sSession; each run a K8sProcess in its session mode, k8s.ts Launch.session):
//
//   once, at the first spawn (bootPod, as a program pod's boot):
//   kubectl -n <ns> create -f - --validate=false       the session pod (sessionPodSpec), then its env Secret owned by it
//   kubectl -n <ns> wait --for=jsonpath=<INIT_RUNNING_JSONPATH> pod/<pod>   `stage` running
//   kubectl -n <ns> exec -i <pod> -c stage -- /bin/sh -c <STAGE_EXEC_SCRIPT> sh 1 perl -e <unpacker> -- /bot
//   kubectl -n <ns> wait --for=condition=Ready pod/<pod>
//   kubectl -n <ns> exec -i <pod> -c main -- /bin/sh -c <SESSION_EXEC_WRAPPER> sh <pids> perl -e <launcher> -- 65534 65534 perl -e <loopback probe>
//                                                      the launcher check: exactly the start line, `RS<nonce>iok` and
//                                                      the sentinel 0 (the probe carried a byte over 127.0.0.1 inside
//                                                      the case's own network namespace), or the session degrades (below)
//   per case, its spawn:
//   kubectl -n <ns> exec -i <pod> -c main -- perl -e <SESSION_RESET_SCRIPT> -- <writable mount points...>
//                                                      the reset, nonce on stdin, but before a pod's first case
//   kubectl -n <ns> exec -i <pod> -c watch -- perl -e <SESSION_RESTAGE_SCRIPT> -- <n> /restage/input ... <unpacker...>
//                                                      the restage of its read-only mounts (stageStream into `watch`)
//   kubectl -n <ns> exec -i <pod> -c watch -- perl -e <WATCH_SCRIPT> ...   its meters, beside the next one
//   kubectl -n <ns> exec -i <pod> -c main -- /bin/sh -c <SESSION_EXEC_WRAPPER> sh <pids> perl -e <launcher> -- 65534 65534 <program...>
//   kubectl -n <ns> exec <pod> -c watch -- perl -e <packer> -- /output <caps...>   the collect of its writable mounts
//   once, at close() (or when the pod is spent):
//   kubectl -n <ns> delete pod/<pod> [secret/<pod>-env] --ignore-not-found --grace-period=1 --wait=false
//
// What the cases share: the pod (its node, its image and digest, its limits, environment and secrets, one env Secret),
// /bot staged once, the reaper as `main`'s PID 1 and `watch`. What each gets fresh: its /input restaged from its own
// host directory (emptied first, so nothing of an earlier case's is there), its /output, /tmp and /dev/shm emptied by the
// reset (and its /output's host directory empty, or the spawn is refused: `watch` mounts /output read-only, so no seed
// file of the host's could reach `main`), no process of an earlier case's (the reset's kill, then its verify), its own
// user, IPC and network namespaces (the case launcher: so its own loopback, with no earlier case's port in TIME_WAIT
// and no earlier case's abstract unix socket), and an empty /dev/termination-log (the reset's). A run's `started` and
// `finished` are its exec's start line and sentinel, as a program pod's: the reset and the restage are before
// `started`, no case's wall time.
//
// A spent pod: its run's pod ended it (podKill `memory`, `volume` or `pid1`), the run's end was the driver's failure,
// or a kill that failed left its program possibly running; the reset says dirty or is cut off; a reset or restage exec
// finds `main` ended by its own program or the pod out of memory (k8s.ts readPodVerdict). The spent pod is deleted and a
// fresh one booted, for the case whose reset or restage found it so (that case then runs in the new pod, its first, no
// reset) or for the next spawn; the run that spent it ends as it ended, the program's and never a void it could force.
// Any other failure of the create, the staging, the reset or the restage is that run's K8S_DRIVER_FAILURE (the pod
// spent with it), as a staging failure is a program pod's; no room on the node is the run's noRoom (k8s.ts noRoomOf), so
// grader/run.ts throws a NodeRoomError and the job is handed back. A launcher check that fails (the launcher cannot run,
// or the loopback probe it runs finds no working 127.0.0.1 in the case's network namespace) degrades the session: the
// case the pod was booted for runs there alone under EXEC_WRAPPER (a fresh pod, nothing before it), the pod is deleted
// once it has ended, and every later spawn is the sandbox's own program pod; it is said once on the driver's warning
// channel (ctx.warn). One run at a time: a spawn while a run is live, a spec checkSessionRun refuses, a writable mount's
// host directory that is not empty, or a spawn after close() is a SandboxError before anything starts. kill() of a run is
// a program pod's (`kill -KILL -1` in `main`, the collect) but keeps the pod. close() kills a live run, deletes the
// pod once, and never throws.
//
// The pod (sessionPodSpec) is sandboxPodSpec's split program pod for the session's template (types.ts
// checkSessionTemplate: a plain program's spec, no network, launcher, race, image or work; never timed, so a timing
// heat's runs stay a pod each), every field of it kept but three:
//
//   `main`'s command        SESSION_PID1_COMMAND, a perl reaper, in place of `sleep infinity`. The wrapper's
//                           `kill -KILL -1` ends what a case left, and each killed orphan is reparented to PID 1:
//                           `sleep infinity` reaps nothing, so they would stay zombies, and RLIMIT_NPROC counts a uid's
//                           zombies too (deploy/k8s/README.md, Measured: two containers in one gVisor pod, rows a2 and
//                           d), so the next case's `ulimit -u` would start short of what a fresh pod gives. The reaper
//                           waits on every child as SIGCHLD comes (and once a second besides), ignores the catchable
//                           signals that would end it (gVisor lets a program signal its container's PID 1: a program
//                           that kills it anyway, as with `sleep`, ends `main`, the case's own crash), and forks nothing.
//                           Its command line is SESSION_PID1_CMDLINE exactly, which is how the reset knows it is in a
//                           session pod (below)
//   `stage`                 stages /bot alone: the code is the session's, one tree for every case
//                           (checkSessionRun holds the code directory the template's). Its read-only mounts (/input)
//                           are restaged per case through `watch`; its writable ones (/output) start empty, as the
//                           kubelet makes them, and the reset empties them again between two cases
//   `watch`                 each writable mount read-only at its mount point, as in every pod with one (the collect,
//                           the meter and the live files read them there), plus each read-only mount's volume
//                           READ-WRITE at a path of its own, restageMountPath (`/restage/input`). A pod with read-only
//                           mounts and no writable one gets `watch` for them alone, the same container
//
// Labels, annotations and everything else are a program pod's (makefun.grader=1, makefun.io/role=sandbox,
// makefun.io/sandbox=program, the creator annotation when the process names its pod), so reapOrphans takes a dead
// grader's session pod as it takes its program pods, and the stale sweep and activeDeadlineSeconds stay its backstops.
//
// Why `watch` may write /input here. In a program pod nothing that holds an input read-write is alive while the program
// runs: `stage` holds them and is gone before `main` exists. A session's cases each need their own /input, and the pod
// outlives them, so something must write it between two cases; `watch` is that one container. It is the house's (the
// grader's uid, WATCH_UID, the same as STAGE_UID, so a restaged file shows the owner and modes a staged one does), no
// program of the entrant's is ever exec'd into it, and it writes only by the restage exec, which runs between two cases:
// after the reset found the previous case's processes all dead (and its /output collected and wiped), before the next
// case's exec starts. `main` mounts the same volume read-only, so no case can write its input, and its restaged path is
// outside every mount `main` has, so none can reach it there. What `watch` writes is what the next case's own host
// directory holds, nothing more: a case never sees an earlier case's input, nor a later one's.
//
// Each case runs under the case launcher (CASE_LAUNCHER_SCRIPT, by SESSION_EXEC_WRAPPER): perl, as perl-base is in both
// pinned images, which unshares a user, an IPC and a network namespace of the case's own (one unshare call,
// CLONE_NEWUSER|CLONE_NEWIPC|CLONE_NEWNET, by raw syscall per machine as the CPU launcher's are), denies setgroups, maps
// 65534 to 65534 and nothing else in uid_map and gid_map, reports `ok` on descriptor 4 (close-on-exec), then execs the
// program in its own place. The program's uid is 65534 inside and out (its files are 65534's to every container), and
// exec drops every capability the new namespace gave the launcher, since its uid there is not 0 (probe K3 is what
// measures it: CapEff and CapPrm 0 after the exec). What it closes: SysV shared memory, semaphores and message queues,
// POSIX message queues and keyrings outlive the process that made them in the pod-wide IPC namespace (research #30), and
// none can be erased by a sweep (mqueues are not enumerable, keyrings have no erase); made in the case's own IPC
// namespace, they go with it. And the network: a loopback TCP connection's TIME_WAIT holds its port for about 60 s
// after the close in the pod's network namespace (probe K7: a bind without SO_REUSEADDR refused until +61 s), and gVisor
// lists no TIME_WAIT in /proc/net/tcp, so no reset could wait it out; abstract unix sockets are per network namespace
// too. The case's own network namespace has its own `lo`, up under gVisor, with no earlier case's port held or socket
// bound, and it takes nothing a case may use: a session's template has no network (checkSessionTemplate), so the pod's
// interface reaches nothing a case is given, its DNS 127.0.0.1. Its own failure (no unshare, no maps, no descriptor 4) is its words on stderr, nothing on descriptor 4 and
// exit 125, and the wrapper then prints no report: a sentinel with no `ok` report is the driver's failure, never the
// case's, and where the launcher cannot run (a cluster that refuses any of the three namespaces) the session gives every
// run a pod of its own instead (the session runtime's launcher check), never cases in one pod without it. The same
// check runs the loopback probe (CASE_LOOPBACK_PROBE: a listener on 127.0.0.1, a connection to it, a byte across) as
// its case: a runtime whose new network namespace has `lo` down (a Linux kernel's runc, where nothing brings it up)
// would give each case no loopback at all, so a probe that fails there degrades the session the same way.
//
// SESSION_EXEC_WRAPPER is TIMED_EXEC_WRAPPER's shape: EXEC_WRAPPER up to the start line, then the launcher in a command
// substitution holding descriptor 4 (its stdout and stderr the real ones), `kill -KILL -1` once it has ended, then the
// launcher's report as `RS<nonce>i<word>\n` (`RSi` and a word of lower-case letters: `ok`) before the sentinel. The
// program, 65534 in a namespace of its own, can read neither the wrapper's nonce nor descriptor 4 (closed at its exec),
// so it cannot forge the report. The wrapper's process cap is a fresh pod's: PID 1 (the reaper, one task) and the
// wrapper, POD_OWN_TASKS, the launcher being the program's own task until it execs.
//
// The reset (SESSION_RESET_SCRIPT, by sessionResetArgv: `perl -e <reset> -- <writable mount point>...`, exec'd into
// `main` as 65534 with the nonce on stdin's first line, the exec's only process) runs before every case but a pod's
// first, and forks nothing. Its steps, in order, each named in the script so a channel found later is one more step:
//
//   1. refuse        unless /proc/1/cmdline is SESSION_PID1_CMDLINE and PID 1 is 65534's, and the reset itself runs
//                    as 65534 (never as root): so it can never kill on a host, where kill(-1) would end every process
//                    of the user running it. A refusal is `dirty refused: ...`, nothing killed
//   2. kill          kill(-1, SIGKILL) by raw syscall, then /proc read again, in rounds (SESSION_RESET_ROUNDS,
//                    SESSION_RESET_PAUSE_MS apart) until no process but PID 1 and the reset is left, live or zombie:
//                    under gVisor kill(-1) races fork (research #30), so one kill may leave a child a storm forked
//                    meanwhile, and the reaper needs a moment for each zombie
//   3. wipe          every entry 65534 owns under the writable mount points, /tmp and /dev/shm (SESSION_SHARED_ROOTS:
//                    pod-shared, mode 1777) is removed, a directory given u+rwx first, emptied, then removed. The walk
//                    goes by chdir and never follows a link, so a tree nested past PATH_MAX is still removed. Another
//                    uid's entry is never removed: it is named (and gone into for 65534's entries where it may be)
//   4. termination-log  /dev/termination-log (SESSION_TERMINATION_LOG, the kubelet's terminationMessagePath for
//                    `main`) truncated to 0 bytes, opened write-only with O_TRUNC and never created: probe K1 found it
//                    the one file outside /output, /tmp and /dev/shm that 65534 may write, and it outlives every exec,
//                    so a case could leave the next one a message there. Not there is nothing to carry
//   5. verify        no process but PID 1 and the reset, no zombie, nothing of 65534's left under those directories,
//                    nor any entry of another uid's (none is ever there in a session pod: a surprise spends the pod
//                    rather than be kept), and /dev/termination-log empty
//
// It prints one line, `RS<nonce>clean\n`, or `RS<nonce>dirty <why>\n` (printable ASCII, at most about 600 characters),
// and exits 0 or 1 (parseSessionReset reads it); with no nonce it prints nothing and exits 2. What the per-case
// namespaces cover (SysV, mqueues, keyrings; a loopback port's TIME_WAIT, which gVisor never lists in /proc/net/tcp
// (probe K7), and abstract unix sockets) it does not sweep. Its file steps alone are SESSION_WIPE_SCRIPT (the same
// subroutines, SESSION_SWEEP_LIB, over the directories and uid given, killing nothing), which is what runs on a host tree
// in the unit tests; its kill step runs only in a session pod.
//
// The restage (restageCommand: k8s-transfer.ts stageStream's `command` hook, the exec `-c watch`) empties each
// restaged directory it is given (SESSION_RESTAGE_SCRIPT: the same chdir walk, umask 022, directories given u+rwx
// first; it prints `no <why>` in the unpacker's words when it cannot), then execs the tree unpacker into them, whose ack
// stays the first line and the verdict. It signals no PID 1: `watch`'s is `sleep infinity`, and nothing waits for a
// release.

import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { imageFor, type ImageTableT } from '../images.ts';
import { checkSandboxLabel, positiveInt } from './docker.ts';
import {
  bootPod,
  checkPodMounts,
  checkUnderDataRoot,
  CONTAINER,
  deleteObjects,
  EXEC_WRAPPER,
  failure,
  K8S_DRIVER_FAILURE,
  K8sProcess,
  killedExit,
  kubectl,
  KUBECTL_TIMEOUT_MS,
  mountVolumeName,
  POD_OWN_TASKS,
  podName,
  readPodVerdict,
  sandboxPodSpec,
  SENTINEL_MARK,
  SESSION_EXEC_WRAPPER,
  SESSION_REPORT_TAG,
  STAGE_CONTAINER,
  WATCH_CONTAINER,
  watchContainer,
  why,
  type K8sContext,
  type K8sObject,
  type NodePreference,
  type PodPlacement,
  type SandboxPodOptions,
  type SessionLaunch,
  type SessionPrepared,
  type SessionRunEnd,
} from './k8s.ts';
import { stageStream } from './k8s-transfer.ts';
import { checkSandboxMounts } from './mounts.ts';
import { treeUnpackArgv } from './tree-stream.ts';
import {
  checkHostPath,
  checkSessionRun,
  checkSessionTemplate,
  RUNTIME_COMMANDS,
  SandboxError,
  scriptOf,
  type Runtime,
  type Sandbox,
  type SandboxExit,
  type SandboxMount,
  type SandboxProcess,
  type SandboxSession,
  type SandboxSpec,
  type TreeMeter,
  type TreeMeterOptions,
} from './types.ts';

/** The session wrapper and its report line's tag live in k8s.ts beside their reader (SentinelScanner): the header. */
export { SESSION_EXEC_WRAPPER, SESSION_REPORT_TAG };

/** The uid and gid every case runs as, inside its namespace and out (`main`'s, the sandbox user's), and the reset's. */
export const SESSION_UID = 65534;
/** The code directory: what `stage` stages in a session pod, alone. */
export const SESSION_CODE_DIR = '/bot';
/** The pod-shared directories the reset wipes besides the writable mounts: /tmp (a Memory emptyDir) and /dev/shm. */
export const SESSION_SHARED_ROOTS: readonly string[] = Object.freeze(['/tmp', '/dev/shm']);
/** Where `watch` holds each read-only mount's volume read-write in a session pod: `/restage<mount point>` (restageMountPath). */
export const SESSION_RESTAGE_ROOT = '/restage';
/** The most kill rounds of the reset (each a kill(-1) and a /proc read). */
export const SESSION_RESET_ROUNDS = 50;
/** The pause between a round's kill and its /proc read. */
export const SESSION_RESET_PAUSE_MS = 20;
/** `main`'s termination message file (the kubelet's default terminationMessagePath), which the reset empties. */
export const SESSION_TERMINATION_LOG = '/dev/termination-log';
/** The reset's verdict words: `RS<nonce>clean` or `RS<nonce>dirty <why>`. */
export const SESSION_RESET_CLEAN = 'clean';
export const SESSION_RESET_DIRTY = 'dirty';
/** The case launcher's one report on descriptor 4, printed by the wrapper as `RS<nonce>i<word>`. */
export const CASE_LAUNCHER_OK = 'ok';

/**
 * `main`'s PID 1 in a session pod (the header): a perl reaper. It reaps every child on SIGCHLD and once a second
 * besides, ignores the catchable signals that would end it, and forks nothing. Its first line marks it.
 */
export const SESSION_PID1_SCRIPT = [
  '# makefun session reaper/1',
  'use strict;',
  'use warnings;',
  'use POSIX ();',
  "$SIG{$_} = 'IGNORE' for qw(HUP INT QUIT TERM USR1 USR2 PIPE ALRM);",
  'sub reap { 1 while waitpid(-1, POSIX::WNOHANG()) > 0 }',
  '$SIG{CHLD} = \\&reap;',
  'for (;;) { reap(); sleep 1 }',
].join('\n');
/** `main`'s command in a session pod. */
export const SESSION_PID1_COMMAND: readonly string[] = Object.freeze(['perl', '-e', SESSION_PID1_SCRIPT]);
/** What /proc/1/cmdline reads in a session pod's `main`: the command's words, each ended by a NUL. */
export const SESSION_PID1_CMDLINE = `${SESSION_PID1_COMMAND.join('\0')}\0`;

/**
 * The case launcher (the header), perl with perl-base's modules alone, run as
 * `perl -e CASE_LAUNCHER_SCRIPT -- <uid> <gid> <argv...>` with descriptor 4 its report: it must run as uid:gid alone; it
 * unshares CLONE_NEWUSER|CLONE_NEWIPC|CLONE_NEWNET by raw syscall (x86_64, aarch64: the pinned images' two), denies
 * setgroups (a kernel with no setgroups file has no such gate), maps uid to uid and gid to gid and nothing else, reads
 * both maps back, writes `ok` on descriptor 4 (close-on-exec, and closed) and execs argv (a PATH search, as the
 * wrapper's `exec` does).
 * A failure of its own before the report goes to stderr as `case launcher: ...`, nothing on descriptor 4, and exit 125.
 * An exec that fails after it is the program's, as the plain wrapper's `exec` failing is: 127 when it is not found,
 * else 126, its words on stderr.
 */
export const CASE_LAUNCHER_SCRIPT = [
  'use strict;',
  'use warnings;',
  'use POSIX ();',
  'use Fcntl ();',
  'sub fail { print STDERR "case launcher: $_[0]\\n"; exit 125 }',
  'my ($uid, $gid, @argv) = @ARGV;',
  "fail('usage: perl -e <launcher> -- <uid> <gid> <argv...>') unless defined $gid && @argv && $uid =~ /\\A[1-9][0-9]*\\z/ && $gid =~ /\\A[1-9][0-9]*\\z/;",
  "open(my $report, '>&=', 4) or fail(\"no report descriptor 4: $!\");",
  'my $fl = fcntl($report, Fcntl::F_GETFD(), 0);',
  '(defined $fl && fcntl($report, Fcntl::F_SETFD(), $fl | Fcntl::FD_CLOEXEC())) or fail("descriptor 4: $!");',
  'sub alone { return POSIX::getuid() == $uid && POSIX::geteuid() == $uid && POSIX::getgid() == $gid && POSIX::getegid() == $gid }',
  'fail("the launcher runs as $uid:$gid alone, not " . POSIX::getuid() . ":" . POSIX::getgid()) unless alone();',
  'my $machine = (POSIX::uname())[4];',
  'my %NR = (x86_64 => 272, aarch64 => 97);',
  'my $nr = $NR{$machine} or fail("no syscall numbers for $machine");',
  // CLONE_NEWUSER 0x10000000 | CLONE_NEWIPC 0x08000000 | CLONE_NEWNET 0x40000000, in one call: the IPC and network
  // namespaces are the new user namespace's. The network one gives the case a loopback of its own: no port an earlier
  // case's connection holds in TIME_WAIT (gVisor lists none, so no reset can wait it out) and no abstract unix socket
  // of an earlier case's; the session pod has no network beyond loopback for a case anyway.
  'syscall($nr, 0x58000000) == 0 or fail("unshare(CLONE_NEWUSER|CLONE_NEWIPC|CLONE_NEWNET): $!");',
  'sub put {',
  '  my ($path, $text, $optional) = @_;',
  '  my $f;',
  '  if (!sysopen($f, $path, Fcntl::O_WRONLY())) { return if $optional && $!{ENOENT}; fail("$path: $!") }',
  '  my $w = syswrite($f, $text);',
  '  fail("$path: " . (defined $w ? "a short write" : $!)) unless defined $w && $w == length $text;',
  '  close($f) or fail("$path: $!");',
  '}',
  "put('/proc/self/setgroups', \"deny\\n\", 1);",
  "put('/proc/self/uid_map', \"$uid $uid 1\\n\");",
  "put('/proc/self/gid_map', \"$gid $gid 1\\n\");",
  'sub mapped {',
  '  my ($path, $id) = @_;',
  "  open(my $f, '<', $path) or return 0;",
  '  my @l = <$f>;',
  '  close $f;',
  "  return @l == 1 && join(' ', split(' ', $l[0])) eq \"$id $id 1\";",
  '}',
  "fail('the namespace maps more than its own ids') unless mapped('/proc/self/uid_map', $uid) && mapped('/proc/self/gid_map', $gid) && alone();",
  'my $said = syswrite($report, "ok\\n");',
  'fail("descriptor 4: $!") unless defined $said && $said == 3;',
  'close $report;',
  "{ no warnings 'exec'; exec { $argv[0] } @argv; }",
  'my $missing = $!{ENOENT};',
  'print STDERR "case launcher: exec $argv[0]: $!\\n";',
  'exit($missing ? 127 : 126);',
].join('\n');

/**
 * The loopback probe (the header's launcher check), perl with perl-base's modules alone (Socket, as BIND_PROOF_ARGV's),
 * run under the case launcher so it runs in a case's own network namespace: a TCP listener bound to 127.0.0.1 on a port
 * the kernel picks, a second socket connected to it, the connection accepted, and one byte carried across it. Nothing on
 * stdout (the check reads its stdout whole); exit 0 when the byte arrived, else its words on stderr as
 * `loopback probe: ...` and exit 1, within CASE_LOOPBACK_PROBE_SECONDS. A namespace whose `lo` is down (a fresh network
 * namespace on a Linux kernel, where nothing brings it up; gVisor's comes up, deploy/k8s/README.md K7b) fails it at the
 * bind or the connect, so a case would find no loopback there: the session then runs its cases a pod each.
 */
export const CASE_LOOPBACK_PROBE_SECONDS = 10;
export const CASE_LOOPBACK_PROBE_SCRIPT = [
  'use strict;',
  'use warnings;',
  'use Socket qw(PF_INET SOCK_STREAM inet_aton pack_sockaddr_in unpack_sockaddr_in);',
  'sub fail { print STDERR "loopback probe: $_[0]\\n"; exit 1 }',
  `$SIG{ALRM} = sub { fail('no answer within ${CASE_LOOPBACK_PROBE_SECONDS} s') };`,
  `alarm ${CASE_LOOPBACK_PROBE_SECONDS};`,
  "my $lo = inet_aton('127.0.0.1') or fail('no address 127.0.0.1');",
  'socket(my $l, PF_INET, SOCK_STREAM, 0) or fail("socket: $!");',
  'bind($l, pack_sockaddr_in(0, $lo)) or fail("bind 127.0.0.1:0: $!");',
  'listen($l, 1) or fail("listen: $!");',
  'my $at = getsockname($l) or fail("getsockname: $!");',
  'my ($port) = unpack_sockaddr_in($at);',
  'socket(my $c, PF_INET, SOCK_STREAM, 0) or fail("socket: $!");',
  'connect($c, pack_sockaddr_in($port, $lo)) or fail("connect 127.0.0.1:$port: $!");',
  'accept(my $a, $l) or fail("accept: $!");',
  'my $w = syswrite($c, "x");',
  'fail("send: " . (defined $w ? "nothing sent" : $!)) unless defined $w && $w == 1;',
  'my $r = sysread($a, my $got, 1);',
  'fail("receive: " . (defined $r ? "nothing came" : $!)) unless defined $r && $r == 1 && $got eq "x";',
  'exit 0;',
].join('\n');
/** The program the launcher check runs under the case launcher: the loopback probe. */
export const CASE_LOOPBACK_PROBE: readonly string[] = Object.freeze(['perl', '-e', CASE_LOOPBACK_PROBE_SCRIPT]);

/** The argv a session's wrapper runs for `program`: the case launcher, as SESSION_UID:SESSION_UID. */
export function caseLauncherArgv(program: readonly string[]): string[] {
  if (program.length === 0) throw new SandboxError('a case launcher needs a program to run');
  return ['perl', '-e', CASE_LAUNCHER_SCRIPT, '--', String(SESSION_UID), String(SESSION_UID), ...program];
}

/**
 * The reset's subroutines (the header), perl with perl-base's modules alone, no top-level act: SESSION_RESET_SCRIPT's
 * and SESSION_WIPE_SCRIPT's common part.
 *
 * - wipe_files($uid, @roots): every entry $uid owns under each root removed (the root kept), a directory given u+rwx
 *   first; returns what could not be done.
 * - check_files($uid, @roots): '' when no root holds an entry of $uid's or another uid's, else why not.
 * - others(): every process but PID 1 and this one, as ([live pids], [zombie pids], undef), or an error third.
 * - truncate_file($path): the file emptied, opened write-only with O_TRUNC, never created; '' when done or not there,
 *   else why not. file_left($path): '' when the file is empty or not there, else why not.
 */
export const SESSION_SWEEP_LIB = String.raw`use strict;
use warnings;
no warnings 'recursion';
use POSIX ();
use Fcntl qw(:mode);
sub shown { my ($s) = @_; $s = substr($s, 0, 200) . '...' if length($s) > 200; $s =~ s/[^\x20-\x7e]/?/g; return $s }
sub said { my ($what, $l) = @_; my $last = $#$l < 4 ? $#$l : 4; return "$what " . join(', ', @$l[0 .. $last]) . (@$l > 5 ? ' and ' . (@$l - 5) . ' more' : '') }
sub pause { select(undef, undef, undef, $_[0]) }
sub err { my ($r, $what, $p, $why) = @_; push @{ $r->{err} }, "$what " . shown($p) . ": $why" }
sub enter {
  my ($n, $p, $st, $uid, $remove, $r, $own) = @_;
  if (!chdir($n)) { err($r, 'chdir', $p, "$!") if $own; return 0 }
  my @here = stat('.');
  die 'the walk lost its way at ' . shown($p) . "\n" unless @here && $here[0] == $st->[0] && $here[1] == $st->[1];
  sweep_here($p, $uid, $remove, $r);
  chdir('..') or die 'the walk could not come back up from ' . shown($p) . ": $!\n";
  return 1;
}
sub sweep_here {
  my ($at, $uid, $remove, $r) = @_;
  my $h;
  if (!opendir($h, '.')) { err($r, 'opendir', $at, "$!"); return }
  my @names = grep { $_ ne '.' && $_ ne '..' } readdir $h;
  closedir $h;
  for my $n (@names) {
    my $p = "$at/$n";
    my @st = lstat($n);
    if (!@st) { err($r, 'lstat', $p, "$!") unless $!{ENOENT}; next }
    my $dir = S_ISDIR($st[2]);
    if ($st[4] != $uid) {
      push @{ $r->{other} }, shown($p) . " (uid $st[4])";
      enter($n, $p, \@st, $uid, $remove, $r, 0) if $dir;
      next;
    }
    if (!$remove) { push @{ $r->{left} }, shown($p); next }
    if (!$dir) { unlink($n) or err($r, 'unlink', $p, "$!"); next }
    if (!chmod(0700, $n)) { err($r, 'chmod', $p, "$!"); next }
    enter($n, $p, \@st, $uid, $remove, $r, 1) or next;
    rmdir($n) or err($r, 'rmdir', $p, "$!");
  }
}
sub sweep_root {
  my ($root, $uid, $remove, $r) = @_;
  my @st = lstat($root);
  if (!@st) { err($r, 'lstat', $root, "$!") unless $!{ENOENT}; return }
  if (!S_ISDIR($st[2])) { push @{ $r->{err} }, shown($root) . ' is not a directory'; return }
  if (!chdir($root)) { err($r, 'chdir', $root, "$!"); return }
  my @here = stat('.');
  if (@here && $here[0] == $st[0] && $here[1] == $st[1]) {
    if (!eval { sweep_here($root, $uid, $remove, $r); 1 }) { my $e = $@; $e =~ s/\n\z//; push @{ $r->{err} }, $e }
  } else {
    push @{ $r->{err} }, shown($root) . ' moved under the walk';
  }
  chdir('/') or die "chdir /: $!\n";
}
sub wipe_files {
  my ($uid, @roots) = @_;
  my %r = (left => [], other => [], err => []);
  sweep_root($_, $uid, 1, \%r) for @roots;
  return @{ $r{err} };
}
sub check_files {
  my ($uid, @roots) = @_;
  my %r = (left => [], other => [], err => []);
  sweep_root($_, $uid, 0, \%r) for @roots;
  my @why;
  push @why, said("uid $uid still owns", $r{left}) if @{ $r{left} };
  push @why, said('another uid owns', $r{other}) if @{ $r{other} };
  push @why, said('could not sweep:', $r{err}) if @{ $r{err} };
  return join('; ', @why);
}
sub others {
  my (@live, @zombie);
  my $d;
  return ([], [], "opendir /proc: $!") unless opendir($d, '/proc');
  for my $p (readdir $d) {
    next unless $p =~ /\A[0-9]+\z/;
    next if $p == 1 || $p == $$;
    open(my $f, '<', "/proc/$p/stat") or next;
    my $s = <$f>;
    close $f;
    next unless defined $s;
    my $at = rindex($s, ')');
    next if $at < 0;
    my ($state) = split ' ', substr($s, $at + 1);
    next if !defined $state || $state eq 'X';
    if ($state eq 'Z') { push @zombie, $p } else { push @live, $p }
  }
  closedir $d;
  return (\@live, \@zombie, undef);
}
sub procs_left {
  my ($live, $zombie) = @_;
  my @why;
  push @why, said('processes left:', $live) if @$live;
  push @why, said('zombies left:', $zombie) if @$zombie;
  return join('; ', @why);
}
sub truncate_file {
  my ($path) = @_;
  my $f;
  if (!sysopen($f, $path, Fcntl::O_WRONLY() | Fcntl::O_TRUNC())) { return $!{ENOENT} ? '' : 'truncate ' . shown($path) . ": $!" }
  close($f) or return 'truncate ' . shown($path) . ": $!";
  return '';
}
sub file_left {
  my ($path) = @_;
  my @st = stat($path);
  if (!@st) { return $!{ENOENT} ? '' : 'stat ' . shown($path) . ": $!" }
  return $st[7] == 0 ? '' : shown($path) . " holds $st[7] bytes";
}
`;

const PID1_CMDLINE_HEX = Buffer.from(SESSION_PID1_CMDLINE, 'latin1').toString('hex');

/**
 * The reset between two cases (the header's five steps), run as `perl -e SESSION_RESET_SCRIPT -- <writable mount
 * point>...` (sessionResetArgv) in `main` as SESSION_UID, the nonce on stdin's first line: one line,
 * `RS<nonce>clean` (exit 0) or `RS<nonce>dirty <why>` (exit 1); with no nonce, nothing on stdout and exit 2. It forks
 * nothing, and its first act after the nonce is the refusal of any process tree that is not a session pod's `main`.
 */
export const SESSION_RESET_SCRIPT =
  SESSION_SWEEP_LIB +
  String.raw`my $nonce = <STDIN>;
if (!defined $nonce || $nonce !~ /\A[0-9a-f]{32}\n?\z/) { print STDERR "session reset: no nonce on stdin's first line\n"; exit 2 }
chomp $nonce;
$| = 1;
sub verdict {
  my ($why) = @_;
  $why =~ s/[^\x20-\x7e]/?/g;
  $why = substr($why, 0, 600) . '...' if length($why) > 600;
  print STDOUT "\x1e$nonce", ($why eq '' ? '${SESSION_RESET_CLEAN}' : "${SESSION_RESET_DIRTY} $why"), "\n";
  exit($why eq '' ? 0 : 1);
}
# Step refuse: PID 1 must be the session reaper, 65534's, and the reset 65534 itself, never root.
my $cmdline;
if (open(my $c, '<', '/proc/1/cmdline')) { local $/; $cmdline = <$c>; close $c }
verdict('refused: PID 1 is not the session reaper') unless defined $cmdline && $cmdline eq pack('H*', '${PID1_CMDLINE_HEX}');
my $pid1;
if (open(my $s, '<', '/proc/1/status')) { while (my $l = <$s>) { if ($l =~ /\AUid:\s+([0-9]+)\s+([0-9]+)/) { $pid1 = [$1, $2]; last } } close $s }
verdict('refused: PID 1 is not the session reaper') unless $pid1 && $pid1->[0] == ${SESSION_UID} && $pid1->[1] == ${SESSION_UID};
verdict('refused: the reset runs as uid ${SESSION_UID} alone') unless $< == ${SESSION_UID} && $> == ${SESSION_UID};
for my $m (@ARGV) { verdict('refused: ' . shown($m) . ' is no writable mount point') unless $m =~ m{\A/[a-z][a-z0-9-]*\z} }
my %NR = (x86_64 => 62, aarch64 => 129);
my $machine = (POSIX::uname())[4];
my $kill = $NR{$machine};
verdict("refused: no kill syscall number for $machine") unless defined $kill;
# Step kill: kill(-1, SIGKILL) and /proc again, in rounds, until nothing but PID 1 and this is left, live or zombie.
my ($live, $zombie, $err) = ([], [], undef);
my $settled = 0;
for my $round (1 .. ${SESSION_RESET_ROUNDS}) {
  verdict("kill(-1, SIGKILL): $!") if syscall($kill, -1, 9) != 0 && !$!{ESRCH};
  pause(${SESSION_RESET_PAUSE_MS / 1000});
  ($live, $zombie, $err) = others();
  verdict($err) if defined $err;
  if (!@$live && !@$zombie) { $settled = 1; last }
}
verdict(procs_left($live, $zombie)) unless $settled;
# Step wipe: 65534's entries under the writable mounts, /tmp and /dev/shm.
my @roots = (@ARGV, ${SESSION_SHARED_ROOTS.map((r) => `'${r}'`).join(', ')});
my @wiped = wipe_files(${SESSION_UID}, @roots);
# Step termination-log: the kubelet's message file, the one other file 65534 may write, emptied (never created).
my $truncated = truncate_file('${SESSION_TERMINATION_LOG}');
# Step verify: no process but PID 1 and this, no zombie, nothing of 65534's or another uid's in those directories,
# and the termination log empty.
($live, $zombie, $err) = others();
verdict($err) if defined $err;
verdict(procs_left($live, $zombie)) if @$live || @$zombie;
my $files = check_files(${SESSION_UID}, @roots);
$files .= '; ' . said('could not wipe:', \@wiped) if $files ne '' && @wiped;
my $log = file_left('${SESSION_TERMINATION_LOG}');
$log .= " ($truncated)" if $log ne '' && $truncated ne '';
verdict(join('; ', grep { $_ ne '' } $files, $log));
`;

/**
 * The reset's file steps alone (wipe, then verify), run as `perl -e SESSION_WIPE_SCRIPT -- <uid> <directory>...`: one
 * line, `clean` (exit 0) or `dirty <why>` (exit 1); a usage fault, exit 2. It kills nothing and reads no /proc: what the
 * unit tests run on a host tree.
 */
export const SESSION_WIPE_SCRIPT =
  SESSION_SWEEP_LIB +
  String.raw`my ($uid, @roots) = @ARGV;
if (!defined $uid || $uid !~ /\A[0-9]+\z/ || !@roots || grep { !m{\A/} } @roots) { print STDERR "usage: perl -e <wipe> -- <uid> <absolute directory>...\n"; exit 2 }
my @wiped = wipe_files($uid, @roots);
my $why = check_files($uid, @roots);
$why .= '; ' . said('could not wipe:', \@wiped) if $why ne '' && @wiped;
print STDOUT ($why eq '' ? "${SESSION_RESET_CLEAN}\n" : "${SESSION_RESET_DIRTY} $why\n");
exit($why eq '' ? 0 : 1);
`;

/** The argv of a session pod's reset for `spec` (the session's template): SESSION_RESET_SCRIPT over its writable mount points. */
export function sessionResetArgv(spec: SandboxSpec): string[] {
  const writable = checkSandboxMounts(spec.mounts)
    .filter((m) => !m.readOnly)
    .map((m) => {
      mountVolumeName(m.at);
      return m.at;
    });
  return ['perl', '-e', SESSION_RESET_SCRIPT, '--', ...writable];
}

/** What a reset said (parseSessionReset). */
export type SessionResetVerdict = { clean: true } | { clean: false; why: string };

const NONCE_RE = /^[0-9a-f]{32}$/;
const WHY_RE = /^[\x20-\x7e]+$/;

/**
 * A reset exec's whole stdout read against its nonce: `{ clean: true }` for `RS<nonce>clean\n`, `{ clean: false, why }`
 * for `RS<nonce>dirty <why>\n`, null for anything else (no line, another nonce, more than the one line), which its
 * caller reads as a reset cut off.
 */
export function parseSessionReset(stdout: string, nonce: string): SessionResetVerdict | null {
  if (!NONCE_RE.test(nonce)) throw new SandboxError(`a reset's nonce is 32 hex digits, not ${JSON.stringify(nonce)}`);
  const head = `${SENTINEL_MARK}${nonce}`;
  if (stdout === `${head}${SESSION_RESET_CLEAN}\n`) return { clean: true };
  const dirty = `${head}${SESSION_RESET_DIRTY} `;
  if (!stdout.startsWith(dirty) || !stdout.endsWith('\n')) return null;
  const why = stdout.slice(dirty.length, -1);
  return WHY_RE.test(why) ? { clean: false, why } : null;
}

/** Where `watch` holds read-only mount `at`'s volume read-write in a session pod: `/restage/input` for `/input`. */
export function restageMountPath(at: string): string {
  mountVolumeName(at);
  return `${SESSION_RESTAGE_ROOT}${at}`;
}

/**
 * The restage's emptying, perl, run as `perl -e SESSION_RESTAGE_SCRIPT -- <n> <directory>... <unpacker argv...>`
 * (restageCommand): umask 022, each of the n absolute directories emptied (the directory kept; a directory in it given
 * u+rwx first, emptied, then removed; nothing followed through a link), then the rest of the argv exec'd in its place.
 * It prints nothing on stdout but, when it cannot, `no <why>` in the unpacker's words, and exits 1.
 */
export const SESSION_RESTAGE_SCRIPT = String.raw`use strict;
use warnings;
no warnings 'recursion';
use Fcntl qw(:mode);
umask 022;
$| = 1;
sub refuse { my ($why) = @_; $why = substr($why, 0, 400) if length($why) > 400; $why =~ s/[^\x20-\x7e]/?/g; print STDOUT "no restage: $why\n"; exit 1 }
my $n = shift @ARGV;
refuse('usage: perl -e <restage> -- <n> <directory>... <argv...>') unless defined $n && $n =~ /\A[1-9][0-9]{0,2}\z/ && @ARGV > $n;
my @dirs = splice(@ARGV, 0, $n);
sub empty_here {
  my ($at) = @_;
  my $h;
  opendir($h, '.') or refuse("opendir $at: $!");
  my @names = grep { $_ ne '.' && $_ ne '..' } readdir $h;
  closedir $h;
  for my $e (@names) {
    my $p = "$at/$e";
    my @st = lstat($e);
    if (!@st) { next if $!{ENOENT}; refuse("lstat $p: $!") }
    if (!S_ISDIR($st[2])) { unlink($e) or refuse("unlink $p: $!"); next }
    chmod(0700, $e) or refuse("chmod $p: $!");
    chdir($e) or refuse("chdir $p: $!");
    my @here = stat('.');
    refuse("$p moved under the walk") unless @here && $here[0] == $st[0] && $here[1] == $st[1];
    empty_here($p);
    chdir('..') or refuse("chdir .. from $p: $!");
    rmdir($e) or refuse("rmdir $p: $!");
  }
}
for my $d (@dirs) {
  refuse("$d is not an absolute path") unless $d =~ m{\A/};
  my @st = lstat($d);
  refuse("lstat $d: $!") unless @st;
  refuse("$d is not a directory") unless S_ISDIR($st[2]);
  chdir($d) or refuse("chdir $d: $!");
  empty_here($d);
  chdir('/') or refuse("chdir /: $!");
}
{ no warnings 'exec'; exec { $ARGV[0] } @ARGV; }
refuse("exec $ARGV[0]: $!");
`;

const RESTAGE_DIR_RE = new RegExp(`^${SESSION_RESTAGE_ROOT}/[a-z0-9][-a-z0-9]*$`);

/**
 * The restage exec's argv (the header; k8s-transfer.ts stageStream's `command` hook, the exec into `-c watch`): `unpack`
 * must be treeUnpackArgv of restaged directories alone (restageMountPath's), each of which SESSION_RESTAGE_SCRIPT
 * empties before it execs the unpacker into them. No PID 1 is signalled. Anything else is a SandboxError.
 */
export function restageCommand(unpack: readonly string[]): string[] {
  const dirs = unpack.slice(4);
  for (const d of dirs) {
    if (!RESTAGE_DIR_RE.test(d)) throw new SandboxError(`a restage writes only ${SESSION_RESTAGE_ROOT}/<volume>, not ${JSON.stringify(d)}`);
  }
  let own: string[];
  try {
    own = treeUnpackArgv(dirs);
  } catch (err) {
    throw new SandboxError(`a restage wraps the tree unpacker over its directories: ${(err as Error).message}`, { cause: err });
  }
  if (own.length !== unpack.length || own.some((a, i) => a !== unpack[i])) throw new SandboxError('a restage wraps the tree unpacker (treeUnpackArgv) and nothing else');
  return ['perl', '-e', SESSION_RESTAGE_SCRIPT, '--', String(dirs.length), ...dirs, ...unpack];
}

interface VolumeMountShape {
  name: string;
  mountPath: string;
  readOnly?: boolean;
}

interface ContainerShape {
  name: string;
  image: string;
  command: string[];
  volumeMounts?: VolumeMountShape[];
  [field: string]: unknown;
}

interface PodSpecShape {
  initContainers?: ContainerShape[];
  containers: ContainerShape[];
  volumes?: Array<Record<string, unknown>>;
  [field: string]: unknown;
}

/**
 * A session's pod (the header), pure: sandboxPodSpec(spec, opts)'s split program pod for the session's template, with
 * `main`'s command SESSION_PID1_COMMAND, `stage` holding /bot alone, and `watch` holding each read-only mount's volume
 * read-write at restageMountPath besides each writable mount read-only (a `watch` of its own, k8s.ts watchContainer, when
 * the template has no writable mount); everything else, labels and annotations included, a program pod's. A template checkSessionTemplate
 * refuses, a timed pod or one with a policy of its own is a SandboxError, before anything is made.
 */
export function sessionPodSpec(spec: SandboxSpec, opts: SandboxPodOptions): K8sObject {
  checkSessionTemplate(spec);
  if (opts.timed === true) throw new SandboxError("a session pod is never timed: a timing heat's runs are a pod each");
  if (opts.ownPolicy === true) throw new SandboxError('a session pod has no policy of its own: it has no network');
  const pod = sandboxPodSpec(spec, opts);
  const podSpec = pod.spec as PodSpecShape;
  const main = podSpec.containers.find((c) => c.name === CONTAINER);
  const stage = podSpec.initContainers?.find((c) => c.name === STAGE_CONTAINER);
  if (main === undefined || stage === undefined) throw new SandboxError(`pod ${opts.name}: a program pod with no ${main === undefined ? CONTAINER : STAGE_CONTAINER} is no session pod`);
  main.command = [...SESSION_PID1_COMMAND];
  stage.volumeMounts = (stage.volumeMounts ?? []).filter((m) => m.mountPath === SESSION_CODE_DIR);
  const restaged: VolumeMountShape[] = checkSandboxMounts(spec.mounts)
    .filter((m) => m.readOnly)
    .map((m) => ({ name: mountVolumeName(m.at), mountPath: restageMountPath(m.at), readOnly: false }));
  if (restaged.length > 0) {
    let watch = podSpec.containers.find((c) => c.name === WATCH_CONTAINER);
    if (watch === undefined) {
      // A program pod's `watch` (k8s.ts watchContainer), mounting nothing yet.
      watch = watchContainer(main.image, []) as unknown as ContainerShape;
      podSpec.containers.push(watch);
    }
    watch.volumeMounts = [...(watch.volumeMounts ?? []), ...restaged];
  }
  checkPodMounts(
    opts.name,
    [...(podSpec.initContainers ?? []), ...podSpec.containers].flatMap((c) => c.volumeMounts ?? []),
    podSpec.volumes ?? [],
  );
  return pod;
}

// ---------------------------------------------------------------- the session runtime

/**
 * How much a reset exec may take: a kubectl call's budget (KUBECTL_TIMEOUT_MS's 60 s) twice, since its wipe walks
 * whatever a case left under /output, /tmp and /dev/shm, file by file under gVisor. It waits on nothing else: its kill
 * rounds are at most SESSION_RESET_ROUNDS × SESSION_RESET_PAUSE_MS (1 s).
 */
export const SESSION_RESET_TIMEOUT_MS = 120_000;
/** The tail of a session's label (grader/program.ts executePerCase opens it as `<label>-cases`), kept when the label is cut to fit. */
export const SESSION_LABEL_TAIL = '-cases';
/** The longest sandbox label (docker.ts checkSandboxLabel: what a pod name carries). */
const SANDBOX_LABEL_MAX = 41;

/**
 * The label a session's pods are named for (podName): `label` when it is a sandbox label (docker.ts checkSandboxLabel),
 * else its stem (less a SESSION_LABEL_TAIL) cut so that it and the tail fit SANDBOX_LABEL_MAX, trailing dashes dropped,
 * then the tail: a session label longer than a pod name takes (`grade-dev-<window key>-<n>-cases`) never fails a grade
 * whose per-case labels (`<label>-c<i>`) fit. A label with anything a sandbox label may not hold is a SandboxError, as
 * its per-case pods' would be.
 */
export function sessionPodLabel(label: string): string {
  if (typeof label !== 'string') throw new SandboxError(`a session's label must be a string, not ${JSON.stringify(label)}`);
  try {
    return checkSandboxLabel(label);
  } catch {
    const stem = label.endsWith(SESSION_LABEL_TAIL) ? label.slice(0, -SESSION_LABEL_TAIL.length) : label;
    return checkSandboxLabel(`${stem.slice(0, SANDBOX_LABEL_MAX - SESSION_LABEL_TAIL.length).replace(/-+$/, '')}${SESSION_LABEL_TAIL}`);
  }
}

/** What a K8sSession is given of its sandbox (k8s.ts K8sSandbox #sessionHost). */
export interface K8sSessionHost {
  readonly ctx: K8sContext;
  readonly placement: PodPlacement;
  readonly images: ImageTableT;
  readonly runtimeClass: string | null;
  /** The sandbox itself: kind, imageDigest, preflight, isDriverFailure, removeTree, and a degraded session's spawns. */
  readonly sandbox: Sandbox;
  /** The drawn placement of a pod about to be made (k8s.ts's header: Room on the node), or null for none. */
  prefer(pod: string): Promise<NodePreference | null>;
  /** A session pod's env Secret (k8s.ts sandboxEnvSecret, a program pod's marks), or null when the spec has nothing for one. */
  envSecret(spec: SandboxSpec, pod: string): K8sObject | null;
  /** One run's process, a K8sProcess in its session mode (k8s.ts Launch.session), its pod readied by `session`. */
  spawnRun(run: { name: string; mounts: readonly SandboxMount[]; pids: number; session: SessionLaunch }): K8sProcess;
}

/** A session's pod (K8sSession), from its boot until it is spent or the session closed. */
interface SessionPod {
  readonly name: string;
  /** What its boot made (`pod/<name>`, its Secret): deleted once. */
  readonly refs: readonly string[];
  /** The case launcher runs in it (the launcher check): its cases run under SESSION_EXEC_WRAPPER. False: it runs the one case it was booted for, then goes. */
  readonly isolated: boolean;
  /** A case's program was started in it: the next run's reset comes first. */
  used: boolean;
  /** Its delete was sent. */
  retired: boolean;
}

/** One run's hold on its session pod: the pod it was readied in (prepare), until it is settled. */
interface RunHold {
  pod: SessionPod | null;
}

/** Why the pod could not take a run (#reset, #restage): spent (another pod may), or the run's own driver failure. */
type PodTrouble = { spent: true; why: string } | { spent: false; exit: SandboxExit };

/**
 * A case session on the k8s driver (the header; types.ts SandboxSession): the runs of one per-file program/v1 execution,
 * one after another in one session pod. Opened by K8sSandbox.sessions.open: a template checkSessionTemplate refuses, a
 * label no pod name can carry, or a pod sessionPodSpec refuses is a SandboxError here, before anything is made. Nothing
 * reaches the cluster until the first spawn.
 */
export class K8sSession implements SandboxSession {
  readonly kind = 'k8s' as const;
  readonly #host: K8sSessionHost;
  readonly #template: SandboxSpec;
  /** What its pods are named for (sessionPodLabel). */
  readonly #label: string;
  readonly #image: string;
  readonly #digest: string;
  /** The wrapper's process cap (a fresh pod's: the run's pids and POD_OWN_TASKS; 0 under no RuntimeClass). */
  readonly #pids: number;
  /** The program a run's wrapper starts, under the case launcher or alone. */
  readonly #program: readonly string[];
  /** The template's writable mounts' volume names (readPodVerdict's evictions). */
  readonly #writable: readonly string[];
  #pod: SessionPod | null = null;
  /** The name the next boot makes its pod by, minted by a spawn with no pod (the run's pod until it is readied). */
  #nextName: string | null = null;
  #live: SandboxProcess | null = null;
  /** The launcher check failed: every spawn from here is the sandbox's own program pod. */
  #degraded = false;
  #warned = false;
  #closed = false;
  #closing: Promise<void> | null = null;
  /** Deletes sent and not yet answered: a boot waits for them, close() too. */
  readonly #retiring = new Set<Promise<void>>();

  constructor(host: K8sSessionHost, template: SandboxSpec) {
    checkSessionTemplate(template);
    this.#host = host;
    this.#template = template;
    this.#label = sessionPodLabel(template.label);
    const entry = imageFor(template.runtime, host.images);
    this.#image = entry.image;
    this.#digest = template.imageDigest ?? entry.digest;
    // Built now so a template the pod refuses throws here, as a spawn's does; built again as each pod is made.
    sessionPodSpec(template, this.#podOptions(podName(this.#label), null));
    this.#pids = host.runtimeClass === null ? 0 : Number(positiveInt(template.limits.pids, 'pids')) + POD_OWN_TASKS;
    this.#program = Object.freeze([...RUNTIME_COMMANDS[template.runtime], `/bot/${scriptOf(template)}`]);
    this.#writable = Object.freeze(
      checkSandboxMounts(template.mounts)
        .filter((m) => !m.readOnly)
        .map((m) => mountVolumeName(m.at)),
    );
  }

  imageDigest(runtime: Runtime): string | null {
    return this.#host.sandbox.imageDigest(runtime);
  }

  preflight(runtime: Runtime, imageDigest?: string | null): Promise<void> {
    return this.#host.sandbox.preflight(runtime, imageDigest);
  }

  isDriverFailure(exit: SandboxExit): boolean {
    return this.#host.sandbox.isDriverFailure(exit);
  }

  removeTree(dir: string): Promise<void> {
    return this.#host.sandbox.removeTree(dir);
  }

  /**
   * One run (the header): its spec checkSessionRun's, its mounts under the data root, each writable mount's host
   * directory empty, no run live and the session open, else a SandboxError before anything starts. A K8sProcess in its
   * session mode, readied in the session's pod; a degraded session's, the sandbox's own program pod.
   */
  spawn(spec: SandboxSpec): SandboxProcess {
    if (this.#closed) throw new SandboxError(`session ${this.#label} is closed: it runs nothing more`);
    if (this.#live !== null) throw new SandboxError(`session ${this.#label} runs one program at a time, and one is live`);
    checkSessionRun(this.#template, spec);
    const mounts = checkSandboxMounts(spec.mounts);
    for (const m of mounts) checkUnderDataRoot(this.#host.placement.dataRoot, m.host);
    for (const m of mounts) {
      if (m.readOnly) continue;
      let names: string[];
      try {
        names = readdirSync(m.host);
      } catch (err) {
        throw new SandboxError(`session ${this.#label}: ${m.host} (for ${m.at}) does not read: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
      }
      // `watch` holds a writable mount read-only: no seed file of the host's could reach `main`, so none may be there.
      if (names.length > 0) throw new SandboxError(`session ${this.#label}: a session's run starts with its writable mounts empty, and ${m.host} (for ${m.at}) holds ${names.length} entries`);
    }
    let proc: SandboxProcess;
    if (this.#degraded) proc = this.#host.sandbox.spawn(spec);
    else {
      const hold: RunHold = { pod: null };
      proc = this.#host.spawnRun({
        name: this.#pod?.name ?? (this.#nextName ??= podName(this.#label)),
        mounts,
        pids: this.#pids,
        session: {
          prepare: (signal) => this.#prepare(hold, mounts, signal),
          settle: (end) => this.#settle(hold, end),
        },
      });
    }
    this.#live = proc;
    void proc.exited.finally(() => {
      if (this.#live === proc) this.#live = null;
    });
    return proc;
  }

  /** The live run's writable mount `dir` (its K8sProcess.meter): a SandboxError when no live run mounts it writable. */
  meterTree(dir: string, opts: TreeMeterOptions): TreeMeter {
    checkHostPath(dir);
    const live = this.#live;
    if (live instanceof K8sProcess && !live.programOver && live.writableAt(dir) !== null) return live.meter(dir, opts);
    throw new SandboxError(`no live run of session ${this.#label} mounts ${dir} writable: its meter runs in the watch container of the run's pod, asked for right after its spawn`);
  }

  /** Kill a run still live, delete the pod once (and any spent one not yet answered); never rejects. */
  close(): Promise<void> {
    this.#closing ??= (async () => {
      this.#closed = true;
      const live = this.#live;
      if (live !== null) await live.kill();
      const pod = this.#pod;
      if (pod !== null) this.#retire(pod);
      await Promise.all([...this.#retiring]);
    })().catch(() => undefined);
    return this.#closing;
  }

  #podOptions(name: string, prefer: NodePreference | null): SandboxPodOptions {
    return {
      ...this.#host.placement,
      name,
      image: this.#image,
      digest: this.#digest,
      hostAliases: [],
      owner: null,
      ...(prefer === null ? {} : { prefer }),
    };
  }

  /** SessionLaunch.prepare: never rejects (a throw is the run's driver failure). */
  async #prepare(hold: RunHold, mounts: readonly SandboxMount[], signal: AbortSignal): Promise<SessionPrepared> {
    try {
      return await this.#ready(hold, mounts, signal);
    } catch (err) {
      return {
        ok: false,
        exit: failure(`session ${this.#label}: ${err instanceof Error ? err.message : String(err)}`),
      };
    }
  }

  /**
   * The pod for one run (the header): booted when there is none (no reset then), else reset when a case ran in it; its
   * read-only mounts restaged. A pod the reset or the restage found spent is deleted and a fresh one booted for this same
   * run, once: a fresh pod's restage that fails is the run's failure.
   */
  async #ready(hold: RunHold, mounts: readonly SandboxMount[], signal: AbortSignal): Promise<SessionPrepared> {
    let fresh = false;
    for (;;) {
      if (signal.aborted) return { ok: false, exit: killedExit() };
      if (this.#closed)
        return {
          ok: false,
          exit: failure(`session ${this.#label} was closed before its run started`),
        };
      let pod = this.#pod;
      if (pod === null) {
        const booted = await this.#boot(signal);
        if (!booted.ok) return { ok: false, exit: booted.exit, noRoom: booted.noRoom };
        pod = booted.pod;
        fresh = true;
      } else if (pod.used) {
        const trouble = await this.#reset(pod, signal);
        if (trouble !== null) {
          this.#retire(pod);
          if (signal.aborted) return { ok: false, exit: killedExit() };
          if (trouble.spent) continue;
          return { ok: false, exit: trouble.exit };
        }
      }
      const trouble = await this.#restage(pod, mounts, signal);
      if (trouble !== null) {
        this.#retire(pod);
        if (signal.aborted) return { ok: false, exit: killedExit() };
        if (trouble.spent && !fresh) continue;
        return {
          ok: false,
          exit: trouble.spent ? failure(`pod ${pod.name}, fresh: ${trouble.why}`) : trouble.exit,
        };
      }
      hold.pod = pod;
      return pod.isolated
        ? {
            ok: true,
            pod: pod.name,
            wrapper: SESSION_EXEC_WRAPPER,
            argv: caseLauncherArgv(this.#program),
            report: CASE_LAUNCHER_OK,
          }
        : {
            ok: true,
            pod: pod.name,
            wrapper: EXEC_WRAPPER,
            argv: [...this.#program],
            report: null,
          };
    }
  }

  /**
   * A fresh session pod (the header's boot): what a spent pod's delete was waiting on answered, the pod (sessionPodSpec)
   * and its Secret made, /bot staged, Ready (bootPod), then the launcher check. Whatever fails, what it made is deleted.
   */
  async #boot(signal: AbortSignal): Promise<{ ok: true; pod: SessionPod } | { ok: false; exit: SandboxExit; noRoom: string | null }> {
    await Promise.all([...this.#retiring]);
    const ctx = this.#host.ctx;
    const name = this.#nextName ?? podName(this.#label);
    this.#nextName = null;
    let prefer: NodePreference | null;
    try {
      prefer = await this.#host.prefer(name);
    } catch {
      prefer = null;
    }
    const spec = sessionPodSpec(this.#template, this.#podOptions(name, prefer));
    const secret = this.#host.envSecret(this.#template, name);
    const refs = [`pod/${name}`, ...(secret === null ? [] : [`secret/${secret.metadata.name}`])];
    const booted = await bootPod(ctx, {
      name,
      objects: [spec],
      secret,
      trees: [{ mount: SESSION_CODE_DIR, dir: this.#template.codeDir }],
      signal,
      killed: () => signal.aborted,
    });
    if (!booted.ok) {
      await deleteObjects(ctx, refs);
      return booted;
    }
    const unchecked = await this.#launcherFails(name, signal);
    if (signal.aborted) {
      await deleteObjects(ctx, refs);
      return { ok: false, exit: killedExit(), noRoom: null };
    }
    if (unchecked !== null) {
      this.#degraded = true;
      if (!this.#warned) {
        this.#warned = true;
        ctx.warn(`k8s sandbox: session ${this.#label}: the case launcher does not run in pod ${name}, or gives its case no loopback (${unchecked}): its first case runs there alone, and every later case in a pod of its own`);
      }
    }
    const pod: SessionPod = {
      name,
      refs,
      isolated: unchecked === null,
      used: false,
      retired: false,
    };
    this.#pod = pod;
    return { ok: true, pod };
  }

  /**
   * The launcher check (the header): the loopback probe (CASE_LOOPBACK_PROBE) under SESSION_EXEC_WRAPPER and the case
   * launcher, in `main`, so both the launcher and a loopback inside the case's own network namespace are proven. Null
   * when its stdout is the start line, `RS<nonce>iok` and the sentinel 0, exactly, and the exec exited 0; else what it
   * said (its stdout, the exec's end, and the first line of its stderr, where the launcher and the probe say why).
   */
  async #launcherFails(pod: string, signal: AbortSignal): Promise<string | null> {
    const nonce = randomBytes(16).toString('hex');
    const r = await kubectl(this.#host.ctx, ['exec', '-i', pod, '-c', CONTAINER, '--', '/bin/sh', '-c', SESSION_EXEC_WRAPPER, 'sh', String(this.#pids), ...caseLauncherArgv(CASE_LOOPBACK_PROBE)], {
      input: `${nonce}\n`,
      signal,
      timeoutMs: KUBECTL_TIMEOUT_MS,
    });
    const head = `${SENTINEL_MARK}${nonce}`;
    if (r.code === 0 && r.error === undefined && r.stdout === `${head}\n${head}${SESSION_REPORT_TAG}${CASE_LAUNCHER_OK}\n${head}0\n`) return null;
    const hide = (s: string): string => JSON.stringify(s.split(nonce).join('<nonce>').slice(0, 200));
    const said = r.stderr
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '' && !l.startsWith('Warning:'));
    const end = r.error ?? (r.code === null ? 'no answer' : `exit ${r.code}`);
    return `its check printed ${hide(r.stdout)}, ${end}${said === undefined ? '' : `, stderr ${hide(said)}`}`;
  }

  /**
   * The reset before a case (the header): null once it says clean. Spent when it says dirty, is cut off, or fails in a
   * pod readPodVerdict finds out of memory, evicted for its own volume, or with `main` ended by its own program; any
   * other failure the run's driver failure.
   */
  async #reset(pod: SessionPod, signal: AbortSignal): Promise<PodTrouble | null> {
    const ctx = this.#host.ctx;
    const nonce = randomBytes(16).toString('hex');
    const r = await kubectl(ctx, ['exec', '-i', pod.name, '-c', CONTAINER, '--', ...sessionResetArgv(this.#template)], { input: `${nonce}\n`, signal, timeoutMs: SESSION_RESET_TIMEOUT_MS });
    if (signal.aborted) return { spent: true, why: 'the reset was cut off by the kill' };
    const verdict = r.error === undefined ? parseSessionReset(r.stdout, nonce) : null;
    if (verdict !== null) {
      if (verdict.clean && r.code === 0) return null;
      return {
        spent: true,
        why: verdict.clean ? `the reset said clean but exited ${r.code}` : `the reset found it dirty: ${verdict.why}`,
      };
    }
    if (r.error !== undefined) return { spent: true, why: `the reset was cut off: ${r.error}` };
    const read = await readPodVerdict(ctx, pod.name, {
      writable: this.#writable,
      ownKill: true,
    });
    if (read.killed)
      return {
        spent: true,
        why: `the reset failed (${why(r)}) in a pod ended by ${read.kill}`,
      };
    return {
      spent: false,
      exit: failure(`pod ${pod.name}: the reset between two cases failed (${why(r)}); ${read.said}`),
    };
  }

  /**
   * The restage of a run's read-only mounts (the header; stageStream into `watch`, restageCommand): null once acked, or
   * when it has none. A failure in a pod readPodVerdict finds out of memory, evicted for its own volume, or with `main`
   * ended by its own program spends it; any other is the run's driver failure.
   */
  async #restage(pod: SessionPod, mounts: readonly SandboxMount[], signal: AbortSignal): Promise<PodTrouble | null> {
    const trees = mounts.filter((m) => m.readOnly).map((m) => ({ mount: restageMountPath(m.at), dir: m.host }));
    if (trees.length === 0) return null;
    const ctx = this.#host.ctx;
    try {
      await stageStream(ctx, {
        pod: pod.name,
        container: WATCH_CONTAINER,
        trees,
        signal,
        command: (unpack) => restageCommand(unpack),
      });
      return null;
    } catch (err) {
      if (signal.aborted) return { spent: true, why: 'the restage was cut off by the kill' };
      const lost = err instanceof Error ? err.message : String(err);
      const read = await readPodVerdict(ctx, pod.name, {
        writable: this.#writable,
        ownKill: true,
      });
      if (read.killed) return { spent: true, why: `${lost}, in a pod ended by ${read.kill}` };
      return { spent: false, exit: failure(`${lost}; ${read.said}`) };
    }
  }

  /**
   * SessionLaunch.settle: a run's end. Its pod is spent (deleted; the next spawn boots a fresh one) when the pod ended it
   * (podKill), its end is the driver's failure, its kill failed, or the pod has no launcher (it ran its one case); kept
   * otherwise, used once the run's exec started.
   */
  #settle(hold: RunHold, end: SessionRunEnd): void {
    const pod = hold.pod;
    hold.pod = null;
    if (pod === null || this.#pod !== pod) return;
    const driverFailed = end.exit.code === K8S_DRIVER_FAILURE && end.exit.error !== undefined;
    if (!pod.isolated || end.podKill !== null || end.killFailed || driverFailed) {
      this.#retire(pod);
      return;
    }
    if (end.execStarted) pod.used = true;
  }

  /** The pod given up: no run is readied in it again, and its delete is sent once (deleteObjects warns of one that never took). */
  #retire(pod: SessionPod): void {
    if (this.#pod === pod) this.#pod = null;
    if (pod.retired) return;
    pod.retired = true;
    const sent: Promise<void> = deleteObjects(this.#host.ctx, pod.refs)
      .catch(() => undefined)
      .finally(() => this.#retiring.delete(sent));
    this.#retiring.add(sent);
  }
}
