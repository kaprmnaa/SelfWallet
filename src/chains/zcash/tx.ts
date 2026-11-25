import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils";
import { secp256k1 } from "@noble/curves/secp256k1";

/**
 * Transaksi Zcash transparent-only, format v5 (ZIP-225) dengan tanda tangan SIGHASH_ALL menurut ZIP-244.
 * Fee: ZIP-317 (5000 zatoshi per "aksi logis", minimal 2 aksi).
 * Semua fungsi murni (tanpa jaringan) supaya mudah diuji. Hanya transaksi transparent (tanpa Sapling/Orchard).
 */

export const MARGINAL_FEE = 5000n;
export const GRACE_ACTIONS = 2;
/** Output terkecil yang dikirim, dan sisa kembalian terkecil yang dibuat (di bawahnya masuk ke fee). */
export const MIN_OUTPUT = 10_000n;
export const MIN_CHANGE = 10_000n;
export const MAX_INPUTS = 150;
export const SEQUENCE = 0xffffffff;

export type ZInput = { txid: string; vout: number; value: bigint; script: Uint8Array };
export type ZOutput = { value: bigint; script: Uint8Array };
export type ZTx = { branchId: number; lockTime: number; expiryHeight: number; inputs: ZInput[]; outputs: ZOutput[] };

/* ------------------------------------------------------------------ fee */

/** ZIP-317: input/output P2PKH standar = 1 aksi logis masing-masing; fee = 5000 x max(2, aksi). */
export const zip317Fee = (nIn: number, nOut: number): bigint => MARGINAL_FEE * BigInt(Math.max(GRACE_ACTIONS, nIn, nOut));

export type Plan = { inputs: { txid: string; vout: number; value: bigint }[]; amount: bigint; fee: bigint; change: bigint };

/**
 * Pilih UTXO (terbesar dulu) dan hitung fee + kembalian. Invarian: total input = jumlah + fee + kembalian.
 * Kembalian di bawah MIN_CHANGE tidak dibuat (masuk ke fee, selalu < MIN_CHANGE).
 */
export function planSpend(utxos: { txid: string; vout: number; value: bigint }[], amount: bigint, max: boolean): Plan {
  const sorted = [...utxos].filter((u) => u.value > 0n).sort((a, b) => (a.value < b.value ? 1 : a.value > b.value ? -1 : 0));
  if (sorted.length === 0) throw new Error("Tidak ada dana terkonfirmasi yang bisa dibelanjakan.");

  if (max) {
    if (sorted.length > MAX_INPUTS) throw new Error(`Terlalu banyak UTXO (${sorted.length}) untuk satu transaksi (maks ${MAX_INPUTS}). Kirim jumlah lebih kecil.`);
    const total = sorted.reduce((s, u) => s + u.value, 0n);
    const fee = zip317Fee(sorted.length, 1);
    const sendable = total - fee;
    if (sendable < MIN_OUTPUT) throw new Error("Saldo terlalu kecil setelah fee.");
    return { inputs: sorted, amount: sendable, fee, change: 0n };
  }

  if (amount < MIN_OUTPUT) throw new Error("Jumlah terlalu kecil (minimal 0.0001 ZEC).");
  let sum = 0n;
  for (let k = 1; k <= sorted.length; k++) {
    if (k > MAX_INPUTS) throw new Error(`Terlalu banyak UTXO untuk satu transaksi (maks ${MAX_INPUTS}). Gabungkan dana dengan mengirim ke diri sendiri bertahap.`);
    sum += sorted[k - 1].value;
    const feeNo = zip317Fee(k, 1);
    if (sum < amount + feeNo) continue;
    const feeCh = zip317Fee(k, 2);
    const rem = sum - amount - feeCh;
    if (rem >= MIN_CHANGE) return { inputs: sorted.slice(0, k), amount, fee: feeCh, change: rem };
    return { inputs: sorted.slice(0, k), amount, fee: sum - amount, change: 0n }; // tanpa kembalian
  }
  throw new Error("Saldo tidak cukup untuk jumlah + fee.");
}

/* ------------------------------------------------------------ penyandian */

const te = new TextEncoder();
export const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
};
export const i64 = (n: bigint) => {
  if (n < 0n || n > 0x7fffffffffffffffn) throw new Error("Nilai di luar jangkauan.");
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, n, true);
  return b;
};
export function compactSize(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  return concatBytes(Uint8Array.of(0xfe), u32(n));
}
const withLen = (b: Uint8Array) => concatBytes(compactSize(b.length), b);

function prevout(i: ZInput): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(i.txid)) throw new Error("txid tidak valid.");
  return concatBytes(hexToBytes(i.txid).reverse(), u32(i.vout));
}

const HEADER = 0x80000005; // versi 5 | bit overwintered
const VERSION_GROUP_ID = 0x26a7270a;

export function serializeV5(tx: ZTx, scriptSigs: (Uint8Array | null)[]): Uint8Array {
  if (scriptSigs.length !== tx.inputs.length) throw new Error("scriptSig tidak lengkap.");
  const parts: Uint8Array[] = [u32(HEADER), u32(VERSION_GROUP_ID), u32(tx.branchId), u32(tx.lockTime), u32(tx.expiryHeight)];
  parts.push(compactSize(tx.inputs.length));
  tx.inputs.forEach((i, k) => parts.push(prevout(i), withLen(scriptSigs[k] ?? new Uint8Array(0)), u32(SEQUENCE)));
  parts.push(compactSize(tx.outputs.length));
  for (const o of tx.outputs) parts.push(i64(o.value), withLen(o.script));
  parts.push(Uint8Array.of(0, 0, 0)); // Sapling: 0 spend, 0 output; Orchard: 0 action
  return concatBytes(...parts);
}

