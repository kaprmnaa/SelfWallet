import type { Goal, GoalMode } from "./types";

/**
 * Logika murni pembagian dana jaringan ke goal, dan aturan "hanya dana yang tidak terkunci yang bisa ditarik".
 * Tanpa jaringan/React supaya mudah diuji.
 *
 * Contoh: saldo jaringan 728 USD. Goal "invest" (lock, dana 701) + goal "10 to 100" (unlock, dana 27):
 *   terkunci = 701, bisa ditarik = 728 - 701 = 27.
 */

export type Currency = "usd" | "native";

export type PoolMeta = {
  /** Total nilai aset jaringan dalam `currency`. */
  total: number;
  currency: Currency;
  /** Harga 1 koin native dalam USD (null jika tidak ada harga). Dipakai mengonversi goal berunit native ke USD. */
  nativeUsd: number | null;
};

export type Allocation = {
  total: number;
  currency: Currency;
  /** Total dana terkunci (dalam `currency`), sudah dibatasi oleh saldo nyata. */
  locked: number;
  /** total - locked: jumlah yang boleh ditarik (dalam `currency`). */
  free: number;
  /** Ada goal lock tanpa alokasi: seluruh saldo jaringan terkunci. */
  wholeLocked: boolean;
  /** Nilai tiap goal DALAM SATUAN GOAL itu sendiri (usd atau native). */
  values: Record<string, number>;
};

export const modeOf = (g: Pick<Goal, "mode">): GoalMode => (g.mode === "unlock" ? "unlock" : "lock");
export const isLockMode = (g: Pick<Goal, "mode">) => modeOf(g) === "lock";

/** Goal aktif wallet ini di jaringan ini. */
export const activeGoals = (goals: Goal[], ref: string, chainId: number) =>
  goals.filter((g) => g.status === "active" && g.ref === ref && g.chainId === chainId);

/** Goal aktif bermode lock wallet ini di jaringan ini. */
export const lockGoals = (goals: Goal[], ref: string, chainId: number) => activeGoals(goals, ref, chainId).filter(isLockMode);

/** Mata uang pool: USD jika ada goal berunit USD (butuh harga), selain itu koin native (tanpa harga). */
export function poolCurrency(goals: Pick<Goal, "unit">[]): Currency {
  return goals.some((g) => g.unit === "usd") ? "usd" : "native";
}

export function toPool(g: Pick<Goal, "unit">, v: number, pool: PoolMeta): number {
  if (g.unit === pool.currency) return v;
  // goal berunit native, pool USD
  if (pool.nativeUsd == null) throw new Error("Harga koin native tidak tersedia.");
  return v * pool.nativeUsd;
}
function fromPool(g: Pick<Goal, "unit">, v: number, pool: PoolMeta): number {
  if (g.unit === pool.currency) return v;
  if (pool.nativeUsd == null || pool.nativeUsd <= 0) throw new Error("Harga koin native tidak tersedia.");
  return v / pool.nativeUsd;
}

/**
 * Bagikan saldo jaringan ke goal aktif. Urutan klaim (yang lebih awal menang jika saldo kurang):
 * lock berdana -> lock tanpa dana (mengambil semua sisa) -> unlock berdana -> unlock tanpa dana.
 * Jadi dana yang dikunci selalu diprioritaskan, dan goal unlock hanya mendapat sisa yang memang bebas.
 */
export function allocate(goals: Goal[], pool: PoolMeta): Allocation {
  const active = goals.filter((g) => g.status === "active");
  const rank = (g: Goal) => (isLockMode(g) ? 0 : 2) + (g.funded === undefined ? 1 : 0);
  const sorted = [...active].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  let remaining = Math.max(0, pool.total);
  let locked = 0;
  let whole = false;
  const values: Record<string, number> = {};
  for (const g of sorted) {
    const want = g.funded === undefined ? remaining : toPool(g, g.funded, pool);
    const take = Math.min(Math.max(0, want), remaining);
    remaining -= take;
    values[g.id] = fromPool(g, take, pool);
    if (isLockMode(g)) {
      locked += take;
      if (g.funded === undefined) whole = true;
    }
  }
  const total = Math.max(0, pool.total);
  return { total, currency: pool.currency, locked, free: Math.max(0, total - locked), wholeLocked: whole, values };
}

export type Verdict = { ok: true } | { ok: false; reason: "whole" | "partial"; free: number; needed: number };

/** Boleh menarik `outValue` (dalam mata uang pool)? Toleransi kecil untuk galat pembulatan desimal. */
export function checkWithdrawal(a: Allocation, outValue: number): Verdict {
  if (a.wholeLocked) return { ok: false, reason: "whole", free: 0, needed: outValue };
  const eps = 1e-9 * Math.max(1, a.total);
  if (outValue <= a.free + eps) return { ok: true };
  return { ok: false, reason: "partial", free: a.free, needed: outValue };
}

/** Nilai transaksi keluar dalam mata uang pool. Token tanpa harga di pool USD = tidak bisa diverifikasi (galat). */
export type Outgoing = {
  /** Koin native yang keluar, termasuk biaya jaringan (satuan koin). */
  native?: number;
  token?: { address: string; amount: number };
};

export function outgoingValue(out: Outgoing, pool: PoolMeta, tokenUsd: Record<string, number>): number {
  let v = 0;
  const n = out.native ?? 0;
  if (n > 0) {
    if (pool.currency === "native") v += n;
    else {
      if (pool.nativeUsd == null) throw new Error("Harga koin native tidak tersedia.");
      v += n * pool.nativeUsd;
    }
  }
  const t = out.token;
  if (t && t.amount > 0 && pool.currency === "usd") {
    const p = tokenUsd[t.address.toLowerCase()];
    if (p === undefined) {
      throw new Error("Harga token ini tidak tersedia, jadi nilainya tidak bisa dibandingkan dengan dana yang terkunci. Coba lagi nanti.");
    }
    v += t.amount * p;
  }
  // Pool native: token tidak dihitung (pool hanya koin native), hanya biaya gas lewat `native`.
  return v;
}

/* ------------------------------------------------------------- pendanaan */

/**
 * Validasi pengubahan dana goal (murni). Mode lock: dana hanya boleh naik (menurunkannya = membuka dana lebih awal,
 * itu harus lewat pembatalan 24 jam). Goal lock tanpa alokasi tidak bisa diberi alokasi (itu juga melonggarkan kunci).
 */
export function setFunded(g: Goal, funded: number, now = Date.now()): Goal {
  if (g.status !== "active") throw new Error("Hanya goal aktif yang bisa diubah dananya.");
  if (!Number.isFinite(funded) || funded <= 0) throw new Error("Dana harus lebih dari nol.");
  if (isLockMode(g)) {
    if (g.funded === undefined) {
      throw new Error("Goal ini mengunci seluruh saldo jaringan, jadi dananya tidak bisa diatur. Ajukan pembatalan (24 jam) bila ingin mengubahnya.");
    }
    if (funded < g.funded) {
      throw new Error("Dana goal lock hanya bisa ditambah, tidak bisa dikurangi. Untuk membukanya lebih awal, ajukan pembatalan (24 jam).");
    }
  }
  return { ...g, funded, updatedAt: now };
}
