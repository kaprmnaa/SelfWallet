import type { Account } from "../lib/vault";
import { blockingGoal, lockMessage } from "./logic";
import { walletRef } from "./ref";
import { getGoals } from "./store";
import type { Goal } from "./types";

/**
 * Penjaga penarikan. PENTING: ini komitmen di dalam aplikasi, BUKAN penguncian kriptografis.
 * Kunci privat tetap di tangan Anda, jadi wallet lain (atau salinan aplikasi ini tanpa data goal) tetap
 * bisa menarik dana. Gunanya: gesekan yang disengaja terhadap keputusan impulsif.
 */
export function lockedBy(account: Account, chainId: number): Goal | null {
  return blockingGoal(getGoals(), walletRef(account), chainId);
}

/** Dipanggil di setiap fungsi yang menandatangani transaksi keluar (kirim, swap, approval). */
export function assertNotLocked(account: Account, chainId: number) {
  const g = lockedBy(account, chainId);
  if (g) throw new Error(lockMessage(g));
}