/** Bongkar kembali transaksi v5 transparent-only (untuk memverifikasi isinya sebelum disiarkan). */
export function parseV5(raw: Uint8Array) {
  let p = 0;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const need = (n: number) => {
    if (p + n > raw.length) throw new Error("Transaksi rusak.");
  };
  const rd32 = () => (need(4), (p += 4), dv.getUint32(p - 4, true));
  const rdCs = () => {
    need(1);
    const f = raw[p++];
    if (f < 0xfd) return f;
    if (f === 0xfd) return (need(2), (p += 2), dv.getUint16(p - 2, true));
    if (f === 0xfe) return rd32();
    throw new Error("compactSize terlalu besar.");
  };
  const rdBytes = (n: number) => (need(n), (p += n), raw.slice(p - n, p));

  const header = rd32();
  const versionGroupId = rd32();
  const branchId = rd32();
  const lockTime = rd32();
  const expiryHeight = rd32();
  const nIn = rdCs();
  const inputs: { txid: string; vout: number; scriptSigLen: number; sequence: number }[] = [];
  for (let i = 0; i < nIn; i++) {
    const txid = bytesToHex(rdBytes(32).reverse());
    const vout = rd32();
    const scriptSigLen = rdCs();
    rdBytes(scriptSigLen);
    inputs.push({ txid, vout, scriptSigLen, sequence: rd32() });
  }
  const nOut = rdCs();
  const outputs: ZOutput[] = [];
  for (let i = 0; i < nOut; i++) {
    need(8);
    const value = dv.getBigInt64(p, true);
    p += 8;
    outputs.push({ value, script: rdBytes(rdCs()) });
  }
  const tail = rdBytes(3);
  if (p !== raw.length) throw new Error("Ada data berlebih di akhir transaksi.");
  return { header, versionGroupId, branchId, lockTime, expiryHeight, inputs, outputs, shieldedEmpty: tail.every((b) => b === 0) };
}

/* ----------------------------------------------------- tanda tangan ZIP-244 */

function pers(s: string): Uint8Array {
  const b = te.encode(s);
  if (b.length > 16) throw new Error("personalization terlalu panjang.");
  const out = new Uint8Array(16); // BLAKE2b: padding nol hingga 16 byte
  out.set(b);
  return out;
}
const H = (p: string, data: Uint8Array) => blake2b(data, { dkLen: 32, personalization: pers(p) });

/** Digest SIGHASH_ALL untuk input ke-`idx` (ZIP-244 S.2, tanpa Sapling/Orchard). */
export function sigHashV5(tx: ZTx, idx: number): Uint8Array {
  const input = tx.inputs[idx];
  if (!input) throw new Error("Indeks input tidak ada.");
  const header = H("ZTxIdHeadersHash", concatBytes(u32(HEADER), u32(VERSION_GROUP_ID), u32(tx.branchId), u32(tx.lockTime), u32(tx.expiryHeight)));

  const prevouts = H("ZTxIdPrevoutHash", concatBytes(...tx.inputs.map(prevout)));
  const amounts = H("ZTxTrAmountsHash", concatBytes(...tx.inputs.map((i) => i64(i.value))));
  const scripts = H("ZTxTrScriptsHash", concatBytes(...tx.inputs.map((i) => withLen(i.script))));
  const sequences = H("ZTxIdSequencHash", concatBytes(...tx.inputs.map(() => u32(SEQUENCE))));
  const outputs = H("ZTxIdOutputsHash", concatBytes(...tx.outputs.map((o) => concatBytes(i64(o.value), withLen(o.script)))));
  const txin = H("Zcash___TxInHash", concatBytes(prevout(input), withLen(input.script), i64(input.value), u32(SEQUENCE)));

  const transparent = H("ZTxIdTranspHash", concatBytes(Uint8Array.of(0x01), prevouts, amounts, scripts, sequences, outputs, txin));
  const sapling = H("ZTxIdSaplingHash", new Uint8Array(0));
  const orchard = H("ZTxIdOrchardHash", new Uint8Array(0));

  const personal = concatBytes(te.encode("ZcashTxHash_"), u32(tx.branchId));
  return blake2b(concatBytes(header, transparent, sapling, orchard), { dkLen: 32, personalization: personal });
}

const push = (b: Uint8Array) => {
  if (b.length === 0 || b.length > 75) throw new Error("Panjang push tidak valid.");
  return concatBytes(Uint8Array.of(b.length), b);
};

/** Tandatangani semua input (satu kunci, P2PKH) dan kembalikan transaksi serial. */
export function signV5(tx: ZTx, privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const sigs = tx.inputs.map((_, i) => {
    const sig = secp256k1.sign(sigHashV5(tx, i), privateKey, { lowS: true });
    return concatBytes(push(concatBytes(sig.toDERRawBytes(), Uint8Array.of(0x01))), push(publicKey)); // SIGHASH_ALL
  });
  return serializeV5(tx, sigs);
}
