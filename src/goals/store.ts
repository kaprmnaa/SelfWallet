import { useSyncExternalStore } from "react";
import { load, save } from "../lib/storage";
import { mergeGoal } from "./logic";
import { mergeTimeLock } from "./timelock";
import type { Goal, Snapshot, TimeLock } from "./types";

// Penyimpanan LOKAL-DULU (localStorage): goal dan snapshot adalah metadata non-rahasia.
// Sinkron Supabase bersifat opsional dan hanya menyalin data ini.
const isGoal = (g: unknown): g is Goal => {
  const o = g as Goal;
  return (
    !!o &&
    typeof o.id === "string" &&
    typeof o.ref === "string" &&
    typeof o.name === "string" &&
    typeof o.chainId === "number" &&
    (o.unit === "usd" || o.unit === "native") &&
    Number.isFinite(o.start) &&
    Number.isFinite(o.target) &&
    (o.status === "active" || o.status === "achieved" || o.status === "cancelled") &&
    typeof o.createdAt === "number" &&
    typeof o.updatedAt === "number" &&
    (o.mode === undefined || o.mode === "lock" || o.mode === "unlock") &&
    (o.funded === undefined || (Number.isFinite(o.funded) && o.funded > 0))
  );
};
const isSnap = (s: unknown): s is Snapshot => {
  const o = s as Snapshot;
  return !!o && typeof o.goalId === "string" && typeof o.ts === "number" && Number.isFinite(o.value);
};

const isTimeLock = (t: unknown): t is TimeLock => {
  const o = t as TimeLock;
  return !!o && typeof o.ref === "string" && Number.isFinite(o.until) && typeof o.createdAt === "number" && typeof o.updatedAt === "number";
};

const rawGoals = load<unknown>("goals", []);
const rawLocks = load<unknown>("timelocks", []);
const rawSnaps = load<unknown>("goal-snaps", []);
let goals: Goal[] = Array.isArray(rawGoals) ? rawGoals.filter(isGoal) : [];
let snaps: Snapshot[] = Array.isArray(rawSnaps) ? rawSnaps.filter(isSnap) : [];
let timeLocks: TimeLock[] = Array.isArray(rawLocks) ? rawLocks.filter(isTimeLock) : [];

const listeners = new Set<() => void>();
type Change = { kind: "goal"; item: Goal } | { kind: "snapshot"; item: Snapshot } | { kind: "timelock"; item: TimeLock };
const changeHooks = new Set<(c: Change) => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const getGoals = () => goals;
export const getSnapshots = () => snaps;
export const getTimeLocks = () => timeLocks;
export const useTimeLocks = () => useSyncExternalStore(subscribe, getTimeLocks, getTimeLocks);
export const useGoals = () => useSyncExternalStore(subscribe, getGoals, getGoals);
export const useAllSnapshots = () => useSyncExternalStore(subscribe, getSnapshots, getSnapshots);

/** Dipakai mesin sinkron: dipanggil untuk setiap perubahan LOKAL yang perlu didorong ke Supabase. */
export function onLocalChange(cb: (c: Change) => void) {
  changeHooks.add(cb);
  return () => changeHooks.delete(cb);
}

/** push = false untuk perubahan lokal-saja (mis. penghitung hits) yang tidak perlu disinkronkan. */
export function upsertGoal(g: Goal, push = true) {
  const i = goals.findIndex((x) => x.id === g.id);
  goals = i >= 0 ? goals.map((x, k) => (k === i ? g : x)) : [g, ...goals];
  save("goals", goals);
  emit();
  if (push) changeHooks.forEach((h) => h({ kind: "goal", item: g }));
}

export function mergeRemoteGoals(remote: Goal[]) {
  let changed = false;
  for (const r of remote) {
    const local = goals.find((g) => g.id === r.id);
    const merged = mergeGoal(local, r);
    if (merged !== local) {
      goals = local ? goals.map((g) => (g.id === r.id ? merged : g)) : [merged, ...goals];
      changed = true;
    }
  }
  if (changed) {
    save("goals", goals);
    emit();
  }
}

const MAX_PER_GOAL = 400;

function trim(list: Snapshot[]): Snapshot[] {
  const count = new Map<string, number>();
  const out: Snapshot[] = [];
  for (const s of [...list].sort((a, b) => b.ts - a.ts)) {
    const n = (count.get(s.goalId) ?? 0) + 1;
    count.set(s.goalId, n);
    if (n <= MAX_PER_GOAL) out.push(s);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export function addSnapshot(s: Snapshot, push = true) {
  snaps = trim([...snaps, s]);
  save("goal-snaps", snaps);
  emit();
  if (push) changeHooks.forEach((h) => h({ kind: "snapshot", item: s }));
}

export function mergeRemoteSnapshots(remote: Snapshot[]) {
  const seen = new Set(snaps.map((s) => `${s.goalId}:${s.ts}`));
  const fresh = remote.filter((s) => !seen.has(`${s.goalId}:${s.ts}`));
  if (fresh.length === 0) return;
  snaps = trim([...snaps, ...fresh]);
  save("goal-snaps", snaps);
  emit();
}

/** Pasang/perpanjang kunci waktu. Pemanggil bertanggung jawab memakai planTimeLock (aturan tidak boleh memendek). */
export function upsertTimeLock(l: TimeLock, push = true) {
  const i = timeLocks.findIndex((x) => x.ref === l.ref);
  timeLocks = i >= 0 ? timeLocks.map((x, k) => (k === i ? l : x)) : [l, ...timeLocks];
  save("timelocks", timeLocks);
  emit();
  if (push) changeHooks.forEach((h) => h({ kind: "timelock", item: l }));
}

export function mergeRemoteTimeLocks(remote: TimeLock[]) {
  let changed = false;
  for (const r of remote) {
    const local = timeLocks.find((x) => x.ref === r.ref);
    const merged = mergeTimeLock(local, r);
    if (merged !== local) {
      timeLocks = local ? timeLocks.map((x) => (x.ref === r.ref ? merged : x)) : [merged, ...timeLocks];
      changed = true;
    }
  }
  if (changed) {
    save("timelocks", timeLocks);
    emit();
  }
}
