import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { AnimatePresence, m } from "framer-motion";
import { DownloadSimple, Eye, EyeSlash, Key, UploadSimple, Warning } from "@phosphor-icons/react";
import type { HDNodeWallet } from "ethers";
import { isKeystoreJson } from "ethers";
import { useWallet } from "../context/WalletContext";
import {
  accountFromPhrase,
  accountFromPrivateKey,
  createAccount,
  encryptAccount,
  passwordStrength,
  unlockKeystore,
  type Account,
} from "../lib/vault";
import { downloadText, errMsg, shortAddr } from "../lib/format";
import {
  cleanName,
  loadWallets,
  removeSaved,
  saveWallet,
  suggestName,
  type SavedWallet,
} from "../lib/vaultStore";
import ChainTicker from "./ChainTicker";
import WalletAvatar from "./WalletAvatar";
import {
  Button,
  Field,
  Magnetic,
  Notice,
  PasswordMeter,
  ProgressBar,
  Tabs,
  inputCls,
  spring,
} from "./ui";

type Mode = "unlock" | "create" | "import";

const MODES: { key: Mode; label: string }[] = [
  { key: "unlock", label: "Buka" },
  { key: "create", label: "Buat baru" },
  { key: "import", label: "Impor" },
];

const POINTS = [
  "Keystore terenkripsi scrypt, tersimpan sebagai file di tangan Anda.",
  "Kunci hanya hidup di memori tab ini dan terkunci otomatis setelah 5 menit tanpa aktivitas.",
  "Mulai di testnet. Pindah ke mainnet hanya saat Anda siap.",
];

type DoneProps = { onDone?: () => void };

export default function Onboarding() {
  const [mode, setMode] = useState<Mode>("unlock");
  return (
    <main className="grid min-h-[100dvh] overflow-x-clip lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section className="flex min-w-0 flex-col justify-between gap-16 px-6 py-10 sm:px-12 lg:px-20 lg:py-16">
        <div className="flex items-center gap-3 text-zinc-50">
          <span className="grid size-9 place-items-center rounded-xl border border-white/10 bg-zinc-900 text-accent">
            <Key />
          </span>
          <span className="text-lg font-medium tracking-tight">Kunci</span>
        </div>

        <div className="max-w-[54ch]">
          <m.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
            className="text-4xl font-medium leading-none tracking-tighter text-zinc-50 md:text-5xl"
          >
            Kunci privat tetap di perangkat Anda.
          </m.h1>
          <m.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.08 }}
            className="mt-6 max-w-[65ch] text-base leading-relaxed text-zinc-400"
          >
            Dompet self-custody multi-wallet untuk Ethereum, BNB Smart Chain, Polygon, Base, dan jaringan kustom.
            Server tidak pernah menerima recovery phrase, private key, maupun password.
          </m.p>
          <m.ul
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } } }}
            className="mt-10 divide-y divide-white/[0.06] border-y border-white/[0.06]"
          >
            {POINTS.map((p) => (
              <m.li
                key={p}
                variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: spring } }}
                className="py-4 text-sm leading-relaxed text-zinc-300"
              >
                {p}
              </m.li>
            ))}
          </m.ul>
        </div>

        <ChainTicker />
      </section>

      <section className="flex min-w-0 items-center border-t border-white/[0.06] px-6 py-12 sm:px-12 lg:border-l lg:border-t-0 lg:px-14">
        <div className="w-full max-w-md">
          <Tabs items={MODES} value={mode} onChange={setMode} id="onboard" />
          <AnimatePresence mode="wait">
            <m.div
              key={mode}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={spring}
              className="pt-8"
            >
              {mode === "unlock" && <UnlockForm />}
              {mode === "create" && <CreateFlow />}
              {mode === "import" && <ImportFlow />}
            </m.div>
          </AnimatePresence>
        </div>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------ Nama wallet */

function NameField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <Field label="Nama wallet" hint="Contoh: Main A, Trading, Tabungan. Maksimal 24 karakter.">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={24}
        placeholder={placeholder}
        autoComplete="off"
        className={inputCls}
      />
    </Field>
  );
}

/* ---------------------------------------------------------------- Buka */

