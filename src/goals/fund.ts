import type { ChainConfig } from "../lib/chains";
import type { TokenInfo } from "../lib/tokens";
import type { Account } from "../lib/vault";
import { activeGoals, allocate, poolCurrency, toPool } from "./allocation";
import { fmtPool } from "./guard";
import { walletRef } from "./ref";
import type { Goal } from "./types";
import { measurePool } from "./valuation";

/**
 * Pastikan dana yang dialokasikan ke `candidate` (goal baru atau yang diubah) ada di saldo nyata jaringan
 * DI LUAR dana yang sudah dikunci goal lain. Gagal-aman: jika saldo tidak bisa diverifikasi, melempar galat.
 */
export async function verifyFunding(account: Account, chain: ChainConfig, allTokens: Record<string, TokenInfo[]>, goals: Goal[], candidate: Goal) {
  if (candidate.funded === undefined) return;
  const ref = walletRef(account);
  const others = activeGoals(goals, ref, chain.chainId).filter((g) => g.id !== candidate.id);
  const currency = poolCurrency([...others, candidate]);
  let pool;
  try {
    pool = await measurePool(chain, account, allTokens, currency);
  } catch (e) {
    throw new Error(`Saldo jaringan belum bisa diverifikasi. ${e instanceof Error ? e.message : ""} Coba lagi.`.trim());
  }
  const a = allocate(others, pool);
  if (a.wholeLocked) throw new Error("Seluruh saldo jaringan ini sudah terkunci oleh goal lain, jadi tidak ada dana yang bisa dialokasikan.");
  const need = toPool(candidate, candidate.funded, pool);
  if (need > a.free + 1e-9 * Math.max(1, a.total)) {
    throw new Error(
      `Dana melebihi saldo yang tersedia: ${fmtPool(need, currency, chain.symbol)} diminta, tersedia ${fmtPool(a.free, currency, chain.symbol)} ` +
        `(saldo ${fmtPool(a.total, currency, chain.symbol)}, terkunci goal lain ${fmtPool(a.locked, currency, chain.symbol)}).`,
    );
  }
}
