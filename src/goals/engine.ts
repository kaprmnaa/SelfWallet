import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChainConfig } from "../lib/chains";
import type { TokenInfo } from "../lib/tokens";
import type { Account } from "../lib/vault";
import { useVisibleInterval } from "../lib/visibility";
import { errMsg } from "../lib/format";
import { evaluate, shouldSnapshot } from "./logic";
import { walletRef } from "./ref";
import { addSnapshot, getGoals, getSnapshots, upsertGoal, useGoals } from "./store";
import { measure } from "./valuation";
import type { Goal } from "./types";

export type GoalLive = { value: number; unpriced: number; at: number } | { error: string; at: number };

/**
 * Memantau goal aktif wallet ini: ukur saldo/nilai tiap 30 detik (hanya saat tab terlihat), evaluasi pencapaian,
 * dan catat snapshot untuk grafik perjalanan. Ini polling, bukan streaming: harga CoinGecko di-cache 5 menit.
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
      const groups = new Map<string, Goal[]>();
      for (const g of getGoals().filter((x) => x.ref === ref && x.status === "active")) {
        const k = `${g.chainId}:${g.unit}`;
        groups.set(k, [...(groups.get(k) ?? []), g]);
      }
      for (const list of groups.values()) {
        const chain = chains.find((c) => c.chainId === list[0].chainId);
        const now = Date.now();
        if (!chain) {
          setLive((p) => ({ ...p, ...Object.fromEntries(list.map((g) => [g.id, { error: "Jaringan tidak ditemukan.", at: now }])) }));
          continue;
        }
        try {
          const m = await measure(chain, account, allTokens, list[0].unit);
          const at = Date.now();
          for (const g of list) {
            const cur = getGoals().find((x) => x.id === g.id);
            if (!cur || cur.status !== "active") continue;
            const next = evaluate(cur, m.value, at);
            if (next !== cur) upsertGoal(next, next.status !== cur.status); // hits = lokal-saja
            const last = getSnapshots()
              .filter((s) => s.goalId === g.id)
              .at(-1);
            if (shouldSnapshot(last, m.value, g.target, at)) addSnapshot({ goalId: g.id, ts: at, value: m.value });
          }
          setLive((p) => ({ ...p, ...Object.fromEntries(list.map((g) => [g.id, { value: m.value, unpriced: m.unpriced, at }])) }));
        } catch (e) {
          const msg = errMsg(e);
          setLive((p) => ({ ...p, ...Object.fromEntries(list.map((g) => [g.id, { error: msg, at: Date.now() }])) }));
        }
      }
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
