import { Contract, Interface, Transaction, formatEther, type TransactionRequest } from "ethers";
import type { ChainConfig } from "../../lib/chains";
import { assertChain, withProvider } from "../../lib/rpc";
import { checkReceipt } from "../../lib/tx";
import { trimAmount } from "../../lib/format";
import type { Account } from "../../lib/vault";

/**
 * Panggilan kontrak generik (approve, swap). Berbeda dari lib/tx.ts yang khusus transfer:
 * di sini data dan value berasal dari luar (provider) dan SUDAH divalidasi pemanggil.
 * estimateGas dijalankan dengan `from` Anda, sehingga bertindak juga sebagai simulasi (revert terdeteksi).
 */
export type CallPrepared = {
  chain: ChainConfig;
  from: string;
  to: string;
  data: string;
  value: bigint;
  gasLimit: bigint;
  feeCap: bigint;
  nonce: number;
  tx: TransactionRequest;
  createdAt: number;
};

const iface = new Interface([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const encodeApprove = (spender: string, amount: bigint) => iface.encodeFunctionData("approve", [spender, amount]);

export function readAllowance(chain: ChainConfig, token: string, owner: string, spender: string): Promise<bigint> {
  return withProvider(chain, async (p) => {
    await assertChain(p, chain);
    const c = new Contract(token, iface, p);
    return (await c.allowance(owner, spender)) as bigint;
  });
}

export async function prepareCall(
  chain: ChainConfig,
  from: string,
  call: { to: string; data: string; value: bigint },
): Promise<CallPrepared> {
  return withProvider(chain, async (p) => {
    await assertChain(p, chain);
    const [nonce, fee, balance] = await Promise.all([
      p.getTransactionCount(from, "pending"),
      p.getFeeData(),
      p.getBalance(from),
    ]);
    let gas: bigint;
    try {
      gas = await p.estimateGas({ from, to: call.to, data: call.data, value: call.value });
    } catch (e) {
      const msg = (e as { shortMessage?: string }).shortMessage ?? "";
      throw new Error(`Simulasi transaksi gagal (kemungkinan akan revert)${msg ? `: ${msg}` : "."} Tidak ada yang dikirim.`);
    }
    const gasLimit = (gas * 120n) / 100n;

    const is1559 = fee.maxFeePerGas != null && fee.maxPriorityFeePerGas != null;
    const feeCap = is1559 ? fee.maxFeePerGas! : fee.gasPrice;
    if (feeCap == null) throw new Error("RPC tidak memberikan data biaya gas.");
    const feeFields: TransactionRequest = is1559
      ? { type: 2, maxFeePerGas: fee.maxFeePerGas!, maxPriorityFeePerGas: fee.maxPriorityFeePerGas! }
      : { type: 0, gasPrice: feeCap };

    const needed = call.value + gasLimit * feeCap;
    if (balance < needed) {
      throw new Error(
        `Saldo ${chain.symbol} tidak cukup untuk nilai transaksi + gas (butuh sekitar ${trimAmount(formatEther(needed), 8)}).`,
      );
    }
    return {
      chain,
      from,
      to: call.to,
      data: call.data,
      value: call.value,
      gasLimit,
      feeCap,
      nonce,
      createdAt: Date.now(),
      tx: {
        to: call.to,
        data: call.data,
        value: call.value,
        nonce,
        gasLimit,
        chainId: BigInt(chain.chainId),
        ...feeFields,
      },
    };
  });
}

/** Tandatangani lokal, cocokkan dengan yang disiapkan, lalu siarkan. Mengembalikan hash. */
export async function sendCall(account: Account, p: CallPrepared): Promise<string> {
  const raw = await account.signTransaction(p.tx);
  const parsed = Transaction.from(raw);
  if (
    parsed.chainId !== BigInt(p.chain.chainId) ||
    parsed.to?.toLowerCase() !== p.to.toLowerCase() ||
    parsed.value !== p.value ||
    parsed.data.toLowerCase() !== p.data.toLowerCase()
  ) {
    throw new Error("Transaksi bertanda tangan tidak cocok dengan yang ditinjau. Dibatalkan.");
  }
  const hash = parsed.hash!;
  return withProvider(p.chain, async (prov) => {
    await assertChain(prov, p.chain);
    try {
      return (await prov.broadcastTransaction(raw)).hash;
    } catch (e) {
      if (/already known|known transaction|already imported/i.test(e instanceof Error ? e.message : "")) return hash;
      throw e;
    }
  });
}

/** Tunggu receipt sukses; melempar jika revert atau melewati batas waktu. */
export async function waitReceipt(chain: ChainConfig, hash: string, timeoutMs = 180_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await checkReceipt(chain, hash).catch(() => "pending" as const);
    if (r === "success") return;
    if (r === "failed") throw new Error("Transaksi approval revert di chain.");
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error("Transaksi belum terkonfirmasi dalam batas waktu. Periksa explorer lalu coba lagi.");
}

/** Saldo native maksimum untuk swap: dikurangi cadangan gas konservatif (700 ribu gas). */
export async function maxNativeForSwap(chain: ChainConfig, from: string): Promise<bigint> {
  return withProvider(chain, async (p) => {
    const [bal, fee] = await Promise.all([p.getBalance(from), p.getFeeData()]);
    const cap = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
    const left = bal - 700_000n * cap;
    return left > 0n ? left : 0n;
  });
}
