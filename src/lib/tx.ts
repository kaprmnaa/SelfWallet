import {
  Transaction,
  formatEther,
  formatUnits,
  getAddress,
  parseUnits,
  type TransactionRequest,
} from "ethers";
import type { ChainConfig } from "./chains";
import { assertChain, withProvider } from "./rpc";
import { encodeTransfer, tokenBalanceOn, type TokenInfo } from "./tokens";
import { trimAmount } from "./format";
import type { Account } from "./vault";
import { assertCanSpend } from "../goals/guard";

export type Draft = {
  chain: ChainConfig;
  from: string;
  to: string;
  amount: string;
  token?: TokenInfo;
};

export type Prepared = {
  draft: Draft;
  recipient: string;
  value: bigint;
  tx: TransactionRequest;
  gasLimit: bigint;
  feeCap: bigint;
  nonce: number;
  recipientIsContract: boolean;
  toSelf: boolean;
  createdAt: number;
};

export function parseAmount(amount: string, decimals: number): bigint {
  const a = amount.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(a)) throw new Error("Jumlah tidak valid.");
  const frac = a.split(".")[1] ?? "";
  if (frac.length > decimals) throw new Error(`Maksimal ${decimals} angka desimal untuk aset ini.`);
  const v = parseUnits(a, decimals);
  if (v <= 0n) throw new Error("Jumlah harus lebih dari nol.");
  return v;
}

/** Validasi + estimasi. Tidak menandatangani apa pun. */
export async function prepare(d: Draft): Promise<Prepared> {
  let recipient: string;
  try {
    recipient = getAddress(d.to.trim());
  } catch {
    throw new Error("Alamat tujuan tidak valid atau checksum salah.");
  }
  if (d.token && recipient === d.token.address) {
    throw new Error("Tujuan adalah contract token itu sendiri. Token yang dikirim ke sana akan hilang.");
  }
  const decimals = d.token?.decimals ?? 18;
  const value = parseAmount(d.amount, decimals);

  return withProvider(d.chain, async (p) => {
    await assertChain(p, d.chain);
    const [nonce, fee, nativeBal, code] = await Promise.all([
      p.getTransactionCount(d.from, "pending"),
      p.getFeeData(),
      p.getBalance(d.from),
      p.getCode(recipient),
    ]);

    if (!d.token && nativeBal < value) throw new Error(`Saldo ${d.chain.symbol} tidak cukup.`);
    if (d.token) {
      const tb = await tokenBalanceOn(p, d.token, d.from);
      if (tb < value) throw new Error(`Saldo ${d.token.symbol} tidak cukup.`);
    }

    const base: TransactionRequest = d.token
      ? { to: d.token.address, value: 0n, data: encodeTransfer(recipient, value) }
      : { to: recipient, value, data: "0x" };

    let gasLimit = await p.estimateGas({ ...base, from: d.from });
    if (d.token) gasLimit = (gasLimit * 120n) / 100n; // buffer untuk contract

    const is1559 = fee.maxFeePerGas != null && fee.maxPriorityFeePerGas != null;
    const feeCap = is1559 ? fee.maxFeePerGas! : fee.gasPrice;
    if (feeCap == null) throw new Error("RPC tidak memberikan data biaya gas.");

    const feeFields: TransactionRequest = is1559
      ? { type: 2, maxFeePerGas: fee.maxFeePerGas!, maxPriorityFeePerGas: fee.maxPriorityFeePerGas! }
      : { type: 0, gasPrice: feeCap };

    const needed = gasLimit * feeCap + (d.token ? 0n : value);
    if (nativeBal < needed) {
      throw new Error(
        `Saldo ${d.chain.symbol} tidak cukup untuk jumlah + biaya gas (butuh sekitar ${trimAmount(formatEther(needed), 8)}).`,
      );
    }

    return {
      draft: d,
      recipient,
      value,
      gasLimit,
      feeCap,
      nonce,
      recipientIsContract: code !== "0x",
      toSelf: recipient.toLowerCase() === d.from.toLowerCase(),
      createdAt: Date.now(),
      tx: { ...base, ...feeFields, nonce, gasLimit, chainId: BigInt(d.chain.chainId) },
    };
  });
}

export const feeWei = (p: Prepared) => p.gasLimit * p.feeCap;

/** Tandatangani secara lokal, lalu siarkan raw transaction. Mengembalikan hash. */
export async function signAndSend(account: Account, prepared: Prepared): Promise<string> {
  const { chain } = prepared.draft;
  // Dana terkunci: native + biaya gas (batas atas) selalu keluar; token hanya jika yang dikirim token.
  await assertCanSpend(account, chain, {
    native: Number(formatEther(feeWei(prepared))) + (prepared.draft.token ? 0 : Number(formatEther(prepared.value))),
    token: prepared.draft.token
      ? { address: prepared.draft.token.address, amount: Number(formatUnits(prepared.value, prepared.draft.token.decimals)) }
      : undefined,
  });
  const raw = await account.signTransaction(prepared.tx);

  // Cek integritas: yang ditandatangani harus sama dengan yang ditinjau pengguna.
  const parsed = Transaction.from(raw);
  if (
    parsed.chainId !== BigInt(chain.chainId) ||
    parsed.to?.toLowerCase() !== String(prepared.tx.to).toLowerCase() ||
    parsed.value !== (prepared.tx.value as bigint)
  ) {
    throw new Error("Transaksi bertanda tangan tidak cocok dengan ringkasan. Dibatalkan.");
  }
  const hash = parsed.hash!;

  return withProvider(chain, async (p) => {
    await assertChain(p, chain);
    try {
      const r = await p.broadcastTransaction(raw);
      return r.hash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/already known|known transaction|already imported/i.test(msg)) return hash;
      throw e;
    }
  });
}

export async function checkReceipt(
  chain: ChainConfig,
  hash: string,
): Promise<"pending" | "success" | "failed"> {
  const r = await withProvider(chain, (p) => p.getTransactionReceipt(hash));
  if (!r) return "pending";
  return r.status === 1 ? "success" : "failed";
}

/** Saldo native maksimum yang aman dikirim (dikurangi batas biaya transfer 21000 gas). */
export async function maxNativeSend(chain: ChainConfig, from: string): Promise<string> {
  return withProvider(chain, async (p) => {
    const [bal, fee] = await Promise.all([p.getBalance(from), p.getFeeData()]);
    const cap = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
    const left = bal - 21000n * cap;
    return formatEther(left > 0n ? left : 0n);
  });
}

export { formatUnits };
