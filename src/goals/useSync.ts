import { useCallback, useEffect, useRef, useState } from "react";
import { currentUser, sendCode, signOut, startSync, syncConfigured, verifyCode, type SyncState } from "./sync";

/** Status + aksi sinkron Supabase. Dipanggil sekali di Dashboard (aktif selama dompet terbuka). */
export function useSync() {
  const [state, setState] = useState<SyncState>({ status: syncConfigured ? "signed-out" : "off" });
  const stop = useRef<(() => void) | null>(null);

  const begin = useCallback((id: string, email: string | null) => {
    stop.current?.();
    stop.current = startSync(id, setState, email ?? undefined);
  }, []);

  useEffect(() => {
    if (!syncConfigured) return;
    let alive = true;
    currentUser()
      .then((u) => {
        if (alive && u) begin(u.id, u.email);
      })
      .catch(() => alive && setState({ status: "signed-out" }));
    return () => {
      alive = false;
      stop.current?.();
      stop.current = null;
    };
  }, [begin]);

  return {
    state,
    configured: syncConfigured,
    sendCode,
    async verify(email: string, code: string) {
      const u = await verifyCode(email, code);
      begin(u.id, u.email);
    },
    async signOut() {
      stop.current?.();
      stop.current = null;
      await signOut();
      setState({ status: "signed-out" });
    },
  };
}

export type SyncApi = ReturnType<typeof useSync>;
