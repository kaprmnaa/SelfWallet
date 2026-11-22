import { useEffect, useState } from "react";
import { utf8ToBytes } from "@noble/hashes/utils";
import { base64 } from "@scure/base";
import { hkdf32 } from "./kdf";
import { load, remove, save } from "./storage";

/**
 * Buka wallet dengan Face ID / Touch ID (WebAuthn + ekstensi PRF).
 *
 * Cara kerja: passkey platform (Secure Enclave) menghasilkan rahasia 32 byte (PRF) HANYA setelah verifikasi biometrik.
 * Rahasia itu menjadi kunci AES-GCM yang mengenkripsi password vault. Yang tersimpan di browser hanya ciphertext
 * password + id passkey + salt. Kuncinya sendiri tidak pernah disimpan, jadi isi penyimpanan saja tidak cukup untuk
 * membuka wallet. Butuh iOS/Safari 18+ (PRF).
 *
 * Mode "gate" (cadangan untuk iOS 16-17 tanpa PRF): web TIDAK punya API biometrik selain passkey, dan tanpa PRF passkey
 * tidak menghasilkan rahasia, hanya bukti kehadiran. Maka kunci AES dibuat tak-dapat-diekspor (non-extractable) dan
 * disimpan di IndexedDB; Face ID menjadi gerbang di aplikasi sebelum kunci itu dipakai. Ini LEBIH LEMAH: melindungi dari
 * penyalinan data penyimpanan, bukan dari kode yang berjalan di origin ini (XSS/ekstensi jahat).
 */

type Entry = { cred: string; salt?: string; blob: string; mode?: "gate" };
const KEY = "biometric";
const readAll = () => load<Record<string, Entry>>(KEY, {});

export const hasBiometric = (walletId: string) => !!readAll()[walletId];

export const biometricMode = (walletId: string): "prf" | "gate" | null => {
  const e = readAll()[walletId];
  return e ? (e.mode === "gate" ? "gate" : "prf") : null;
};

export function removeBiometric(walletId: string) {
  const m = readAll();
  delete m[walletId];
  if (Object.keys(m).length > 0) save(KEY, m);
  else remove(KEY);
  void idbDel(walletId).catch(() => {});
}

/** Hapus semua data biometrik (dipakai saat semua wallet tersimpan dihapus). */
export function clearBiometric() {
  remove(KEY);
  try {
    indexedDB.deleteDatabase(IDB_NAME);
  } catch {
    /* diabaikan */
  }
}

/* ----------------------------------------------- IndexedDB (kunci mode gate) */

const IDB_NAME = "kunci-bio";
const idb = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("keys");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
async function idbRun<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  try {
    return await new Promise<T>((res, rej) => {
      const req = f(db.transaction("keys", mode).objectStore("keys"));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  } finally {
    db.close();
  }
}
const idbPut = (id: string, key: CryptoKey) => idbRun("readwrite", (s) => s.put(key, id));
const idbGet = (id: string) => idbRun<CryptoKey | undefined>("readonly", (s) => s.get(id));
const idbDel = (id: string) => idbRun("readwrite", (s) => s.delete(id));

export type BiometricErrorCode = "unsupported" | "cancelled" | "invalid" | "failed";
export class BiometricError extends Error {
  constructor(
    public code: BiometricErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function biometricName(): string {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "Face ID" : "Biometrik";
}

/** Apakah perangkat/browser ini bisa dipakai (perkiraan; dukungan PRF dipastikan saat pendaftaran). */
export async function biometricSupported(): Promise<boolean> {
  try {
    if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) return false;
    const pkc = window.PublicKeyCredential as unknown as {
      isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
    };
    // Cukup ada autentikator platform (Face ID/Touch ID). PRF (iOS 18+) hanya menentukan mode penuh vs mode dasar.
    return !!(await pkc.isUserVerifyingPlatformAuthenticatorAvailable?.());
  } catch {
    return false;
  }
}

export function useBiometricSupport(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    void biometricSupported().then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, []);
  return ok;
}

/* ------------------------------------------------------- enkripsi password */

const aad = (walletId: string) => utf8ToBytes(`kunci-biometric:${walletId}`) as BufferSource;

export async function keyFromSecret(secret: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  const raw = hkdf32(new Uint8Array(secret as ArrayBuffer), utf8ToBytes("kunci-biometric-v1"));
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealPassword(key: CryptoKey, walletId: string, password: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(walletId) }, key, utf8ToBytes(password) as BufferSource));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return base64.encode(out);
}

export async function openPassword(key: CryptoKey, walletId: string, blob: string): Promise<string> {
  const buf = base64.decode(blob);
  if (buf.length < 13 + 16) throw new Error("rusak");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buf.slice(0, 12) as BufferSource, additionalData: aad(walletId) },
    key,
    buf.slice(12) as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

/* ---------------------------------------------------------------- WebAuthn */

