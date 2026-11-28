import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Lock, LockOpen, Target, Timer } from "@phosphor-icons/react";
import { useSettings } from "../context/SettingsContext";
import { hasNativePrice } from "../lib/prices";
import { fmtUsd } from "../lib/portfolio";
import { errMsg, timeAgo, trimAmount } from "../lib/format";
import type { ChainConfig } from "../lib/chains";
import type { Account } from "../lib/vault";
import { walletRef } from "../goals/ref";
import { upsertGoal, upsertTimeLock, useAllSnapshots, useGoals, useTimeLocks } from "../goals/store";
import { isLockMode, modeOf, setFunded } from "../goals/allocation";
import { verifyFunding } from "../goals/fund";
import { UNIT_LABEL, activeTimeLock, formatRemaining, planTimeLock, type TimeUnit } from "../goals/timelock";
import { cancelInfo, confirmCancel, progress, requestCancel, revokeCancel, validateNewGoal } from "../goals/logic";
import type { Goal, GoalMode, GoalUnit } from "../goals/types";
import type { GoalEngine } from "../goals/engine";
import type { SyncApi } from "../goals/useSync";
import CoinIcon from "./CoinIcon";
import Sparkline from "./Sparkline";
import { Button, Field, Notice, ProgressBar, StatusDot, inputCls } from "./ui";

type Props = { account: Account; chain: ChainConfig; engine: GoalEngine; sync: SyncApi };

const num = (s: string) => Number(s.trim().replace(",", "."));

