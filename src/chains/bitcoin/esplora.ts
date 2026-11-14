import type { ChainConfig } from "../../lib/chains";

// Klien REST Esplora (mempool.space / blockstream.info). Catatan privasi: setiap alamat yang
// dipindai dikirim ke penyedia data ini, sehingga penyedia dapat mengaitkan alamat Anda dan IP Anda.

class HttpErr extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`Data Bitcoin: HTTP ${status}${body ? ` (${body.slice(0, 120)})` : ""}`);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, referrerPolicy: "no-referrer" });
  } finally {
    clearTimeout(t);
  }
}

async function req(chain: ChainConfig, path: string, init: RequestInit = {}): Promise<Response> {
  let last: unknown;
  for (const base of chain.rpcUrls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await once(base + path, init);
        if (r.status === 429 && attempt === 0) {
          await sleep(900);
          continue;
        }
        if (!r.ok) throw new HttpErr(r.status, await r.text().catch(() => ""));
        return r;
      } catch (e) {
        last = e;
        // Kesalahan permintaan (4xx selain 429) tidak akan berubah di penyedia lain.
        if (e instanceof HttpErr && e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
        break;
      }
    }
  }
  throw last ?? new Error("Data Bitcoin tidak tersedia.");
}

type Stats = { funded_txo_count: number; funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
export type EsploraAddress = { chain_stats: Stats; mempool_stats: Stats };
export type EsploraUtxo = { txid: string; vout: number; value: number; status: { confirmed: boolean; block_height?: number } };

export async function addressStats(chain: ChainConfig, address: string): Promise<EsploraAddress> {
  return (await req(chain, `/address/${address}`)).json();
}

export async function addressUtxos(chain: ChainConfig, address: string): Promise<EsploraUtxo[]> {
  return (await req(chain, `/address/${address}/utxo`)).json();
}

export async function feeEstimates(chain: ChainConfig): Promise<Record<string, number>> {
  return (await req(chain, "/fee-estimates")).json();
}

export async function broadcastTx(chain: ChainConfig, hex: string): Promise<string> {
  const r = await req(chain, "/tx", { method: "POST", headers: { "content-type": "text/plain" }, body: hex });
  return (await r.text()).trim();
}

export async function btcTxStatus(chain: ChainConfig, txid: string): Promise<"pending" | "success"> {
  try {
    const j = (await (await req(chain, `/tx/${txid}/status`)).json()) as { confirmed?: boolean };
    return j.confirmed ? "success" : "pending";
  } catch (e) {
    if (e instanceof HttpErr && e.status === 404) return "pending"; // belum terindeks
    throw e;
  }
}

export async function btcTip(chain: ChainConfig): Promise<number> {
  const n = Number((await (await req(chain, "/blocks/tip/height")).text()).trim());
  if (!Number.isFinite(n)) throw new Error("Tinggi blok tidak valid.");
  return n;
}
