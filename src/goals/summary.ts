import { useSyncExternalStore } from "react";
import type { Currency } from "./allocation";

/** Ringkasan dana terkunci per wallet+jaringan, diisi mesin goal (dipakai panel Kirim/Swap untuk notifikasi). */
export type LockSummary = { total: number; locked: number; free: number; currency: Currency; wholeLocked: boolean; at: number };

const map = new Map<string, LockSummary>();
const listeners = new Set<() => void>();
const key = (ref: string, chainId: number) => `${ref}:${chainId}`;
const emit = () => listeners.forEach((l) => l());

export function setSummary(ref: string, chainId: number, s: LockSummary) {
  map.set(key(ref, chainId), s);
  emit();
}
export function clearSummary(ref: string, chainId: number) {
  if (map.delete(key(ref, chainId))) emit();
}
export function summaryKeysFor(ref: string): number[] {
  return [...map.keys()].filter((k) => k.startsWith(`${ref}:`)).map((k) => Number(k.slice(ref.length + 1)));
}
export function useSummary(ref: string, chainId: number): LockSummary | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => map.get(key(ref, chainId)),
    () => map.get(key(ref, chainId)),
  );
}
