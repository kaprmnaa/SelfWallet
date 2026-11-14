import type { ChainConfig } from "../../lib/chains";

// Identitas cluster (genesis hash) dari dokumentasi resmi Solana. Dipakai untuk memastikan RPC
// benar-benar melayani cluster yang dipilih sebelum mengirim.
const GENESIS: Record<number, string> = {
  900_000_101: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", // mainnet-beta
  900_000_102: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", // devnet
};

class RpcAppError extends Error {}
let seq = 1;

export async function solRpc<T>(chain: ChainConfig, method: string, params: unknown[] = []): Promise<T> {
  let last: unknown;
  for (const url of chain.rpcUrls) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12_000);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: seq++, method, params }),
        signal: ctl.signal,
        referrerPolicy: "no-referrer",
      });
      if (!r.ok) throw new Error(`RPC Solana status ${r.status}`);
      const j = (await r.json()) as { result?: T; error?: { message?: string } };
      if (j.error) throw new RpcAppError(j.error.message ?? "RPC Solana menolak permintaan.");
      return j.result as T;
    } catch (e) {
      last = e;
      if (e instanceof RpcAppError) throw e; // error aplikasi: RPC lain tidak akan beda
    } finally {
      clearTimeout(t);
    }
  }
  throw last ?? new Error("RPC Solana tidak tersedia.");
}

export async function assertSolCluster(chain: ChainConfig) {
  const expected = GENESIS[chain.chainId];
  if (!expected) return; // jaringan Solana kustom (tidak ada di versi ini)
  const g = await solRpc<string>(chain, "getGenesisHash");
  if (g !== expected) throw new Error("RPC tidak melayani cluster Solana yang dipilih. Operasi dibatalkan.");
}

export async function solBalance(chain: ChainConfig, address: string): Promise<bigint> {
  const r = await solRpc<{ value: number }>(chain, "getBalance", [address, { commitment: "confirmed" }]);
  return BigInt(r.value);
}

export async function solSlot(chain: ChainConfig): Promise<number> {
  return solRpc<number>(chain, "getSlot", [{ commitment: "confirmed" }]);
}

export async function solTxStatus(chain: ChainConfig, signature: string): Promise<"pending" | "success" | "failed"> {
  const r = await solRpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>(
    chain,
    "getSignatureStatuses",
    [[signature], { searchTransactionHistory: true }],
  );
  const s = r.value[0];
  if (!s) return "pending";
  if (s.err) return "failed";
  return s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "success" : "pending";
}
