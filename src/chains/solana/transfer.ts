import { ed25519 } from "@noble/curves/ed25519";
import { base58, base64 } from "@scure/base";
import { formatUnits } from "ethers";
import type { ChainConfig } from "../../lib/chains";
import type { Account } from "../../lib/vault";
import { parseAmount } from "../../lib/tx";
import { assertCanSpend } from "../../goals/guard";
import { NEED_PHRASE, solAccount } from "../../core/derive";
import { assertSolCluster, solBalance, solRpc } from "./rpc";

const FALLBACK_FEE = 5000n; // lamports per tanda tangan, dipakai jika RPC tidak memberi nilai

export type SolPrepared = {
  chain: ChainConfig;
  from: string;
  to: string;
  lamports: bigint;
  fee: bigint;
  message: Uint8Array;
  remaining: bigint;
  minRent: bigint;
  createdAt: number;
};

export function parseSolAddress(raw: string): Uint8Array {
  let b: Uint8Array;
  try {
    b = base58.decode(raw.trim());
  } catch {
    throw new Error("Alamat Solana tidak valid.");
  }
  if (b.length !== 32) throw new Error("Alamat Solana tidak valid (panjang harus 32 byte).");
  return b;
}

function compactU16(n: number): number[] {
  const out: number[] = [];
  let v = n;
  for (;;) {
    const b = v & 0x7f;
    v >>= 7;
    if (v === 0) {
      out.push(b);
      return out;
    }
    out.push(b | 0x80);
  }
}

/** Pesan legacy: 1 instruksi System Program Transfer (indeks 2: u32 LE + u64 LE lamports). */
function buildTransferMessage(from: Uint8Array, to: Uint8Array, lamports: bigint, blockhash: Uint8Array): Uint8Array {
  const system = new Uint8Array(32); // 11111111111111111111111111111111
  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true);
  dv.setBigUint64(4, lamports, true);
  const bytes: number[] = [1, 0, 1]; // header: 1 penanda tangan, 0 readonly signed, 1 readonly unsigned
  bytes.push(...compactU16(3), ...from, ...to, ...system);
  bytes.push(...blockhash);
  bytes.push(...compactU16(1)); // jumlah instruksi
  bytes.push(2, ...compactU16(2), 0, 1); // program index, [akun from, akun to]
  bytes.push(...compactU16(data.length), ...data);
  return Uint8Array.from(bytes);
}

/** Bongkar kembali pesan untuk memastikan isinya sesuai ringkasan (penerima + jumlah). */
function verifyMessage(msg: Uint8Array, from: Uint8Array, to: Uint8Array, lamports: bigint) {
  const eq = (a: Uint8Array, off: number, b: Uint8Array) => b.every((x, i) => a[off + i] === x);
  const dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  const ok =
    msg[0] === 1 &&
    eq(msg, 4, from) &&
    eq(msg, 36, to) &&
    dv.getUint32(msg.length - 12, true) === 2 &&
    dv.getBigUint64(msg.length - 8, true) === lamports;
  if (!ok) throw new Error("Pesan transaksi tidak cocok dengan ringkasan. Dibatalkan.");
}

export async function prepareSol(
  chain: ChainConfig,
  account: Account,
  input: { to: string; amount: string; max: boolean },
): Promise<SolPrepared> {
  const sol = solAccount(account);
  if (!sol) throw new Error(NEED_PHRASE);
  const toBytes = parseSolAddress(input.to);
  const to = base58.encode(toBytes);
  if (to === sol.address) throw new Error("Alamat tujuan sama dengan alamat Anda.");

  await assertSolCluster(chain);
  const [balance, toBalance, bh, minRentRaw] = await Promise.all([
    solBalance(chain, sol.address),
    solBalance(chain, to),
    solRpc<{ value: { blockhash: string } }>(chain, "getLatestBlockhash", [{ commitment: "confirmed" }]),
    solRpc<number>(chain, "getMinimumBalanceForRentExemption", [0]),
  ]);
  const minRent = BigInt(minRentRaw);
  const blockhash = base58.decode(bh.value.blockhash);

  // Biaya tidak bergantung pada jumlah: hitung dengan jumlah sementara.
  const probe = buildTransferMessage(sol.publicKey, toBytes, 1n, blockhash);
  const feeRes = await solRpc<{ value: number | null }>(chain, "getFeeForMessage", [
    base64.encode(probe),
    { commitment: "confirmed" },
  ]);
  const fee = feeRes.value == null ? FALLBACK_FEE : BigInt(feeRes.value);

  const lamports = input.max ? balance - fee : parseAmount(input.amount, 9);
  if (lamports <= 0n) throw new Error("Saldo tidak cukup untuk membayar fee.");
  if (balance < lamports + fee) throw new Error("Saldo SOL tidak cukup untuk jumlah + fee.");
  if (toBalance === 0n && lamports < minRent) {
    throw new Error(
      `Penerima adalah akun baru: jumlah minimal ${formatUnits(minRent, 9)} SOL (batas rent-exempt) agar tidak ditolak jaringan.`,
    );
  }

  const message = buildTransferMessage(sol.publicKey, toBytes, lamports, blockhash);
  return {
    chain,
    from: sol.address,
    to,
    lamports,
    fee,
    message,
    remaining: balance - lamports - fee,
    minRent,
    createdAt: Date.now(),
  };
}

/** Tandatangani lokal (Ed25519) lalu siarkan. Mengembalikan signature (id transaksi). */
export async function signAndSendSol(account: Account, p: SolPrepared): Promise<string> {
  await assertCanSpend(account, p.chain, { native: Number(formatUnits(p.lamports + p.fee, 9)) });
  const sol = solAccount(account);
  if (!sol) throw new Error(NEED_PHRASE);
  verifyMessage(p.message, sol.publicKey, base58.decode(p.to), p.lamports);

  const sig = ed25519.sign(p.message, sol.privateKey);
  const wire = new Uint8Array(1 + 64 + p.message.length);
  wire[0] = 1; // jumlah tanda tangan
  wire.set(sig, 1);
  wire.set(p.message, 65);

  await assertSolCluster(p.chain);
  return solRpc<string>(p.chain, "sendTransaction", [
    base64.encode(wire),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
}
