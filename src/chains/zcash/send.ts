import { formatUnits } from "ethers";
import { bytesToHex } from "@noble/hashes/utils";
import type { ChainConfig } from "../../lib/chains";
import type { Account } from "../../lib/vault";
import { parseAmount } from "../../lib/tx";
import { assertCanSpend } from "../../goals/guard";
import { assertRecipientAllowed } from "../../contacts/guard";
import { assertTxAuthorized } from "../../txauth/store";
import { NEED_PHRASE, zecAccount } from "../../core/derive";
import { p2pkhScript, hash160, parseRecipient } from "./address";
import { TX_EXPIRY_DELTA, branchIdAt } from "./params";
import { invalidateZec, zecBalance, zecBroadcast, zecTip } from "./provider";
import { MIN_CHANGE, parseV5, planSpend, signV5, zip317Fee, type ZInput, type ZOutput, type ZTx } from "./tx";

export type ZecPrepared = {
  chain: ChainConfig;
  from: string;
  to: string;
  amount: bigint;
  fee: bigint;
  /** Kembalian ke alamat Anda (0 = tidak ada). */
  change: bigint;
  tx: ZTx;
  /** Tinggi blok saat disusun, dan batas kedaluwarsa transaksi. */
  tip: number;
  createdAt: number;
};

export async function prepareZec(chain: ChainConfig, account: Account, input: { to: string; amount: string; max: boolean }): Promise<ZecPrepared> {
  const z = zecAccount(account);
  if (!z) throw new Error(NEED_PHRASE);
  const rcpt = parseRecipient(input.to);
  if (rcpt.address === z.address) throw new Error("Alamat tujuan sama dengan alamat Anda.");

  const [bal, tip] = await Promise.all([zecBalance(chain, z.address, true), zecTip(chain)]);
  const spendable = bal.utxos.filter((u) => u.confirmed);
  if (spendable.length === 0) {
    throw new Error(bal.unconfirmed > 0n ? "Dana Anda belum terkonfirmasi. Tunggu konfirmasi pertama lalu coba lagi." : "Saldo ZEC kosong.");
  }

  const plan = planSpend(spendable, input.max ? 0n : parseAmount(input.amount, 8), input.max);
  const ownScript = p2pkhScript(hash160(z.publicKey));
  const inputs: ZInput[] = plan.inputs.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, script: ownScript }));
  const outputs: ZOutput[] = [{ value: plan.amount, script: rcpt.script }];
  if (plan.change > 0n) outputs.push({ value: plan.change, script: ownScript });

  const tx: ZTx = { branchId: branchIdAt(tip + 1), lockTime: 0, expiryHeight: tip + TX_EXPIRY_DELTA, inputs, outputs };
  return { chain, from: z.address, to: rcpt.address, amount: plan.amount, fee: plan.fee, change: plan.change, tx, tip, createdAt: Date.now() };
}

/** Pastikan transaksi bertanda tangan benar-benar berisi persis apa yang ditinjau pengguna. */
function verifySigned(raw: Uint8Array, p: ZecPrepared, ownScript: Uint8Array) {
  const t = parseV5(raw);
  const rcpt = parseRecipient(p.to);
  const bad = (m: string) => new Error(`Transaksi tidak cocok dengan ringkasan (${m}). Dibatalkan.`);
  const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

  if (!t.shieldedEmpty || t.branchId !== p.tx.branchId) throw bad("format");
  if (t.outputs.length !== (p.change > 0n ? 2 : 1)) throw bad("jumlah output");
  if (t.outputs[0].value !== p.amount || !eq(t.outputs[0].script, rcpt.script)) throw bad("penerima/jumlah");
  if (p.change > 0n && (t.outputs[1].value !== p.change || !eq(t.outputs[1].script, ownScript))) throw bad("kembalian");
  if (t.inputs.length !== p.tx.inputs.length || t.inputs.some((i, k) => i.txid !== p.tx.inputs[k].txid || i.vout !== p.tx.inputs[k].vout)) throw bad("input");

  const inSum = p.tx.inputs.reduce((s, i) => s + i.value, 0n);
  const outSum = t.outputs.reduce((s, o) => s + o.value, 0n);
  if (inSum - outSum !== p.fee) throw bad("fee");
  // Fee tidak boleh melebihi fee ZIP-317 ditambah sisa kembalian yang dilebur (< MIN_CHANGE).
  if (p.fee > zip317Fee(t.inputs.length, 2) + MIN_CHANGE) throw bad("fee terlalu besar");
}

/** Tandatangani lokal (secp256k1) lalu siarkan. Mengembalikan txid. */
export async function signAndSendZec(account: Account, p: ZecPrepared): Promise<string> {
  assertRecipientAllowed("zec", p.to, p.from);
  await assertCanSpend(account, p.chain, { native: Number(formatUnits(p.amount + p.fee, 8)) });
  assertTxAuthorized(account, { kind: "zec", chainId: p.chain.chainId, to: p.to });
  const z = zecAccount(account);
  if (!z) throw new Error(NEED_PHRASE);
  if (z.address !== p.from) throw new Error("Alamat pengirim tidak cocok dengan wallet.");

  const raw = signV5(p.tx, z.privateKey, z.publicKey);
  verifySigned(raw, p, p2pkhScript(hash160(z.publicKey)));

  const txid = await zecBroadcast(p.chain, bytesToHex(raw));
  invalidateZec(p.chain, p.from);
  return txid;
}
