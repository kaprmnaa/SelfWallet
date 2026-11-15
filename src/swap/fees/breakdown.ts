import { ZERO_ADDRESS, type Fee, type NormalizedQuote } from "../domain/types";

export type FeeLine = { label: string; amount: bigint; symbol: string; decimals: number; usd: number | null; included: boolean };

/**
 * Pisahkan gas jaringan (dibayar dari native, terpisah dari output) dan biaya provider/bridge.
 * Biaya dengan included=true sudah dipotong dari output, jadi hanya ditampilkan sebagai keterangan.
 */
export function breakdown(q: NormalizedQuote): { gas: FeeLine[]; provider: FeeLine[]; gasUsd: number | null; nativeExtra: bigint } {
  const line = (f: Fee, label?: string): FeeLine => ({
    label: label ?? f.name,
    amount: f.amount,
    symbol: f.token.symbol,
    decimals: f.token.decimals,
    usd: f.usd,
    included: f.included,
  });
  const gas = q.gasCosts.map((g) => line(g, "Gas jaringan asal"));
  const provider = q.feeCosts.map((f) => line(f));
  const usds = gas.map((g) => g.usd);
  const gasUsd = gas.length > 0 && usds.every((u) => u !== null) ? (usds as number[]).reduce((a, b) => a + b, 0) : null;
  const nativeSource = q.fromToken.address.toLowerCase() === ZERO_ADDRESS;
  const nativeExtra = q.tx.value - (nativeSource ? q.fromAmount : 0n);
  return { gas, provider, gasUsd, nativeExtra: nativeExtra > 0n ? nativeExtra : 0n };
}
