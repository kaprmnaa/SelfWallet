import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

/**
 * HKDF-SHA256 (RFC 5869) dari hmac+sha256 yang sudah menjadi dependensi: tidak menambah subpath baru.
 * Panjang keluaran 32 byte (satu blok expand).
 */
export function hkdf32(ikm: Uint8Array, info: Uint8Array): Uint8Array {
  const prk = hmac(sha256, new Uint8Array(32), ikm); // extract, salt = nol sepanjang hash
  const t = new Uint8Array(info.length + 1);
  t.set(info);
  t[info.length] = 1;
  return hmac(sha256, prk, t); // expand blok 1
}
