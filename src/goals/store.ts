import { useSyncExternalStore } from "react";
import { load, save } from "../lib/storage";
import { mergeGoal } from "./logic";
import type { Goal, Snapshot } from "./types";

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
    typeof o.updatedAt === "number"
  );
};
const isSnap = (s: unknown): s is Snapshot => {
  const o = s as Snapshot;
  return !!o && typeof o.goalId === "string" && typeof o.ts === "number" && Number.isFinite(o.value);
};

const rawGoals = load<unknown>("goals", []);
const rawSnaps = load<unknown>("goal-snaps", []);
let goals: Goal[] = Array.isArray(rawGoals) ? rawGoals.filter(isGoal) : [];
let snaps: Snapshot[] = Array.isArray(rawSnaps) ? rawSnaps.filter(isSnap) : [];

const listeners = new Set<() => void>();
type Change = { kind: "goal"; item: Goal } | { kind: "snapshot"; item: Snapshot };
const changeHooks = new Set<(c: Change) => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const getGoals = () => goals;
export const getSnapshots = () => snaps;
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
