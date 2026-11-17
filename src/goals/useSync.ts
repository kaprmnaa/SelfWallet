import { useCallback, useEffect, useRef, useState } from "react";
import { sendCode, signOut, startSync, syncConfigured, verifyCode, watchAuth, type SyncState } from "./sync";

/** Status + aksi sinkron Supabase. Dipanggil sekali di Dashboard (aktif selama dompet terbuka). */
export function useSync() {
  const [state, setState] = useState<SyncState>({ status: syncConfigured ? "signed-out" : "off" });
  const stop = useRef<(() => void) | null>(null);
  const activeId = useRef<string | null>(null);

  const halt = useCallback(() => {
    stop.current?.();
    stop.current = null;
    activeId.current = null;
  }, []);

  const begin = useCallback(
    (id: string, email: string | null) => {
      if (activeId.current === id) return; // sudah berjalan untuk pengguna ini
      stop.current?.();
      activeId.current = id;
      stop.current = startSync(id, setState, email ?? undefined);
    },
    [],
  );

  useEffect(() => {
    if (!syncConfigured) return;
    let alive = true;
    let unwatch: (() => void) | null = null;
    watchAuth((u) => {
      // Tunda: jangan memanggil Supabase langsung di dalam callback auth (bisa deadlock).
      setTimeout(() => {
        if (!alive) return;
        if (u) begin(u.id, u.email);
        else {
          halt();
          setState({ status: "signed-out" });
        }
      }, 0);
    })
      .then((fn) => {
        if (alive) unwatch = fn;
        else fn();
      })
      .catch(() => alive && setState({ status: "signed-out" }));
    return () => {
      alive = false;
      unwatch?.();
      halt();
    };
  }, [begin, halt]);

  return {
    state,
    configured: syncConfigured,
    sendCode,
    async verify(email: string, code: string) {
      const u = await verifyCode(email, code);
      begin(u.id, u.email);
    },
    async signOut() {
      halt();
      await signOut();
      setState({ status: "signed-out" });
    },
  };
}

export type SyncApi = ReturnType<typeof useSync>;