type PrfExt = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function mapError(e: unknown): BiometricError {
  if (e instanceof BiometricError) return e;
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return new BiometricError("cancelled", "Dibatalkan.");
  if (name === "NotSupportedError" || name === "SecurityError" || name === "InvalidStateError") {
    return new BiometricError("unsupported", "Perangkat atau browser ini belum mendukung membuka wallet dengan biometrik (butuh iOS/Safari 18+ dan HTTPS).");
  }
  return new BiometricError("failed", "Verifikasi biometrik gagal.");
}

/** Verifikasi biometrik saja (tanpa PRF). Dipakai mode gate. */
async function assertPresence(cred: Uint8Array): Promise<void> {
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: rnd(32),
        rpId: location.hostname,
        allowCredentials: [{ type: "public-key", id: cred as BufferSource, transports: ["internal"] }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    if (!res) throw new BiometricError("failed", "Verifikasi biometrik gagal.");
  } catch (e) {
    throw mapError(e);
  }
}

async function getSecret(cred: Uint8Array, salt: Uint8Array): Promise<ArrayBuffer> {
  try {
    const res = (await navigator.credentials.get({
      publicKey: {
        challenge: rnd(32),
        rpId: location.hostname,
        allowCredentials: [{ type: "public-key", id: cred as BufferSource, transports: ["internal"] }],
        userVerification: "required",
        timeout: 60_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    const secret = (res?.getClientExtensionResults() as PrfExt | undefined)?.prf?.results?.first;
    if (!secret) throw new BiometricError("unsupported", "Perangkat ini belum mendukung membuka wallet dengan biometrik (butuh iOS/Safari 18+).");
    return secret;
  } catch (e) {
    throw mapError(e);
  }
}

export type PendingEnroll = { mode: "prf"; cred: Uint8Array; salt: Uint8Array; key: CryptoKey } | { mode: "gate"; cred: Uint8Array; key: CryptoKey };

/**
 * Langkah 1: buat passkey + turunkan kunci. HARUS dipanggil langsung dari gestur sentuhan (Safari menolak WebAuthn
 * jika sudah lewat proses lama seperti scrypt). Belum menyimpan apa pun.
 */
export async function beginEnroll(label: string): Promise<PendingEnroll> {
  const salt = rnd(32);
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: "Kunci", id: location.hostname },
        user: { id: rnd(16), name: label, displayName: label },
        challenge: rnd(32),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
        attestation: "none",
        timeout: 60_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!cred) throw new BiometricError("failed", "Verifikasi biometrik gagal.");
    const id = new Uint8Array(cred.rawId);
    const prf = (cred.getClientExtensionResults() as PrfExt).prf;
    if (prf?.results?.first) return { mode: "prf", cred: id, salt, key: await keyFromSecret(prf.results.first) };
    if (prf?.enabled) {
      // Safari memberi rahasia PRF baru pada permintaan kedua.
      try {
        return { mode: "prf", cred: id, salt, key: await keyFromSecret(await getSecret(id, salt)) };
      } catch (e) {
        if (!(e instanceof BiometricError && e.code === "unsupported")) throw e;
      }
    }
    // PRF tidak tersedia (iOS < 18): mode gate dengan kunci tak-dapat-diekspor.
    return { mode: "gate", cred: id, key: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]) };
  } catch (e) {
    throw mapError(e);
  }
}

/** Langkah 2 (setelah password terbukti benar): simpan password terenkripsi untuk wallet ini. */
export async function sealEnroll(p: PendingEnroll, walletId: string, password: string): Promise<void> {
  const blob = await sealPassword(p.key, walletId, password);
  if (p.mode === "gate") {
    await idbPut(walletId, p.key);
    save(KEY, { ...readAll(), [walletId]: { cred: base64.encode(p.cred), blob, mode: "gate" } });
    return;
  }
  save(KEY, { ...readAll(), [walletId]: { cred: base64.encode(p.cred), salt: base64.encode(p.salt), blob } });
}

/** Tampilkan Face ID dan kembalikan password vault. Panggil langsung dari gestur sentuhan. */
export async function biometricPassword(walletId: string): Promise<string> {
  const e = readAll()[walletId];
  if (!e) throw new BiometricError("invalid", "Face ID belum diaktifkan untuk wallet ini.");
  const cred = base64.decode(e.cred);
  try {
    if (e.mode === "gate") {
      await assertPresence(cred);
      const key = await idbGet(walletId);
      if (!key) throw new Error("kunci hilang");
      return await openPassword(key, walletId, e.blob);
    }
    const secret = await getSecret(cred, base64.decode(e.salt ?? ""));
    return await openPassword(await keyFromSecret(secret), walletId, e.blob);
  } catch (err) {
    if (err instanceof BiometricError && err.code !== "invalid") throw err; // dibatalkan / tidak didukung: jangan buang data

    // Passkey dihapus/diganti: data lama tidak bisa dibuka lagi.
    throw new BiometricError("invalid", "Face ID tidak lagi valid. Masukkan password.");
  }
}
