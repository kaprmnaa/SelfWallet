import { useEffect, useRef, useState } from "react";
import type { Account } from "../lib/vault";
import { useSettings } from "../context/SettingsContext";
import { client, currentUser } from "../goals/sync";
import { decryptItem, encryptItem, keysFor } from "./crypto";

export type HistorySyncState = { status: "off" | "syncing" | "synced" | "error"; message?: string };

type Row = { id: string; payload: string; wallet_ref: string };

/**
 * Sinkron riwayat transaksi ke Supabase (terenkripsi), per wallet yang sedang terbuka.
 * Jalan hanya saat sinkron akun sudah online. Menarik riwayat dari perangkat lain, mendorong yang baru/berubah
 * (mis. pending -> berhasil), dan mendengarkan perubahan realtime.
 */
export function useHistorySync(account: Account, owner: string | null | undefined, online: boolean): HistorySyncState {
  const { history, mergeHistory } = useSettings();
  const [state, setState] = useState<HistorySyncState>({ status: "off" });
  const [ready, setReady] = useState(false);
  const pushed = useRef(new Map<string, string>()); // "chainId:hash" -> status yang sudah ada di server
  const mergeRef = useRef(mergeHistory);
  mergeRef.current = mergeHistory;

  // 1) Tarik + langganan realtime.
  useEffect(() => {
    setReady(false);
    pushed.current = new Map();
    if (!online) {
      setState({ status: "off" });
      return;
    }
    let stopped = false;
    let cleanup: (() => void) | null = null;
    setState({ status: "syncing" });
    (async () => {
      try {
        const [sb, user, keys] = await Promise.all([client(), currentUser(), keysFor(account)]);
        if (!user) throw new Error("Belum masuk.");
        const { data, error } = await sb
          .from("tx_history")
          .select("id,payload,wallet_ref")
          .eq("wallet_ref", keys.ref)
          .order("ts", { ascending: false })
          .limit(300);
        if (error) throw new Error(error.message);
        const items = (
          await Promise.all(((data ?? []) as Row[]).map((r) => decryptItem(account, r.id, r.payload)))
        ).filter((x): x is NonNullable<typeof x> => !!x);
        if (stopped) return;
        for (const i of items) pushed.current.set(`${i.chainId}:${i.hash}`, i.status);
        mergeRef.current(items);

        const channel = sb
          .channel(`kunci-history-${user.id}-${keys.ref.slice(0, 8)}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "tx_history", filter: `user_id=eq.${user.id}` }, async (payload) => {
            const r = payload.new as Partial<Row>;
            if (!r || r.wallet_ref !== keys.ref || typeof r.id !== "string" || typeof r.payload !== "string") return;
            const item = await decryptItem(account, r.id, r.payload);
            if (item && !stopped) {
              pushed.current.set(`${item.chainId}:${item.hash}`, item.status);
              mergeRef.current([item]);
            }
          })
          .subscribe();
        cleanup = () => void sb.removeChannel(channel);
        if (!stopped) {
          setReady(true);
          setState({ status: "synced" });
        }
      } catch (e) {
        if (!stopped) setState({ status: "error", message: e instanceof Error ? e.message : "Sinkron riwayat gagal." });
      }
    })();
    return () => {
      stopped = true;
      cleanup?.();
    };
  }, [account, online]);

  // 2) Dorong item wallet ini yang baru atau berubah status.
  useEffect(() => {
    if (!ready) return;
    const mine = history.filter((h) => h.from === account.address || (!!owner && h.from === owner));
    const todo = mine.filter((h) => pushed.current.get(`${h.chainId}:${h.hash}`) !== h.status);
    if (todo.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const [sb, keys] = await Promise.all([client(), keysFor(account)]);
        const rows = await Promise.all(
          todo.map(async (h) => {
            const { id, payload } = await encryptItem(account, h);
            return { id, wallet_ref: keys.ref, chain_id: h.chainId, ts: new Date(h.ts).toISOString(), payload, updated_at: new Date().toISOString() };
          }),
        );
        const { error } = await sb.from("tx_history").upsert(rows, { onConflict: "user_id,id" });
        if (error) throw new Error(error.message);
        for (const h of todo) pushed.current.set(`${h.chainId}:${h.hash}`, h.status);
        if (!cancelled) setState({ status: "synced" });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: e instanceof Error ? e.message : "Gagal menyimpan riwayat." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [history, ready, account, owner]);

  return state;
}
