import type { Goal, GoalStatus, GoalUnit, Snapshot } from "./types";

/** Target harus terlihat tercapai pada 2 evaluasi berturut-turut (menahan lonjakan harga/saldo sesaat). */
export const REQUIRED_HITS = 2;
/** Masa tunggu pembatalan goal (komitmen: tidak bisa dibatalkan impulsif). */
export const CANCEL_COOLDOWN_MS = 24 * 3600 * 1000;
export const SNAPSHOT_MIN_INTERVAL_MS = 30 * 60 * 1000;

/** 0..1. "10 to 100": mulai 10, target 100 -> progres dihitung dari 10, bukan dari 0. */
export function progress(g: Pick<Goal, "start" | "target">, value: number): number {
  const span = g.target - g.start;
  if (!(span > 0)) return value >= g.target ? 1 : 0;
  return Math.min(1, Math.max(0, (value - g.start) / span));
}

export const reached = (g: Pick<Goal, "target">, value: number) => value >= g.target;

/** Murni. Status "achieved" bersifat tetap: turun lagi di bawah target tidak mengunci kembali. */
export function evaluate(g: Goal, value: number, now = Date.now()): Goal {
  if (g.status !== "active") return g;
  if (!reached(g, value)) return (g.hits ?? 0) === 0 ? g : { ...g, hits: 0 };
  const hits = (g.hits ?? 0) + 1;
  if (hits >= REQUIRED_HITS) {
    return { ...g, status: "achieved", achievedAt: now, updatedAt: now, hits, cancelRequestedAt: undefined };
  }
  return { ...g, hits };
}

export function cancelInfo(g: Goal, now = Date.now()): { requested: boolean; readyAt?: number; ready?: boolean } {
  if (g.status !== "active" || !g.cancelRequestedAt) return { requested: false };
  const readyAt = g.cancelRequestedAt + CANCEL_COOLDOWN_MS;
  return { requested: true, readyAt, ready: now >= readyAt };
}

export function requestCancel(g: Goal, now = Date.now()): Goal {
  if (g.status !== "active") throw new Error("Hanya goal aktif yang bisa dibatalkan.");
  if (g.cancelRequestedAt) return g;
  return { ...g, cancelRequestedAt: now, updatedAt: now };
}

export function revokeCancel(g: Goal, now = Date.now()): Goal {
  if (g.status !== "active" || !g.cancelRequestedAt) return g;
  return { ...g, cancelRequestedAt: undefined, updatedAt: now };
}

export function confirmCancel(g: Goal, now = Date.now()): Goal {
  const info = cancelInfo(g, now);
  if (!info.requested) throw new Error("Ajukan pembatalan dulu.");
  if (!info.ready) throw new Error("Masa tunggu pembatalan belum selesai.");
  return { ...g, status: "cancelled", cancelRequestedAt: undefined, updatedAt: now };
}

/** Goal aktif yang mengunci penarikan untuk wallet + jaringan ini (null = tidak ada). */
export function blockingGoal(goals: Goal[], ref: string, chainId: number): Goal | null {
  return goals.find((g) => g.status === "active" && g.ref === ref && g.chainId === chainId) ?? null;
}

export function lockMessage(g: Pick<Goal, "name">): string {
  return `Penarikan dikunci oleh goal "${g.name}" yang belum tercapai. Selesaikan goal, atau ajukan pembatalan (masa tunggu 24 jam) di tab Goal.`;
}

export function shouldSnapshot(last: Pick<Snapshot, "ts" | "value"> | undefined, value: number, target: number, now = Date.now()): boolean {
  if (!last) return true;
  if (now - last.ts >= SNAPSHOT_MIN_INTERVAL_MS) return true;
  return Math.abs(value - last.value) >= 0.01 * target;
}

export function validateNewGoal(i: {
  name: string;
  unit: GoalUnit;
  usdSupported: boolean;
  start: number;
  target: number;
}): string {
  const name = i.name.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 40) throw new Error("Nama goal harus 1 sampai 40 karakter.");
  if (i.unit === "usd" && !i.usdSupported) {
    throw new Error("Satuan USD hanya untuk jaringan mainnet bawaan yang punya harga. Pilih satuan koin native.");
  }
  if (!Number.isFinite(i.target) || i.target <= 0) throw new Error("Target harus lebih dari nol.");
  if (!Number.isFinite(i.start) || i.start < 0) throw new Error("Nilai awal tidak boleh negatif.");
  if (i.start >= i.target) throw new Error("Nilai awal harus lebih kecil dari target.");
  return name;
}

const isTerminal = (s: GoalStatus) => s !== "active";

/**
 * Gabungkan data lokal dan jarak jauh. Status akhir (achieved/cancelled) selalu menang atas "active",
 * agar goal tidak "hidup kembali" dan penarikan tidak terkunci ulang oleh perangkat lain yang tertinggal.
 */
export function mergeGoal(local: Goal | undefined, remote: Goal): Goal {
  if (!local) return remote;
  if (isTerminal(local.status) !== isTerminal(remote.status)) {
    return isTerminal(local.status) ? local : { ...remote, hits: local.hits };
  }
  return remote.updatedAt > local.updatedAt ? { ...remote, hits: local.hits } : local;
}
