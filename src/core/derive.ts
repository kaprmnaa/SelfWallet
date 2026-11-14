import { Mnemonic } from "ethers";
import { HDKey } from "@scure/bip32";
import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha512";
import { hexToBytes } from "@noble/hashes/utils";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import * as btc from "@scure/btc-signer";
import type { Account } from "../lib/vault";

/**
 * Satu recovery phrase untuk semua jaringan. Seed BIP-39 dihitung dari mnemonic di dalam
 * keystore (tanpa passphrase BIP-39, sama seperti derivasi EVM di keystore). Seed hanya hidup
 * di memori selama sesi (WeakMap: ikut hilang saat wallet dikunci).
 *
 * Wallet yang diimpor lewat private key tidak punya mnemonic, sehingga Bitcoin/Solana
 * tidak tersedia untuk wallet tersebut.
 */
export const NEED_PHRASE =
  "Wallet ini diimpor dari private key, tanpa recovery phrase. Bitcoin dan Solana hanya tersedia untuk wallet yang dibuat atau diimpor dengan recovery phrase.";

const seedCache = new WeakMap<object, Uint8Array>();

export function getSeed(account: Account): Uint8Array | null {
  const hit = seedCache.get(account);
  if (hit) return hit;
  const phrase = (account as { mnemonic?: { phrase: string } | null }).mnemonic?.phrase;
  if (!phrase) return null;
  const seed = hexToBytes(Mnemonic.fromPhrase(phrase).computeSeed().slice(2));
  seedCache.set(account, seed);
  return seed;
}

/* ------------------------------------------------------------------ Bitcoin */

export type BtcNet = "main" | "test";
export const btcNet = (testnet: boolean): BtcNet => (testnet ? "test" : "main");
export const btcNetwork = (n: BtcNet) => (n === "main" ? btc.NETWORK : btc.TEST_NETWORK);
const coinType = (n: BtcNet) => (n === "main" ? 0 : 1); // BIP-44: testnet memakai coin type 1

/** Path akun BIP-84 (Native SegWit, bc1q / tb1q). */
export const btcAccountPath = (n: BtcNet) => `m/84'/${coinType(n)}'/0'`;

export function btcAccountNode(seed: Uint8Array, n: BtcNet): HDKey {
  return HDKey.fromMasterSeed(seed).derive(btcAccountPath(n));
}

/** branch 0 = alamat terima (external), 1 = kembalian (change). */
export function btcAddressAt(node: HDKey, n: BtcNet, branch: 0 | 1, index: number) {
  const child = node.deriveChild(branch).deriveChild(index);
  if (!child.publicKey) throw new Error("Derivasi Bitcoin gagal.");
  const p2 = btc.p2wpkh(child.publicKey, btcNetwork(n));
  return { branch, index, address: p2.address as string, script: p2.script };
}

export function btcPrivateKeyAt(node: HDKey, branch: 0 | 1, index: number): Uint8Array {
  const k = node.deriveChild(branch).deriveChild(index).privateKey;
  if (!k) throw new Error("Derivasi kunci Bitcoin gagal.");
  return k;
}

/* ------------------------------------------------------------------- Solana */

export const SOL_PATH = "m/44'/501'/0'/0'";
const HARDENED = 0x80000000;

/** SLIP-0010 untuk Ed25519: semua indeks wajib hardened. */
function slip10Ed25519(seed: Uint8Array, path: number[]): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  let k = I.slice(0, 32);
  let c = I.slice(32);
  for (const idx of path) {
    const data = new Uint8Array(37);
    data[0] = 0;
    data.set(k, 1);
    new DataView(data.buffer).setUint32(33, (idx + HARDENED) >>> 0, false);
    I = hmac(sha512, c, data);
    k = I.slice(0, 32);
    c = I.slice(32);
  }
  return k;
}

export type SolAccount = { address: string; publicKey: Uint8Array; privateKey: Uint8Array };
const solCache = new WeakMap<object, SolAccount>();

export function solAccount(account: Account): SolAccount | null {
  const hit = solCache.get(account);
  if (hit) return hit;
  const seed = getSeed(account);
  if (!seed) return null;
  const privateKey = slip10Ed25519(seed, [44, 501, 0, 0]);
  const publicKey = ed25519.getPublicKey(privateKey);
  const acc = { address: base58.encode(publicKey), publicKey, privateKey };
  solCache.set(account, acc);
  return acc;
}