export function UnlockForm({ onDone }: DoneProps) {
  const { addSession, sessions } = useWallet();
  const [saved, setSaved] = useState<SavedWallet[]>(() =>
    loadWallets().filter((w) => !sessions.some((s) => s.id === w.id)),
  );
  const [selId, setSelId] = useState<string | null>(() => saved[0]?.id ?? null);
  const [useFile, setUseFile] = useState(false);
  const [json, setJson] = useState("");
  const [fileName, setFileName] = useState("");
  const [remember, setRemember] = useState(true);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const suggested = useMemo(() => suggestName(sessions.map((s) => s.name)), [sessions]);

  const selected = saved.find((w) => w.id === selId) ?? null;
  const fromSaved = !!selected && !useFile;
  const activeJson = fromSaved ? selected!.json : json;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr("");
    if (f.size > 200_000) return setErr("File terlalu besar untuk sebuah keystore.");
    const text = await f.text();
    if (!isKeystoreJson(text)) return setErr("File ini bukan keystore JSON yang valid.");
    setJson(text);
    setFileName(f.name);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setProgress(0);
    try {
      const a = await unlockKeystore(activeJson, pw, (p) => setProgress(p));
      let name = fromSaved ? selected!.name : suggested;
      if (!fromSaved && remember) name = saveWallet(a.address, activeJson, suggested).name;
      setPw("");
      addSession(a, name);
      onDone?.();
    } catch {
      setErr("Password salah atau file keystore rusak.");
      setProgress(null);
    }
  }

  function forget() {
    if (!selected) return;
    removeSaved(selected.id);
    const rest = saved.filter((w) => w.id !== selected.id);
    setSaved(rest);
    setSelId(rest[0]?.id ?? null);
    setErr("");
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      {fromSaved ? (
        <div className="grid gap-2" role="radiogroup" aria-label="Wallet tersimpan di browser ini">
          <p className="text-xs font-medium tracking-wide text-zinc-400">Wallet tersimpan di browser ini</p>
          {saved.map((w) => {
            const on = w.id === selId;
            return (
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setSelId(w.id);
                  setErr("");
                }}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors duration-300 ${
                  on ? "border-accent/50 bg-white/[0.04]" : "border-white/10 hover:bg-white/[0.03]"
                }`}
              >
                <WalletAvatar seed={w.id} label={w.name} size={34} />
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate text-sm text-zinc-100">{w.name}</span>
                  <span className="font-mono text-xs text-zinc-500">{shortAddr(w.address)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <Field label="File keystore" hint="Berkas .json hasil backup dari wallet Anda." error={!json ? err : undefined}>
            <span className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-white/15 px-4 py-4 text-sm text-zinc-400 transition-colors duration-300 hover:border-accent/50 hover:text-zinc-200">
              <UploadSimple />
              <span className="truncate">{fileName || "Pilih file keystore"}</span>
              <input type="file" accept=".json,application/json" onChange={onFile} className="sr-only" />
            </span>
          </Field>
          <label className="flex items-start gap-3 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-1 size-4 accent-[#5fb396]"
            />
            Ingat keystore terenkripsi di browser ini, sehingga setelah refresh cukup memasukkan password.
          </label>
        </>
      )}
      <Field label={fromSaved ? `Password ${selected!.name}` : "Password vault"} error={activeJson ? err : undefined}>
        <input
          type="password"
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className={inputCls}
          placeholder="Password saat keystore dibuat"
        />
      </Field>
      {progress !== null && (
        <div className="grid gap-2">
          <ProgressBar value={progress} />
          <span className="text-xs text-zinc-500">Mendekripsi di perangkat ini. Proses scrypt sengaja lambat.</span>
        </div>
      )}
      <Magnetic>
        <Button type="submit" disabled={!activeJson || !pw} busy={progress !== null} className="w-full">
          {progress !== null ? "Membuka…" : "Buka dompet"}
        </Button>
      </Magnetic>
      {saved.length > 0 && (
        <div className="flex items-center justify-between gap-4 text-xs">
          <button
            type="button"
            onClick={() => {
              setUseFile((f) => !f);
              setErr("");
            }}
            className="text-zinc-400 transition-colors duration-300 hover:text-zinc-100"
          >
            {useFile ? "Pakai wallet tersimpan" : "Pakai file keystore lain"}
          </button>
          {fromSaved && (
            <button type="button" onClick={forget} className="text-zinc-500 transition-colors duration-300 hover:text-rose-300">
              Lupakan {selected!.name}
            </button>
          )}
        </div>
      )}
    </form>
  );
}

/* ---------------------------------------------------------- Buat baru */

type Step = "password" | "phrase" | "verify" | "backup";

function pickIndices(n: number, count: number) {
  const set = new Set<number>();
  const buf = new Uint32Array(1);
  while (set.size < count) {
    crypto.getRandomValues(buf);
    set.add(buf[0] % n);
  }
  return [...set].sort((a, b) => a - b);
}

export function CreateFlow({ onDone }: DoneProps) {
  const { addSession, sessions } = useWallet();
  const suggested = useMemo(() => suggestName(sessions.map((s) => s.name)), [sessions]);
  const [step, setStep] = useState<Step>("password");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [acct, setAcct] = useState<HDNodeWallet | null>(null);
  const [shown, setShown] = useState(false);
  const [idx, setIdx] = useState<number[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);

  const words = useMemo(() => acct?.mnemonic?.phrase.split(" ") ?? [], [acct]);
  const finalName = cleanName(name) || suggested;

  function start(e: FormEvent) {
    e.preventDefault();
    if (!passwordStrength(pw).ok) return setErr("Password belum cukup kuat.");
    if (pw !== pw2) return setErr("Konfirmasi password tidak sama.");
    setErr("");
    setAcct(createAccount());
    setStep("phrase");
  }

  function toVerify() {
    setIdx(pickIndices(words.length, 3));
    setAnswers(["", "", ""]);
    setErr("");
    setStep("verify");
  }

  function verify(e: FormEvent) {
    e.preventDefault();
    const ok = idx.every((w, i) => answers[i].trim().toLowerCase() === words[w]);
    if (!ok) return setErr("Ada kata yang tidak cocok. Periksa catatan Anda lalu coba lagi.");
    setErr("");
    setStep("backup");
  }

  if (step === "password") {
    return (
      <form onSubmit={start} className="grid gap-5">
        <NameField value={name} onChange={setName} placeholder={suggested} />
        <Field label="Password vault" hint="Mengenkripsi file keystore. Tidak dikirim ke mana pun dan tidak bisa dipulihkan.">
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} />
        </Field>
        <PasswordMeter value={pw} />
        <Field label="Ulangi password" error={err}>
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={inputCls} />
        </Field>
        <Magnetic>
          <Button type="submit" disabled={!pw || !pw2} className="w-full">
            Buat wallet
          </Button>
        </Magnetic>
      </form>
    );
  }

  if (step === "phrase") {
    return (
      <div className="grid gap-5">
        <div>
          <h2 className="text-lg font-medium tracking-tight text-zinc-50">Recovery phrase {finalName}</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Tulis 12 kata ini di kertas, sesuai urutan. Siapa pun yang memilikinya menguasai seluruh dana Anda.
          </p>
        </div>
        <ol
          className={`grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-white/10 p-5 font-mono text-sm text-zinc-100 transition-[filter] duration-500 sm:grid-cols-3 ${
            shown ? "" : "select-none blur-md"
          }`}
          aria-hidden={!shown}
        >
          {words.map((w, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-5 text-right text-zinc-600">{i + 1}</span>
              {w}
            </li>
          ))}
        </ol>
        <Button variant="ghost" onClick={() => setShown((s) => !s)}>
          {shown ? <EyeSlash /> : <Eye />}
          {shown ? "Sembunyikan" : "Tampilkan"}
        </Button>
        <Notice>
          Jangan screenshot, jangan simpan di cloud, catatan, atau chat. Tidak ada yang berhak memintanya, termasuk
          aplikasi ini.
        </Notice>
        <Button onClick={toVerify} disabled={!shown}>
          Saya sudah menulisnya
        </Button>
      </div>
    );
  }

  if (step === "verify") {
    return (
      <form onSubmit={verify} className="grid gap-5">
        <div>
          <h2 className="text-lg font-medium tracking-tight text-zinc-50">Verifikasi catatan</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">Isi tiga kata berikut dari kertas Anda.</p>
        </div>
        {idx.map((w, i) => (
          <Field key={w} label={`Kata nomor ${w + 1}`} error={i === idx.length - 1 ? err : undefined}>
            <input
              value={answers[i]}
              onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
          </Field>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="ghost" onClick={() => setStep("phrase")}>
            Kembali
          </Button>
          <Button type="submit" disabled={answers.some((a) => !a.trim())}>
            Verifikasi
          </Button>
        </div>
      </form>
    );
  }

  return (
    <BackupStep
      account={acct!}
      password={pw}
      name={finalName}
      onEnter={(n) => {
        addSession(acct!, n);
        onDone?.();
      }}
    />
  );
}

/* -------------------------------------------------------------- Impor */

export function ImportFlow({ onDone }: DoneProps) {
  const { addSession, sessions } = useWallet();
  const suggested = useMemo(() => suggestName(sessions.map((s) => s.name)), [sessions]);
  const [kind, setKind] = useState<"phrase" | "key">("phrase");
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [acct, setAcct] = useState<Account | null>(null);
  const finalName = cleanName(name) || suggested;

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (!passwordStrength(pw).ok) return setErr("Password belum cukup kuat.");
    if (pw !== pw2) return setErr("Konfirmasi password tidak sama.");
    try {
      setAcct(kind === "phrase" ? accountFromPhrase(secret) : accountFromPrivateKey(secret));
      setSecret("");
    } catch (ex) {
      setErr(errMsg(ex));
    }
  }

  if (acct) {
    return (
      <BackupStep
        account={acct}
        password={pw}
        name={finalName}
        onEnter={(n) => {
          addSession(acct, n);
          onDone?.();
        }}
      />
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <NameField value={name} onChange={setName} placeholder={suggested} />
      <div className="flex gap-2 text-xs">
        {(
          [
            ["phrase", "Recovery phrase"],
            ["key", "Private key"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setSecret("");
              setErr("");
            }}
            className={`rounded-lg border px-3 py-2 transition-colors duration-300 ${
              kind === k ? "border-accent/50 text-zinc-50" : "border-white/10 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      <Field
        label={kind === "phrase" ? "Recovery phrase" : "Private key"}
        hint={kind === "phrase" ? "12 sampai 24 kata, dipisah spasi. Akun pertama (indeks 0) yang diimpor." : "64 karakter heksadesimal, dengan atau tanpa 0x."}
      >
        {kind === "phrase" ? (
          <textarea
            rows={3}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className={`${inputCls} resize-none font-mono`}
          />
        ) : (
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={`${inputCls} font-mono`}
          />
        )}
      </Field>
      <Field label="Password vault baru" hint="Dipakai untuk mengenkripsi keystore dari akun yang diimpor.">
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} />
      </Field>
      <PasswordMeter value={pw} />
      <Field label="Ulangi password" error={err}>
        <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={inputCls} />
      </Field>
      <Magnetic>
        <Button type="submit" disabled={!secret.trim() || !pw || !pw2} className="w-full">
          Impor dan enkripsi
        </Button>
      </Magnetic>
    </form>
  );
}

/* ----------------------------------------------------- Backup keystore */

function BackupStep({
  account,
  password,
  name,
  onEnter,
}: {
  account: Account;
  password: string;
  name: string;
  onEnter: (finalName: string) => void;
}) {
  const [json, setJson] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [ack, setAck] = useState(false);
  const [remember, setRemember] = useState(true);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // cegah enkripsi ganda di StrictMode
    started.current = true;
    encryptAccount(account, password, setProgress)
      .then(setJson)
      .catch((e) => setErr(errMsg(e)));
  }, [account, password]);

  function download() {
    if (!json) return;
    downloadText(`kunci-keystore-${account.address.slice(2, 8).toLowerCase()}.json`, json);
    setSaved(true);
  }

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-lg font-medium tracking-tight text-zinc-50">Backup keystore {name}</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          File ini adalah satu-satunya salinan terenkripsi dompet Anda di perangkat. Simpan di tempat terpisah dari
          recovery phrase.
        </p>
      </div>

      {err ? (
        <Notice>
          <Warning className="mr-2 inline" />
          {err}
        </Notice>
      ) : !json ? (
        <div className="grid gap-2">
          <ProgressBar value={progress} />
          <span className="text-xs text-zinc-500">Mengenkripsi dengan scrypt, mohon tunggu.</span>
        </div>
      ) : (
        <>
          <p className="break-all rounded-xl border border-white/10 px-4 py-3 font-mono text-xs text-zinc-300">
            {account.address}
          </p>
          <Button variant="ghost" onClick={download}>
            <DownloadSimple />
            Unduh keystore.json
          </Button>
          <label className="flex items-start gap-3 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-1 size-4 accent-[#5fb396]"
            />
            Saya sudah menyimpan keystore dan mengerti bahwa password tidak bisa dipulihkan.
          </label>
          <label className="flex items-start gap-3 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-1 size-4 accent-[#5fb396]"
            />
            Ingat keystore terenkripsi di browser ini, sehingga setelah refresh cukup memasukkan password.
          </label>
          <Button
            onClick={() => {
              const finalName = remember && json ? saveWallet(account.address, json, name).name : name;
              onEnter(finalName);
            }}
            disabled={!saved || !ack}
          >
            Masuk ke dompet
          </Button>
        </>
      )}
    </div>
  );
}
