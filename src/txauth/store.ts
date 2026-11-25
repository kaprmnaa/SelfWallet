import { useSyncExternalStore } from "react";
import { load, save, remove } from "../lib/storage";
import { TxAuthError, b64, confirmWithPasskey, enrollPasskey, unb64 } from "./webauthn";

/**
 * Mode kirim + 2FA Face ID per wallet.
 *  - mode "review": alur lama (modal tinjau). "fast": satu klik langsung terkirim (kembali ke modal jika ada peringatan).
 *  - auth: kirim butuh konfirmasi passkey (Face ID). Ditegakkan di fungsi penandatangan lewat bukti sekali pakai.
 * Komitmen di dalam aplikasi: melindungi dari salah klik dan dari orang yang memegang wallet terbuka tanpa wajah Anda,
 * bukan dari kode jahat yang berjalan di origin ini.
 */
export type SendMode = "review" | "fast";
export type TxSettings = { mode: SendMode; auth: boolean };
export type TxIntent = { kind: "evm" | "btc" | "sol" | "zec"; chainId: number; to: string };

const DEFAULT: TxSettings = { mode: "review", auth: false };
type Cred = { cred: string; pub: string; createdAt: number };

const rawS = load<unknown>("txsettings", {});
const rawC = load<unknown>("txauth", {});
let settings: Record<string, TxSettings> = {};
let creds: Record<string, Cred> = {};
if (rawS && typeof rawS === "object") {
  for (const [k, v] of Object.entries(rawS as Record<string, TxSettings>)) {
    if (v && (v.mode === "review" || v.mode === "fast") && typeof v.auth === "boolean") settings[k] = { mode: v.mode, auth: v.auth };
  }
}
if (rawC && typeof rawC === "object") {
  for (const [k, v] of Object.entries(rawC as Record<string, Cred>)) {
    if (v && typeof v.cred === "string" && typeof v.pub === "string") creds[k] = v;
  }
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const persist = () => {
  save("txsettings", settings);
  save("txauth", creds);
  emit();
};

export const walletIdOf = (account: { address: string }) => account.address.toLowerCase();
export const getTxSettings = (id: string): TxSettings => settings[id] ?? DEFAULT;
export const useTxSettings = (id: string): TxSettings => useSyncExternalStore(subscribe, () => getTxSettings(id), () => DEFAULT);

export function setSendMode(id: string, mode: SendMode) {
  settings = { ...settings, [id]: { ...getTxSettings(id), mode } };
  persist();
}

/** Aktifkan 2FA: daftarkan passkey. Panggil LANGSUNG dari gestur sentuhan. */
export async function enableTxAuth(id: string, label: string): Promise<void> {
  const { cred, pub } = await enrollPasskey(label);
  creds = { ...creds, [id]: { cred: b64(cred), pub: b64(pub), createdAt: Date.now() } };
  settings = { ...settings, [id]: { ...getTxSettings(id), auth: true } };
  persist();
}

/** Matikan 2FA. Sendiri membutuhkan konfirmasi Face ID (kecuali passkey memang sudah tidak tercatat). */
export async function disableTxAuth(id: string): Promise<void> {
  const c = creds[id];
  if (c) await confirmWithPasskey(unb64(c.cred), unb64(c.pub));
  const { [id]: _drop, ...rest } = creds;
  void _drop;
  creds = rest;
  settings = { ...settings, [id]: { ...getTxSettings(id), auth: false } };
  persist();
}

/** Hapus semua data mode/2FA satu wallet (dipakai saat wallet dilupakan). */
export function clearTxAuth(id: string) {
  const { [id]: _a, ...s } = settings;
  const { [id]: _b, ...c } = creds;
  void _a;
  void _b;
  settings = s;
  creds = c;
  persist();
}
export function clearAllTxAuth() {
  settings = {};
  creds = {};
  remove("txsettings");
  remove("txauth");
  emit();
}

/* ---------------------------------------------------------------- bukti */

const PROOF_TTL_MS = 120_000;
type Proof = { id: string; kind: TxIntent["kind"]; chainId: number; to: string; exp: number };
let proof: Proof | null = null;

const normTo = (kind: TxIntent["kind"], to: string) => {
  const t = to.trim();
  return kind === "evm" || (kind === "btc" && /^(bc1|tb1|bcrt1)/i.test(t)) ? t.toLowerCase() : t;
};
const matches = (p: Proof, id: string, i: TxIntent) => p.id === id && p.kind === i.kind && p.chainId === i.chainId && p.to === normTo(i.kind, i.to);

/**
 * Minta konfirmasi Face ID jika 2FA aktif (UI). Bukti berlaku 2 menit, sekali pakai, hanya untuk wallet + jaringan + penerima
 * yang sama. Jika bukti segar yang cocok sudah ada, tidak meminta lagi. Panggil dari gestur sentuhan.
 */
export async function requireTxAuth(account: { address: string }, intent: TxIntent): Promise<void> {
  const id = walletIdOf(account);
  if (!getTxSettings(id).auth) return;
  if (proof && matches(proof, id, intent) && proof.exp > Date.now()) return;
  const c = creds[id];
  if (!c) throw new TxAuthError("failed", "Passkey kirim tidak ditemukan. Matikan lalu aktifkan ulang Face ID di bar mode kirim.");
  await confirmWithPasskey(unb64(c.cred), unb64(c.pub));
  proof = { id, kind: intent.kind, chainId: intent.chainId, to: normTo(intent.kind, intent.to), exp: Date.now() + PROOF_TTL_MS };
}

/** Penegak di fungsi penandatangan: 2FA aktif -> wajib ada bukti segar yang cocok; bukti langsung dihabiskan. */
export function assertTxAuthorized(account: { address: string }, intent: TxIntent): void {
  const id = walletIdOf(account);
  if (!getTxSettings(id).auth) return;
  const p = proof;
  if (!p || p.exp <= Date.now() || !matches(p, id, intent)) {
    throw new Error("Butuh konfirmasi Face ID untuk mengirim. Tekan kirim lagi.");
  }
  proof = null;
}
