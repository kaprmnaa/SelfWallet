import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChainConfig } from "../lib/chains";
import type { TokenInfo } from "../lib/tokens";
import type { Account } from "../lib/vault";
import { useVisibleInterval } from "../lib/visibility";
import { errMsg } from "../lib/format";
import { evaluate, shouldSnapshot } from "./logic";
import { walletRef } from "./ref";
import { addSnapshot, getGoals, getSnapshots, upsertGoal, useGoals } from "./store";
import { allocate, poolCurrency } from "./allocation";
import { clearSummary, setSummary, summaryKeysFor } from "./summary";
import { measurePool } from "./valuation";
import type { Goal } from "./types";

export type GoalLive = { value: number; unpriced: number; at: number } | { error: string; at: number };

/**
 * Memantau goal aktif wallet ini: ukur saldo/nilai tiap 30 detik (hanya saat tab terlihat), evaluasi pencapaian,
 * dan catat snapshot untuk grafik perjalanan. Ini polling, bukan streaming: harga (DefiLlama/Binance/CoinGecko) di-cache 5 menit.
 */
export function useGoalEngine(account: Account, chains: ChainConfig[], allTokens: Record<string, TokenInfo[]>) {
  const ref = useMemo(() => walletRef(account), [account]);
  const goals = useGoals();
  const active = useMemo(() => goals.filter((g) => g.ref === ref && g.status === "active"), [goals, ref]);
  const [live, setLive] = useState<Record<string, GoalLive>>({});
  const running = useRef(false);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      // Satu pengukuran per jaringan (pool), lalu dibagi ke semua goal aktif jaringan itu.
      const groups = new Map<number, Goal[]>();
      for (const g of getGoals().filter((x) => x.ref === ref && x.status === "active")) {
        groups.set(g.chainId, [...(groups.get(g.chainId) ?? []), g]);
      }
      for (const [chainId, list] of groups) {
        const chain = chains.find((c) => c.chainId === chainId);
        const fail = (msg: string) =>
          setLive((p) => ({ ...p, ...Object.fromEntries(list.map((g) => [g.id, { error: msg, at: Date.now() }])) }));
        if (!chain) {
          fail("Jaringan tidak ditemukan.");
          continue;
        }
        try {
          const pool = await measurePool(chain, account, allTokens, poolCurrency(list));
          const at = Date.now();
          const alloc = allocate(list, pool);
          for (const g of list) {
            const cur = getGoals().find((x) => x.id === g.id);
            if (!cur || cur.status !== "active") continue;
            const value = alloc.values[g.id] ?? 0;
            const next = evaluate(cur, value, at);
            if (next !== cur) upsertGoal(next, next.status !== cur.status); // hits = lokal-saja
            const last = getSnapshots()
              .filter((s) => s.goalId === g.id)
              .at(-1);
            if (shouldSnapshot(last, value, g.target, at)) addSnapshot({ goalId: g.id, ts: at, value });
          }
          setSummary(ref, chainId, {
            total: alloc.total,
            locked: alloc.locked,
            free: alloc.free,
            currency: alloc.currency,
            wholeLocked: alloc.wholeLocked,
            at,
          });
          setLive((p) => ({
            ...p,
            ...Object.fromEntries(list.map((g) => [g.id, { value: alloc.values[g.id] ?? 0, unpriced: pool.unpriced, at }])),
          }));
        } catch (e) {
          fail(errMsg(e));
        }
      }
      // Jaringan yang tidak punya goal aktif lagi: hapus ringkasannya.
      for (const id of summaryKeysFor(ref)) if (!groups.has(id)) clearSummary(ref, id);
    } finally {
      running.current = false;
    }
  }, [account, chains, allTokens, ref]);

  useEffect(() => {
    void run();
  }, [run, active.length]);
  useVisibleInterval(run, 30_000);

  return { live, refresh: run };
}

export type GoalEngine = ReturnType<typeof useGoalEngine>;
