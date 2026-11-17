import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getGoals, getSnapshots, mergeRemoteGoals, mergeRemoteSnapshots, onLocalChange } from "./store";
import type { Goal, Snapshot } from "./types";

// Sinkron OPSIONAL lintas perangkat lewat Supabase (lokal-dulu: aplikasi tetap bekerja tanpa ini).
// supabase-js dimuat malas (dynamic import) supaya tidak membebani pemuatan awal di HP.
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const syncConfigured = Boolean(URL && KEY);

export type SyncState = {
  status: "off" | "signed-out" | "connecting" | "online" | "error";
  email?: string;
  message?: string;
};

let clientP: Promise<SupabaseClient> | null = null;
function client(): Promise<SupabaseClient> {
  if (!syncConfigured) return Promise.reject(new Error("Supabase belum dikonfigurasi."));
  clientP ??= import("@supabase/supabase-js").then((m) =>
    m.createClient(URL!, KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "kunci-sb-auth" },
    }),
  );
  return clientP;
}

export async function currentUser(): Promise<{ id: string; email: string | null } | null> {
  const sb = await client();
  const { data } = await sb.auth.getSession();
  const u = data.session?.user;
  return u ? { id: u.id, email: u.email ?? null } : null;
}

/** Kirim kode sekali pakai ke email. Template "Magic Link" di Supabase harus memuat {{ .Token }}. */
export async function sendCode(email: string) {
  const sb = await client();
  const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  if (error) throw new Error(error.message);
}

/** Kode bisa 6 atau 8 digit (default proyek baru bisa berbeda). */
export async function verifyCode(email: string, token: string) {
  const sb = await client();
  const { data, error } = await sb.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: "email" });
  if (error) throw new Error(error.message);
  const u = data.user;
  if (!u) throw new Error("Verifikasi gagal.");
  return { id: u.id, email: u.email ?? null };
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
}

/* ---------------------------------------------------------------- pemetaan */

const iso = (ms: number) => new Date(ms).toISOString();

const toRow = (g: Goal) => ({
  id: g.id,
  wallet_ref: g.ref,
  name: g.name,
  chain_id: g.chainId,
  unit: g.unit,
  start_value: g.start,
  target_value: g.target,
  status: g.status,
  created_at: iso(g.createdAt),
  achieved_at: g.achievedAt ? iso(g.achievedAt) : null,
  cancel_requested_at: g.cancelRequestedAt ? iso(g.cancelRequestedAt) : null,
  updated_at: iso(g.updatedAt),
});

/** Data dari jaringan diperlakukan tidak tepercaya: bentuk dicek ketat. */
function fromRow(r: Record<string, unknown> | null | undefined): Goal | null {
  if (!r) return null;
  const ms = (x: unknown) => (typeof x === "string" ? Date.parse(x) : NaN);
  const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN);
  const status = r.status;
  const unit = r.unit;
  if (
    typeof r.id !== "string" ||
    typeof r.wallet_ref !== "string" ||
    typeof r.name !== "string" ||
    !Number.isFinite(num(r.chain_id)) ||
    (unit !== "usd" && unit !== "native") ||
    !Number.isFinite(num(r.start_value)) ||
    !(num(r.target_value) > 0) ||
    (status !== "active" && status !== "achieved" && status !== "cancelled") ||
    !Number.isFinite(ms(r.created_at)) ||
    !Number.isFinite(ms(r.updated_at))
  ) {
    return null;
  }
  const achieved = ms(r.achieved_at);
  const cancelReq = ms(r.cancel_requested_at);
  return {
    id: r.id,
    ref: r.wallet_ref,
    name: r.name.slice(0, 40),
    chainId: num(r.chain_id),
    unit,
    start: num(r.start_value),
    target: num(r.target_value),
    status,
    createdAt: ms(r.created_at),
    updatedAt: ms(r.updated_at),
    achievedAt: Number.isFinite(achieved) ? achieved : undefined,
    cancelRequestedAt: Number.isFinite(cancelReq) ? cancelReq : undefined,
  };
}

