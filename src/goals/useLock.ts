import { useEffect, useMemo, useState } from "react";
import type { ChainConfig } from "../lib/chains";
import type { Account } from "../lib/vault";
import { lockGoals } from "./allocation";
import { walletRef } from "./ref";
import { useGoals, useTimeLocks } from "./store";
import { useSummary, type LockSummary } from "./summary";
import { activeTimeLock } from "./timelock";
import type { Goal, TimeLock } from "./types";

export type LockInfo = {
  /** Kunci waktu aktif (semua jaringan). */
  time: TimeLock | null;
  /** Goal lock aktif di jaringan ini. */
  goals: Goal[];
  /** Goal lock tanpa alokasi: seluruh saldo jaringan terkunci. */
  whole: Goal | null;
  summary: LockSummary | undefined;
  /** Ada pembatasan apa pun (tampilkan notifikasi). */
  active: boolean;
  /** Seluruh penarikan pasti ditolak (kunci waktu atau kunci penuh): nonaktifkan tombol. */
  blocked: boolean;
};

/** Kondisi kunci untuk wallet + jaringan ini (reaktif terhadap goal, kunci waktu, dan berakhirnya waktu). */
export function useLockInfo(chain: ChainConfig, account: Account): LockInfo {
  const goals = useGoals();
  const locks = useTimeLocks();
  const ref = useMemo(() => walletRef(account), [account]);
  const summary = useSummary(ref, chain.chainId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => {
    const time = activeTimeLock(locks, ref, now);
    const lg = lockGoals(goals, ref, chain.chainId);
    const whole = lg.find((g) => g.funded === undefined) ?? null;
    return { time, goals: lg, whole, summary, active: !!time || lg.length > 0, blocked: !!time || !!whole };
  }, [goals, locks, ref, chain.chainId, now, summary]);
}
