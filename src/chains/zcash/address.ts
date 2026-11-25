import { createBase58check } from "@scure/base";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";

/**
 * Alamat Zcash TRANSPARENT (t-address): base58check(prefix 2 byte || hash160). Mainnet: t1 (P2PKH) dan t3 (P2SH).
 * Alamat shielded (zs1…, u1…) membutuhkan bukti zk-SNARK dan TIDAK didukung: ditolak dengan pesan jelas supaya
 * dana tidak salah kirim.
 */
const b58c = createBase58check(sha256);

export const P2PKH_PREFIX = [0x1c, 0xb8]; // "t1"
export const P2SH_PREFIX = [0x1c, 0xbd]; // "t3"

export const hash160 = (b: Uint8Array): Uint8Array => ripemd160(sha256(b));

function encode(prefix: number[], h: Uint8Array): string {
  if (h.length !== 20) throw new Error("hash160 harus 20 byte.");
  const p = new Uint8Array(22);
  p.set(prefix);
  p.set(h, 2);
  return b58c.encode(p);
}
export const encodeP2pkh = (h: Uint8Array) => encode(P2PKH_PREFIX, h);
export const encodeP2sh = (h: Uint8Array) => encode(P2SH_PREFIX, h);

export const p2pkhScript = (h: Uint8Array) => Uint8Array.from([0x76, 0xa9, 0x14, ...h, 0x88, 0xac]);
export const p2shScript = (h: Uint8Array) => Uint8Array.from([0xa9, 0x14, ...h, 0x87]);

export type Recipient = { type: "p2pkh" | "p2sh"; hash: Uint8Array; address: string; script: Uint8Array };

const SHIELDED = /^(zs1|zc|zt|u1|utest|ztestsapling|tex1)/i;

/** Validasi + dekode penerima. Melempar galat berbahasa Indonesia untuk apa pun selain t1…/t3… mainnet. */
export function parseRecipient(raw: string): Recipient {
  const a = raw.trim();
  if (!a) throw new Error("Alamat tidak boleh kosong.");
  if (SHIELDED.test(a)) {
    throw new Error("Alamat shielded/unified Zcash belum didukung. Gunakan alamat transparent (diawali t1 atau t3).");
  }
  let bytes: Uint8Array;
  try {
    bytes = b58c.decode(a);
  } catch {
    throw new Error("Alamat Zcash tidak valid (checksum atau karakter salah). Gunakan alamat transparent t1… atau t3….");
  }
  if (bytes.length !== 22) throw new Error("Alamat Zcash tidak valid (panjang salah).");
  const hash = bytes.slice(2);
  const is = (p: number[]) => bytes[0] === p[0] && bytes[1] === p[1];
  if (is(P2PKH_PREFIX)) return { type: "p2pkh", hash, address: a, script: p2pkhScript(hash) };
  if (is(P2SH_PREFIX)) return { type: "p2sh", hash, address: a, script: p2shScript(hash) };
  throw new Error("Alamat ini bukan alamat transparent Zcash mainnet (t1… atau t3…).");
}
