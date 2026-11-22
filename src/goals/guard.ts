import type { ChainConfig } from "../lib/chains";
import type { TokenInfo } from "../lib/tokens";
import type { Account } from "../lib/vault";
import { load } from "../lib/storage";
import { fmtUsd } from "../lib/portfolio";
import { trimAmount } from "../lib/format";
import { activeGoals, allocate, checkWithdrawal, lockGoals, outgoingValue, poolCurrency, type Currency, type Outgoing } from "./allocation";
import { lockMessage } from "./logic";
import { walletRef } from "./ref";
import { getGoals, getTimeLocks } from "./store";
import { activeTimeLock, timeLockMessage } from "./timelock";
import { measurePool } from "./valuation";

export type { Outgoing };

/**
 * Penjaga penarikan. PENTING: ini komitmen di dalam aplikasi, BUKAN penguncian kriptografis.
 * Kunci privat tetap di tangan Anda, jadi wallet lain (atau salinan aplikasi ini tanpa data goal) tetap
 * bisa menarik dana. Gunanya: gesekan yang disengaja terhadap keputusan impulsif.
 *
 * Aturan (berurutan):
 *  1. Kunci waktu aktif -> semua penarikan di semua jaringan ditolak.
 *  2. Goal lock tanpa alokasi dana -> seluruh jaringan itu ditolak.
 *  3. Goal lock berdana -> hanya saldo di luar dana terkunci yang boleh keluar (jumlah + biaya jaringan).
 *  4. Goal mode unlock tidak pernah membatasi.
 */
export function fmtPool(v: number, currency: Currency, symbol: string): string {
  return currency === "usd" ? fmtUsd(v) : `${trimAmount(v.toFixed(8), 6)} ${symbol}`;
}

export async function assertCanSpend(account: Account, chain: ChainConfig, out: Outgoing): Promise<void> {
  const ref = walletRef(account);

  const tl = activeTimeLock(getTimeLocks(), ref, Date.now());
  if (tl) throw new Error(timeLockMessage(tl));

  const all = getGoals();
  const locks = lockGoals(all, ref, chain.chainId);
  if (locks.length === 0) return;

  const whole = locks.find((g) => g.funded === undefined);
  if (whole) throw new Error(lockMessage(whole));

  // Pool dihitung dari SEMUA goal aktif jaringan ini (konsisten dengan tampilan di tab Goal).
  const active = activeGoals(all, ref, chain.chainId);
  const currency = poolCurrency(active);
  const allTokens = load<Record<string, TokenInfo[]>>("tokens", {});
  let verdict;
  let a;
  try {
    const pool = await measurePool(chain, account, allTokens, currency);
    a = allocate(active, pool);
    verdict = checkWithdrawal(a, outgoingValue(out, pool, pool.tokenUsd));
  } catch (e) {
    const why = e instanceof Error ? e.message : "";
    throw new Error(`Dana terkunci tidak bisa diverifikasi, jadi penarikan ditolak demi keamanan. ${why}`.trim());
  }
  if (!verdict.ok) {
    throw new Error(
      `Jumlah (termasuk biaya jaringan) sekitar ${fmtPool(verdict.needed, a.currency, chain.symbol)} melebihi dana yang tidak terkunci: ` +
        `${fmtPool(a.free, a.currency, chain.symbol)} dari total ${fmtPool(a.total, a.currency, chain.symbol)} ` +
        `(terkunci ${fmtPool(a.locked, a.currency, chain.symbol)} oleh goal lock). Hanya dana yang tidak terkunci yang bisa ditarik.`,
    );
  }
}
