import { useSyncExternalStore } from "react";
import { load, save } from "../lib/storage";
import type { SwapExecution } from "./domain/types";

// Hanya metadata NON-rahasia (id eksekusi, hash, jumlah, status). Aman di localStorage.
let list: SwapExecution[] = (() => {
  const raw = load<unknown>("swaps", []);
  return Array.isArray(raw) ? (raw as SwapExecution[]).filter((e) => e && typeof e.id === "string" && typeof e.srcHash === "string") : [];
})();
const listeners = new Set<() => void>();

const emit = () => {
  save("swaps", list);
  listeners.forEach((l) => l());
};

export const getSwaps = () => list;

export function upsertSwap(e: SwapExecution) {
  const i = list.findIndex((x) => x.id === e.id);
  list = i >= 0 ? list.map((x, k) => (k === i ? e : x)) : [e, ...list].slice(0, 50);
  emit();
}

export function useSwaps(): SwapExecution[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSwaps,
    getSwaps,
  );
}