/* ------------------------------------------------------------------ sinkron */

/** Mulai sinkron untuk pengguna yang sudah masuk. Mengembalikan fungsi penghenti. */
export function startSync(userId: string, onState: (s: SyncState) => void, email?: string): () => void {
  let stopped = false;
  let channel: RealtimeChannel | null = null;
  let sb: SupabaseClient | null = null;
  let unhook: (() => void) | null = null;

  (async () => {
    try {
      onState({ status: "connecting", email });
      sb = await client();

      // 1) tarik goal jarak jauh, gabungkan (status akhir menang), dorong yang lokalnya lebih baru
      const { data, error } = await sb.from("goals").select("*");
      if (error) throw new Error(error.message);
      if (stopped) return;
      const remote = (data ?? []).map((r) => fromRow(r as Record<string, unknown>)).filter((g): g is Goal => !!g);
      mergeRemoteGoals(remote);
      const remoteMap = new Map(remote.map((g) => [g.id, g]));
      const push = getGoals().filter((g) => {
        const r = remoteMap.get(g.id);
        return !r || g.updatedAt > r.updatedAt;
      });
      if (push.length > 0) {
        const { error: e2 } = await sb.from("goals").upsert(push.map(toRow));
        if (e2) throw new Error(e2.message);
      }

      // 2) snapshot: tarik yang ada, dorong yang hanya ada di lokal
      const ids = getGoals().map((g) => g.id);
      if (ids.length > 0) {
        const { data: sdata, error: e3 } = await sb
          .from("goal_snapshots")
          .select("goal_id, ts, value")
          .in("goal_id", ids)
          .order("ts", { ascending: false })
          .limit(1000);
        if (e3) throw new Error(e3.message);
        const remoteSnaps: Snapshot[] = (sdata ?? [])
          .map((r) => ({ goalId: String(r.goal_id), ts: Date.parse(String(r.ts)), value: Number(r.value) }))
          .filter((s) => Number.isFinite(s.ts) && Number.isFinite(s.value));
        mergeRemoteSnapshots(remoteSnaps);
        const newest = new Map<string, number>();
        for (const s of remoteSnaps) newest.set(s.goalId, Math.max(newest.get(s.goalId) ?? 0, s.ts));
        const localOnly = getSnapshots().filter((s) => s.ts > (newest.get(s.goalId) ?? 0));
        if (localOnly.length > 0) {
          await sb.from("goal_snapshots").insert(localOnly.slice(-200).map((s) => ({ goal_id: s.goalId, ts: iso(s.ts), value: s.value })));
        }
      }
      if (stopped) return;

      // 3) realtime: perubahan dari perangkat lain masuk langsung
      channel = sb
        .channel(`kunci-goals-${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "goals", filter: `user_id=eq.${userId}` }, (payload) => {
          const g = fromRow(payload.new as Record<string, unknown>);
          if (g) mergeRemoteGoals([g]);
        })
        .subscribe();

      // 4) dorong setiap perubahan lokal berikutnya
      unhook = onLocalChange(async (c) => {
        try {
          if (!sb) return;
          if (c.kind === "goal") {
            const { error: e } = await sb.from("goals").upsert(toRow(c.item));
            if (e) throw new Error(e.message);
          } else {
            const { error: e } = await sb.from("goal_snapshots").insert({ goal_id: c.item.goalId, ts: iso(c.item.ts), value: c.item.value });
            if (e) throw new Error(e.message);
          }
        } catch (e) {
          onState({ status: "error", email, message: e instanceof Error ? e.message : "Gagal menyinkronkan." });
        }
      });
      onState({ status: "online", email });
    } catch (e) {
      if (!stopped) onState({ status: "error", email, message: e instanceof Error ? e.message : "Sinkron gagal." });
    }
  })();

  return () => {
    stopped = true;
    unhook?.();
    if (channel && sb) void sb.removeChannel(channel);
  };
}


