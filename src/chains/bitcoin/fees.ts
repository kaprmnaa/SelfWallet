import type { ChainConfig } from "../../lib/chains";
import { feeEstimates } from "./esplora";

export type FeeTier = "fast" | "normal" | "slow";
export type FeeQuote = Record<FeeTier, number>; // sat/vB

export const TIER_LABEL: Record<FeeTier, string> = { fast: "Cepat", normal: "Normal", slow: "Hemat" };
const MAX_REASONABLE = 2000; // sat/vB; di atas ini hampir pasti salah data

/** Estimasi dari penyedia data (target blok). Hanya angka dari penyedia, bukan tebakan lokal. */
export async function feeQuote(chain: ChainConfig): Promise<FeeQuote> {
  const e = await feeEstimates(chain);
  const pick = (targets: string[]) => {
    for (const t of targets) {
      const v = e[t];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.max(1, Math.ceil(v));
    }
    return null;
  };
  const fast = pick(["1", "2", "3"]);
  const normal = pick(["6", "4", "3", "2"]);
  const slow = pick(["24", "12", "6"]);
  if (fast === null || normal === null || slow === null) throw new Error("Estimasi fee tidak tersedia dari penyedia data.");
  const q = { fast, normal: Math.min(normal, fast), slow: Math.min(slow, normal, fast) };
  if (q.fast > MAX_REASONABLE) throw new Error("Estimasi fee dari penyedia tidak wajar. Transaksi dibatalkan.");
  return q;
}
