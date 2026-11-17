import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/**
 * Penanda wallet untuk goal: HMAC-SHA256(kunci turunan dari private key, "evm:" + alamat), dipotong 32 hex.
 * Hanya pemilik wallet yang bisa menghitungnya (perangkat mana pun yang membuka wallet yang sama menghasilkan
 * nilai yang sama), dan tidak bisa dibalik menjadi alamat. Dengan begitu data goal di Supabase tidak
 * menautkan akun email Anda ke alamat on-chain.
 */
const cache = new WeakMap<object, string>();

export function walletRef(account: { address: string; privateKey: string }): string {
  const hit = cache.get(account);
  if (hit) return hit;
  const key = sha256(utf8ToBytes(`kunci-goal-ref-v1:${account.privateKey}`));
  const ref = bytesToHex(hmac(sha256, key, utf8ToBytes(`evm:${account.address.toLowerCase()}`))).slice(0, 32);
  cache.set(account, ref);
  return ref;
}
