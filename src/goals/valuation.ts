import type { ChainConfig } from "../lib/chains";
import type { TokenInfo } from "../lib/tokens";
import type { Account } from "../lib/vault";
import { rowsFor } from "../lib/portfolio";
import { nativePrices, tokenPrices } from "../lib/prices";
import { NEED_PHRASE } from "../core/derive";
import type { GoalUnit } from "./types";

export type Measure = { value: number; unpriced: number };

/**
 * Nilai aset wallet pada SATU jaringan: koin native + token tersimpan (EVM). Untuk satuan USD memakai harga
 * CoinGecko (cache 5 menit, jadi harga bukan streaming realtime). Gagal-aman: jika saldo atau harga tidak
 * bisa dimuat, melempar galat (tidak pernah mengembalikan nilai 0 palsu yang merusak grafik/evaluasi).
 */
export async function measure(
  chain: ChainConfig,
  account: Account,
  allTokens: Record<string, TokenInfo[]>,
  unit: GoalUnit,
): Promise<Measure> {
  const rows = await rowsFor(chain, account, allTokens);
  if (rows.some((r) => r.note)) throw new Error(NEED_PHRASE);
  if (rows.some((r) => r.error)) throw new Error("Saldo gagal dimuat dari penyedia data.");

  const nativeAmount = parseFloat(rows[0].amount);
  if (unit === "native") return { value: nativeAmount, unpriced: 0 };

  const prices = await nativePrices();
  const np = prices[chain.chainId];
  if (!np) throw new Error("Harga koin native tidak tersedia.");
  let usd = nativeAmount * np.usd;
  let unpriced = 0;
  const toks = rows.filter((r) => r.address);
  if (toks.length > 0) {
    try {
      const tp = await tokenPrices(chain.chainId, toks.map((t) => t.address!));
      for (const t of toks) {
        const p = tp[t.address!.toLowerCase()];
        const amt = parseFloat(t.amount);
        if (p) usd += amt * p.usd;
        else if (amt > 0) unpriced++;
      }
    } catch {
      unpriced += toks.filter((t) => parseFloat(t.amount) > 0).length;
    }
  }
  return { value: usd, unpriced };
}
