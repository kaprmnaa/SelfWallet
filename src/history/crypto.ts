import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { base64 } from "@scure/base";
import type { HistoryItem } from "../context/SettingsContext";
import { walletRef } from "../goals/ref";
import { hkdf32 } from "../lib/kdf";

/**
 * Riwayat dienkripsi di perangkat sebelum dikirim ke Supabase (AES-GCM 256).
 * Kunci diturunkan (HKDF) dari private key wallet, jadi perangkat mana pun yang membuka wallet yang sama
 * bisa membacanya, sedangkan server hanya melihat ciphertext + penanda wallet + chain id + waktu.
 * Hash, alamat, jumlah, dan status TIDAK terbaca server.
 */
type Account = { address: string; privateKey: string };

type Keys = { aes: CryptoKey; idKey: Uint8Array; ref: string };

const cache = new WeakMap<object, Promise<Keys>>();

export function keysFor(account: Account): Promise<Keys> {
  let p = cache.get(account);
  if (!p) {
    const ikm = utf8ToBytes(account.privateKey);
    const raw = hkdf32(ikm, utf8ToBytes("kunci-history-aes-v1"));
    const idKey = hkdf32(ikm, utf8ToBytes("kunci-history-id-v1"));
    p = crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]).then((aes) => ({ aes, idKey, ref: walletRef(account) }));
    cache.set(account, p);
  }
  return p;
}

/** ID baris yang opaque tapi deterministik: transaksi yang sama dari dua perangkat jatuh ke baris yang sama. */
export async function rowId(account: Account, item: Pick<HistoryItem, "chainId" | "hash">): Promise<string> {
  const k = await keysFor(account);
  return bytesToHex(hmac(sha256, k.idKey, utf8ToBytes(`${item.chainId}:${item.hash}`))).slice(0, 32);
}

const aad = (ref: string, id: string) => utf8ToBytes(`${ref}:${id}`) as BufferSource;

export async function encryptItem(account: Account, item: HistoryItem): Promise<{ id: string; payload: string }> {
  const k = await keysFor(account);
  const id = await rowId(account, item);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(k.ref, id) }, k.aes, utf8ToBytes(JSON.stringify(item)) as BufferSource),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return { id, payload: base64.encode(out) };
}

const STATUS = ["pending", "success", "failed"] as const;
const short = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Data dari server tidak dipercaya: validasi bentuk dan panjang sebelum masuk ke state/UI. */
export function parseItem(raw: unknown): HistoryItem | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  if (!short(o.hash, 100) || !/^[A-Za-z0-9]+$/.test(o.hash)) return null;
  if (!short(o.from, 100) || !short(o.to, 100) || !short(o.symbol, 16) || !short(o.amount, 40)) return null;
  if (!/^\d+(\.\d+)?$/.test(o.amount)) return null;
  if (typeof o.chainId !== "number" || !Number.isInteger(o.chainId)) return null;
  if (typeof o.ts !== "number" || !Number.isFinite(o.ts)) return null;
  if (!STATUS.includes(o.status as (typeof STATUS)[number])) return null;
  return { hash: o.hash, chainId: o.chainId, from: o.from, to: o.to, amount: o.amount, symbol: o.symbol, ts: o.ts, status: o.status as HistoryItem["status"] };
}

export async function decryptItem(account: Account, id: string, payload: string): Promise<HistoryItem | null> {
  try {
    const k = await keysFor(account);
    const buf = base64.decode(payload);
    if (buf.length < 13 + 16) return null;
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buf.slice(0, 12) as BufferSource, additionalData: aad(k.ref, id) },
      k.aes,
      buf.slice(12) as BufferSource,
    );
    const item = parseItem(JSON.parse(new TextDecoder().decode(pt)));
    // Pastikan baris memang milik transaksi ini (id deterministik dari chainId+hash).
    return item && (await rowId(account, item)) === id ? item : null;
  } catch {
    return null; // kunci berbeda / data rusak: abaikan
  }
}