export default function GoalsPanel({ account, chain, engine, sync }: Props) {
  const goals = useGoals();
  const snaps = useAllSnapshots();
  const { chains } = useSettings();
  const ref = useMemo(() => walletRef(account), [account]);
  const mine = useMemo(
    () => goals.filter((g) => g.ref === ref).sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.createdAt - a.createdAt),
    [goals, ref],
  );

  return (
    <div className="grid gap-8">
      <Notice>
        Goal dan kunci waktu adalah <span className="text-amber-100">komitmen di dalam aplikasi</span>, bukan penguncian kriptografis.
        Goal <b>Lock</b> mengunci dananya sampai target tercapai (hanya dana yang tidak terkunci yang bisa ditarik); goal <b>Unlock</b> tidak
        mengunci apa pun. Kunci privat tetap milik Anda: wallet lain tetap bisa menarik dana.
      </Notice>

      <SyncCard sync={sync} />
      <TimeLockCard account={account} />
      <CreateGoal account={account} chain={chain} chains={chains} engine={engine} goals={goals} />

      <section>
        <h3 className="text-sm font-medium text-zinc-300">Perjalanan Anda</h3>
        {mine.length === 0 ? (
          <div className="mt-3 flex items-start gap-4 border-y border-white/[0.06] py-8">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 text-zinc-500">
              <Target />
            </span>
            <p className="max-w-[60ch] text-sm leading-relaxed text-zinc-500">
              Belum ada goal. Buat satu di atas, mis. "target 100$" atau "10 to 100", pilih jaringannya, lalu progresnya
              dipantau otomatis.
            </p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.06] border-y border-white/[0.06]">
            {mine.map((g) => (
              <GoalCard
                key={g.id}
                g={g}
                account={account}
                allGoals={goals}
                chain={chains.find((c) => c.chainId === g.chainId)}
                live={engine.live[g.id]}
                points={snaps.filter((s) => s.goalId === g.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* --------------------------------------------------------------- Sinkron */

function SyncCard({ sync }: { sync: SyncApi }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const st = sync.state;

  if (!sync.configured) {
    return (
      <Notice tone="info">
        Goal tersimpan <span className="text-zinc-200">lokal</span> di browser ini. Untuk sinkron lintas perangkat (Supabase), isi
        VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY lalu deploy ulang. Lihat README.
      </Notice>
    );
  }

  if (st.status === "online" || st.status === "connecting" || st.status === "error") {
    return (
      <div className="grid gap-2 glass-surface rounded-xl border border-white/10 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-300">
            <StatusDot tone={st.status === "online" ? "ok" : st.status === "error" ? "bad" : "warn"} still={st.status !== "connecting"} />
            <span className="truncate">
              {st.status === "online" ? "Tersinkron" : st.status === "connecting" ? "Menyambung…" : "Sinkron bermasalah"}
              {st.email ? ` · ${st.email}` : ""}
            </span>
          </span>
          <button type="button" onClick={() => void sync.signOut()} className="shrink-0 text-xs text-zinc-500 transition-colors duration-300 hover:text-zinc-200">
            Keluar
          </button>
        </div>
        {st.status === "error" && st.message && <p className="break-words text-xs text-rose-400">{st.message}</p>}
      </div>
    );
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await sync.sendCode(email);
      setStep("code");
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await sync.verify(email, code);
      setCode("");
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={step === "email" ? send : verify} className="grid gap-4 glass-surface rounded-xl border border-white/10 p-4">
      <p className="text-sm text-zinc-300">Sinkron goal lintas perangkat (opsional)</p>
      {step === "email" ? (
        <Field label="Email" hint="Hanya untuk masuk. Alamat wallet Anda tidak dikirim." error={err}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={inputCls} />
        </Field>
      ) : (
        <Field label="Kode dari email" hint="Kode 6 sampai 8 digit, cek juga folder spam. Jika email hanya berisi tautan, klik tautannya (Anda kembali ke aplikasi dan otomatis masuk), atau ubah template email di Supabase agar memuat kode (lihat README)." error={err}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
            inputMode="numeric"
            autoComplete="one-time-code"
            className={`${inputCls} font-mono tracking-widest`}
          />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        {step === "code" && (
          <Button type="button" variant="ghost" onClick={() => { setStep("email"); setCode(""); setErr(""); }}>
            Ganti email
          </Button>
        )}
        <Button type="submit" busy={busy} disabled={step === "email" ? !email.trim() : code.length < 6} className={step === "email" ? "col-span-2" : ""}>
          {step === "email" ? "Kirim kode" : "Verifikasi"}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------ Buat goal */

function CreateGoal({ account, chain, chains, engine, goals }: { account: Account; chain: ChainConfig; chains: ChainConfig[]; engine: GoalEngine; goals: Goal[] }) {
  const { allTokens } = useSettings();
  const [mode, setMode] = useState<GoalMode>("lock");
  const [funded, setFundedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [chainId, setChainId] = useState(chain.chainId);
  const [unit, setUnit] = useState<GoalUnit>("native");
  const [start, setStart] = useState("");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState("");

  const sel = chains.find((c) => c.chainId === chainId) ?? chain;
  const usdOk = hasNativePrice(sel);
  useEffect(() => setUnit(usdOk ? "usd" : "native"), [usdOk, chainId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const startN = start.trim() === "" ? 0 : num(start);
      const targetN = num(target);
      const fundedN = funded.trim() === "" ? undefined : num(funded);
      const clean = validateNewGoal({ name, unit, usdSupported: usdOk, start: startN, target: targetN, mode, funded: fundedN });
      const now = Date.now();
      const goal: Goal = {
        id: crypto.randomUUID(),
        ref: walletRef(account),
        name: clean,
        chainId: sel.chainId,
        unit,
        start: startN,
        target: targetN,
        status: "active",
        createdAt: now,
        updatedAt: now,
        mode,
        funded: fundedN,
      };
      await verifyFunding(account, sel, allTokens, goals, goal);
      upsertGoal(goal);
      setName("");
      setStart("");
      setTarget("");
      setFundedText("");
      void engine.refresh();
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <h3 className="text-sm font-medium text-zinc-300">Goal baru</h3>
      <Field label="Nama goal">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder='mis. "target 100$" atau "10 to 100"' autoComplete="off" className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Jaringan">
          <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))} className={inputCls}>
            {chains.map((c) => (
              <option key={c.chainId} value={c.chainId}>
                {c.name}
                {c.testnet ? " (testnet)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Satuan" hint={usdOk ? undefined : "USD hanya untuk mainnet bawaan"}>
          <div className="grid grid-cols-2 glass-field gap-1 rounded-xl border border-white/10 p-0.5 text-xs" role="group" aria-label="Satuan target">
            {(["usd", "native"] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                disabled={u === "usd" && !usdOk}
                onClick={() => setUnit(u)}
                className={`rounded-[10px] px-2 py-2.5 transition-colors duration-300 disabled:opacity-30 ${unit === u ? "glass-lens text-zinc-50" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {u === "usd" ? "USD" : sel.symbol}
              </button>
            ))}
          </div>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mulai dari (opsional)" hint='"10 to 100": isi 10'>
          <input value={start} onChange={(e) => setStart(e.target.value)} inputMode="decimal" placeholder="0" className={`${inputCls} font-mono`} />
        </Field>
        <Field label={`Target (${unit === "usd" ? "USD" : sel.symbol})`} error={err}>
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="100" className={`${inputCls} font-mono`} />
        </Field>
      </div>
      <Field label="Mode" hint={mode === "lock" ? "Dana goal terkunci sampai target tercapai." : "Hanya pelacak progres: dana tetap bebas ditarik."}>
        <div className="grid grid-cols-2 glass-field gap-1 rounded-xl border border-white/10 p-0.5 text-xs" role="group" aria-label="Mode goal">
          {(["lock", "unlock"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`flex items-center justify-center gap-1.5 rounded-[10px] px-2 py-2.5 transition-colors duration-300 ${mode === m ? "glass-lens text-zinc-50" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {m === "lock" ? <Lock /> : <LockOpen />}
              {m === "lock" ? "Lock" : "Unlock"}
            </button>
          ))}
        </div>
      </Field>
      <Field
        label={`Dana untuk goal ini (${unit === "usd" ? "USD" : sel.symbol}, opsional)`}
        hint={
          mode === "lock"
            ? "Hanya jumlah ini yang terkunci. Kosong = SELURUH saldo jaringan terkunci."
            : "Saldo awal goal ini. Kosong = seluruh saldo yang tidak dikunci goal lain."
        }
      >
        <input value={funded} onChange={(e) => setFundedText(e.target.value)} inputMode="decimal" placeholder="mis. 701" className={`${inputCls} font-mono`} />
      </Field>
      <Button type="submit" busy={busy} disabled={!name.trim() || !target.trim()}>
        Buat goal
      </Button>
      <p className="text-xs leading-relaxed text-zinc-600">
        Yang dihitung: koin native{sel.kind === undefined || sel.kind === "evm" ? " + token tersimpan (pool USD)" : ""} di jaringan ini. Goal
        tercapai setelah dua pembacaan berturut-turut. Contoh: saldo 728$, goal Lock 701$ + goal Unlock 27$ = yang bisa ditarik hanya 27$.
      </p>
    </form>
  );
}

/* ------------------------------------------------------------ Kartu goal */

function remaining(ms: number) {
  const m = Math.max(0, Math.ceil(ms / 60000));
  return `${Math.floor(m / 60)} jam ${m % 60} menit`;
}

function GoalCard({
  g,
  account,
  allGoals,
  chain,
  live,
  points,
}: {
  g: Goal;
  account: Account;
  allGoals: Goal[];
  chain: ChainConfig | undefined;
  live: GoalEngine["live"][string] | undefined;
  points: { ts: number; value: number }[];
}) {
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState("");
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const lastPoint = points.at(-1);
  const current = live && "value" in live ? live.value : (lastPoint?.value ?? null);
  const pct = g.status === "achieved" ? 1 : current !== null ? progress(g, current) : 0;
  const fmt = (v: number) => (g.unit === "usd" ? fmtUsd(v) : `${trimAmount(v.toFixed(8), 6)} ${chain?.symbol ?? ""}`);
  const ci = cancelInfo(g, now);

  function act(fn: () => Goal) {
    setErr("");
    try {
      upsertGoal(fn());
    } catch (e) {
      setErr(errMsg(e));
    }
  }

  return (
    <li className="grid gap-3 py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base text-zinc-50">{g.name}</p>
          <p className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
            {chain && <CoinIcon symbol={chain.symbol} size={16} />}
            {chain?.name ?? `Jaringan ${g.chainId}`} · {g.unit === "usd" ? "USD" : chain?.symbol}
            {g.start > 0 ? ` · mulai ${fmt(g.start)}` : ""}
          </p>
          <p className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
            {isLockMode(g) ? <Lock /> : <LockOpen />}
            {modeOf(g) === "lock" ? "Lock" : "Unlock"} · dana {g.funded !== undefined ? fmt(g.funded) : "seluruh saldo jaringan"}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] ${
            g.status === "achieved" ? "border-accent/40 text-accent" : g.status === "cancelled" ? "border-white/10 text-zinc-500" : "border-amber-400/30 text-amber-300/90"
          }`}
        >
          {g.status === "achieved" ? "Tercapai" : g.status === "cancelled" ? "Dibatalkan" : "Aktif"}
        </span>
      </div>

      <div className="grid gap-2">
        <ProgressBar value={pct} />
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-xs text-zinc-400">
          <span>
            {current !== null ? fmt(current) : "…"} / {fmt(g.target)}
          </span>
          <span className="text-zinc-300">{Math.round(pct * 100)}%</span>
        </div>
      </div>

      {g.status === "active" && (
        <p className="flex items-center gap-2 text-xs text-zinc-500">
          {live && "error" in live ? (
            <span className="text-rose-400">{live.error}</span>
          ) : (
            <>
              <StatusDot tone="ok" />
              {live ? `Diperbarui ${timeAgo(live.at)}` : "Menunggu data pertama…"}
              {live && "unpriced" in live && live.unpriced > 0 ? ` · ${live.unpriced} token belum berharga` : ""}
            </>
          )}
        </p>
      )}

      <Sparkline points={points} target={g.target} start={g.start} />

      {g.status === "active" && isLockMode(g) && (
        <p className="flex items-center gap-2 text-xs text-amber-300/80">
          <Lock />
          {g.funded !== undefined
            ? `Dana ${fmt(g.funded)} terkunci sampai target tercapai. Sisa saldo di luar itu tetap bisa ditarik.`
            : `Seluruh penarikan di ${chain?.name ?? "jaringan ini"} dikunci sampai target tercapai.`}
        </p>
      )}
      {g.status === "active" && !isLockMode(g) && (
        <p className="flex items-center gap-2 text-xs text-zinc-500">
          <LockOpen /> Mode Unlock: dana goal ini tidak dikunci dan bisa ditarik kapan saja.
        </p>
      )}
      {g.status === "active" && chain && (isLockMode(g) ? g.funded !== undefined : true) && (
        <FundEditor g={g} account={account} chain={chain} allGoals={allGoals} fmt={fmt} />
      )}
      {g.status === "achieved" && g.achievedAt && (
        <p className="text-xs text-zinc-500">Tercapai {new Date(g.achievedAt).toLocaleString("id-ID")}. Dana goal ini tidak lagi terkunci.</p>
      )}

      {g.status === "active" && (
        <div className="grid gap-2">
          {!ci.requested ? (
            <button type="button" onClick={() => act(() => requestCancel(g))} className="justify-self-start text-xs text-zinc-500 transition-colors duration-300 hover:text-zinc-200">
              Ajukan pembatalan (masa tunggu 24 jam)
            </button>
          ) : ci.ready ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="danger" className="!px-3 !py-2 text-xs" onClick={() => act(() => confirmCancel(g))}>
                Konfirmasi pembatalan
              </Button>
              <button type="button" onClick={() => act(() => revokeCancel(g))} className="text-xs text-zinc-500 hover:text-zinc-200">
                Tetap lanjutkan goal
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
              <span>Pembatalan bisa dikonfirmasi dalam {remaining((ci.readyAt ?? now) - now)}.</span>
              <button type="button" onClick={() => act(() => revokeCancel(g))} className="text-accent hover:underline">
                Batalkan pengajuan
              </button>
            </div>
          )}
          {err && (
            <p role="alert" className="text-xs text-rose-400">
              {err}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/* ----------------------------------------------------- Ubah dana goal */

function FundEditor({ g, account, chain, allGoals, fmt }: { g: Goal; account: Account; chain: ChainConfig; allGoals: Goal[]; fmt: (v: number) => string }) {
  const { allTokens } = useSettings();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const lockMode = isLockMode(g);

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const next = setFunded(g, num(val));
      await verifyFunding(account, chain, allTokens, allGoals, next);
      upsertGoal(next);
      setOpen(false);
      setVal("");
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="justify-self-start text-xs text-accent hover:underline">
        {lockMode ? "Tambah dana goal" : "Ubah dana goal"}
      </button>
    );
  }
  return (
    <form onSubmit={save} className="grid gap-2 glass-surface rounded-xl border border-white/10 p-3">
      <Field
        label={`Dana baru (${g.unit === "usd" ? "USD" : chain.symbol})`}
        hint={lockMode ? `Saat ini ${g.funded !== undefined ? fmt(g.funded) : "-"}. Dana goal Lock hanya bisa naik.` : "Boleh naik atau turun."}
        error={err}
      >
        <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" className={`${inputCls} font-mono`} autoFocus />
      </Field>
      <div className="flex gap-3">
        <Button type="submit" busy={busy} disabled={!val.trim()} className="!px-3 !py-2 text-xs">
          Simpan
        </Button>
        <button type="button" onClick={() => { setOpen(false); setErr(""); }} className="text-xs text-zinc-500 hover:text-zinc-200">
          Batal
        </button>
      </div>
    </form>
  );
}

/* --------------------------------------------------- Kunci semua jaringan */

function TimeLockCard({ account }: { account: Account }) {
  const ref = useMemo(() => walletRef(account), [account]);
  const locks = useTimeLocks();
  const [now, setNow] = useState(Date.now());
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<TimeUnit>("hour");
  const [err, setErr] = useState("");
  const [confirming, setConfirming] = useState<ReturnType<typeof planTimeLock> | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const active = activeTimeLock(locks, ref, now);

  function review(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const plan = planTimeLock(locks.find((l) => l.ref === ref), ref, num(value), unit, Date.now());
      setConfirming(plan);
    } catch (ex) {
      setErr(errMsg(ex));
    }
  }

  function confirm() {
    if (!confirming) return;
    try {
      // Hitung ulang saat konfirmasi: aturan "tidak boleh memendek" dicek terhadap waktu sekarang.
      const plan = planTimeLock(locks.find((l) => l.ref === ref), ref, num(value), unit, Date.now());
      upsertTimeLock(plan);
      setConfirming(null);
      setValue("");
    } catch (ex) {
      setErr(errMsg(ex));
      setConfirming(null);
    }
  }

  return (
    <section className="grid gap-4 glass-surface rounded-xl border border-white/10 p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-300">
        <Timer /> Kunci semua jaringan (waktu)
      </h3>
      {active ? (
        <p className="flex items-start gap-2 text-sm text-amber-300/90">
          <Lock className="mt-0.5 shrink-0" />
          <span>
            Semua kirim dan swap di SEMUA jaringan dikunci sampai {new Date(active.until).toLocaleString("id-ID")} (sisa{" "}
            {formatRemaining(active.until - now)}). Tidak bisa dibatalkan atau dipersingkat, hanya diperpanjang.
          </span>
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-zinc-500">
          Tidak ada kunci waktu. Isi durasi untuk menolak semua kirim dan swap di semua jaringan sampai waktunya habis.
        </p>
      )}

      {confirming ? (
        <div className="grid gap-3">
          <Notice>
            Semua penarikan di semua jaringan akan ditolak sampai <b>{new Date(confirming.until).toLocaleString("id-ID")}</b>. Ini{" "}
            <b>tidak bisa dibatalkan</b> lewat aplikasi. Lanjutkan?
          </Notice>
          <div className="flex gap-3">
            <Button variant="danger" onClick={confirm}>
              Ya, kunci
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Batal
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={review} className="grid gap-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
            <Field label={active ? "Perpanjang: kunci sampai sekarang +" : "Durasi"} error={err}>
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="mis. 7" className={`${inputCls} font-mono`} />
            </Field>
            <div className="grid content-end">
              <div className="grid grid-cols-3 glass-field gap-1 rounded-xl border border-white/10 p-0.5 text-xs" role="group" aria-label="Satuan waktu">
                {(["minute", "hour", "day"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    aria-pressed={unit === u}
                    onClick={() => setUnit(u)}
                    className={`rounded-[10px] px-2.5 py-3 transition-colors duration-300 ${unit === u ? "glass-lens text-zinc-50" : "text-zinc-500 hover:text-zinc-300"}`}
                  >
                    {UNIT_LABEL[u]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Button type="submit" disabled={!value.trim()}>
            {active ? "Perpanjang kunci" : "Kunci semua jaringan"}
          </Button>
        </form>
      )}
    </section>
  );
}
