import type { TimeLock } from "./types";

export type TimeUnit = "minute" | "hour" | "day";
export const UNIT_MS: Record<TimeUnit, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };
export const UNIT_LABEL: Record<TimeUnit, string> = { minute: "Menit", hour: "Jam", day: "Hari" };
export const MIN_LOCK_MS = 60_000;
export const MAX_LOCK_MS = 365 * 86_400_000;

export function durationMs(value: number, unit: TimeUnit): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Durasi harus lebih dari nol.");
  const ms = Math.round(value * UNIT_MS[unit]);
  if (ms < MIN_LOCK_MS) throw new Error("Durasi minimal 1 menit.");
  if (ms > MAX_LOCK_MS) throw new Error("Durasi maksimal 365 hari.");
  return ms;
}

/** Kunci waktu yang masih berlaku untuk wallet ini (null = tidak ada atau sudah habis). */
export function activeTimeLock(locks: TimeLock[], ref: string, now = Date.now()): TimeLock | null {
  const l = locks.find((x) => x.ref === ref);
  return l && l.until > now ? l : null;
}

/**
 * Pasang/perpanjang kunci: berakhir pada (sekarang + durasi). Selama kunci lama masih aktif, kunci baru
 * tidak boleh berakhir lebih awal (tidak bisa diperpendek atau dibatalkan).
 */
export function planTimeLock(existing: TimeLock | undefined, ref: string, value: number, unit: TimeUnit, now = Date.now()): TimeLock {
  const until = now + durationMs(value, unit);
  if (existing && existing.until > now && until < existing.until) {
    throw new Error(`Kunci waktu tidak bisa diperpendek. Kunci saat ini masih ${formatRemaining(existing.until - now)}.`);
  }
  return { ref, until, createdAt: existing && existing.until > now ? existing.createdAt : now, updatedAt: now };
}

/** Gabungkan lokal dan jarak jauh: yang berakhir paling akhir menang (kunci tidak pernah memendek). */
export function mergeTimeLock(local: TimeLock | undefined, remote: TimeLock): TimeLock {
  if (!local) return remote;
  return remote.until > local.until ? remote : local;
}

export function formatRemaining(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} hari`);
  if (h) parts.push(`${h} jam`);
  if (mm || parts.length === 0) parts.push(`${mm} menit`);
  return parts.join(" ");
}

export function timeLockMessage(l: Pick<TimeLock, "until">, now = Date.now()): string {
  return `Semua penarikan (kirim dan swap, semua jaringan) dikunci oleh kunci waktu sampai ${new Date(l.until).toLocaleString("id-ID")} (sisa ${formatRemaining(l.until - now)}).`;
}
