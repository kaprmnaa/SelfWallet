import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Account } from "../lib/vault";

export const AUTO_LOCK_MS = 5 * 60 * 1000;

export type Session = { id: string; name: string; account: Account };

type Ctx = {
  /** Wallet aktif (null = terkunci semua). */
  account: Account | null;
  name: string;
  activeId: string | null;
  sessions: Session[];
  addSession: (a: Account, name: string) => void;
  switchTo: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  /** Mengunci SEMUA wallet sekaligus. */
  lock: () => void;
};

const WalletCtx = createContext<Ctx | null>(null);

/**
 * Semua wallet yang sedang terbuka HANYA hidup di state React (memori tab ini).
 * Tidak ada penulisan kunci ke localStorage/sessionStorage/IndexedDB.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const lock = useCallback(() => {
    setSessions([]);
    setActiveId(null);
  }, []);

  const addSession = useCallback((a: Account, name: string) => {
    const id = a.address.toLowerCase();
    setSessions((prev) =>
      prev.some((s) => s.id === id) ? prev.map((s) => (s.id === id ? { id, name, account: a } : s)) : [...prev, { id, name, account: a }],
    );
    setActiveId(id);
  }, []);

  const switchTo = useCallback((id: string) => setActiveId(id), []);
  const renameSession = useCallback(
    (id: string, name: string) => setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s))),
    [],
  );

  const open = sessions.length > 0;
  useEffect(() => {
    if (!open) return;
    const reset = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(lock, AUTO_LOCK_MS);
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    window.addEventListener("pagehide", lock);
    reset();
    return () => {
      window.clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
      window.removeEventListener("pagehide", lock);
    };
  }, [open, lock]);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const value = useMemo<Ctx>(
    () => ({
      account: active?.account ?? null,
      name: active?.name ?? "",
      activeId: active?.id ?? null,
      sessions,
      addSession,
      switchTo,
      renameSession,
      lock,
    }),
    [active, sessions, addSession, switchTo, renameSession, lock],
  );
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function useWallet() {
  const c = useContext(WalletCtx);
  if (!c) throw new Error("useWallet harus di dalam WalletProvider");
  return c;
}
