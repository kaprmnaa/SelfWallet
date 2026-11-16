import type { ChainConfig } from "../../lib/chains";
import { Breaker, Lane } from "../../lib/lane";
import { hostOf } from "../../lib/explain";

// Klien REST Esplora (mempool.space / blockstream.info). Catatan privasi: setiap alamat yang
// dipindai dikirim ke penyedia data ini, sehingga penyedia dapat mengaitkan alamat Anda dan IP Anda.
//
// Catatan laju: API publik membatasi permintaan (mempool.space sekitar 10/detik, jawaban 429, dan bisa
// memblokir IP yang terus melanggar). Respons 429 TIDAK membawa header CORS, jadi di browser tampil sebagai
// galat CORS. Karena itu: pembatas laju (Lane) + pemutus sirkuit (Breaker) per penyedia.

export class HttpErr extends Error {
  status: number;
  constructor(status: number, body: string, host: string) {
    super(`${host}: HTTP ${status}${body ? ` (${body.slice(0, 100)})` : ""}`);
    this.status = status;
  }
}

const lanes = new Map<string, Lane>();
const breakers = new Map<string, Breaker>();
const laneFor = (base: string) => {
  let l = lanes.get(base);
  if (!l) lanes.set(base, (l = new Lane(2, 200))); // maks. 2 serentak, jeda 200 ms = maks. 5 permintaan/detik
  return l;
};
const breakerFor = (base: string) => {
  let b = breakers.get(base);
  if (!b) breakers.set(base, (b = new Breaker()));
  return b;
};

async function once(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, referrerPolicy: "no-referrer" });
  } finally {
    clearTimeout(t);
  }
}

/** bypass = true: untuk diagnosa koneksi (mengabaikan pemutus sirkuit). */
async function req(chain: ChainConfig, path: string, init: RequestInit = {}, bypass = false): Promise<Response> {
  const errs: string[] = [];
  for (const base of chain.rpcUrls) {
    const host = hostOf(base);
    const br = breakerFor(base);
    const left = bypass ? 0 : br.remaining();
    if (left > 0) {
      errs.push(`${host}: sedang dijeda ${Math.ceil(left / 1000)} dtk karena membatasi permintaan; akan dicoba lagi otomatis`);
      continue;
    }
    const lane = laneFor(base);
    try {
      const r = await lane.run(() => once(base + path, init));
      if (r.status === 429) {
        const ra = Number(r.headers.get("retry-after"));
        const wait = br.trip(Date.now(), Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 120_000) : undefined);
        lane.pause(wait);
        errs.push(`${host}: HTTP 429 (dibatasi laju); dijeda ${Math.ceil(wait / 1000)} dtk`);
        continue;
      }
      if (!r.ok) throw new HttpErr(r.status, await r.text().catch(() => ""), host);
      br.reset();
      return r;
    } catch (e) {
      // Kesalahan permintaan (4xx selain 429) tidak akan berubah di penyedia lain.
      if (e instanceof HttpErr && e.status >= 400 && e.status < 500) throw e;
      if (e instanceof HttpErr) {
        errs.push(e.message);
      } else if ((e as { name?: string }).name === "AbortError") {
        errs.push(`${host}: tidak merespons (timeout)`);
      } else {
        // fetch gagal total: jaringan putus, ATAU 429 tanpa header CORS (paling sering untuk API publik).
        const wait = br.trip();
        lane.pause(wait);
        errs.push(
          `${host}: tidak bisa dihubungi. Jika berulang, kemungkinan besar penyedia membatasi laju (respons 429 tanpa header CORS tampil sebagai galat CORS di browser). Dijeda ${Math.ceil(wait / 1000)} dtk lalu dicoba lagi.`,
        );
      }
    }
  }
  throw new Error(errs.join(" | ") || "Data Bitcoin tidak tersedia.");
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

export async function btcTip(chain: ChainConfig, bypass = false): Promise<number> {
  const n = Number((await (await req(chain, "/blocks/tip/height", {}, bypass)).text()).trim());
  if (!Number.isFinite(n)) throw new Error("Tinggi blok tidak valid.");
  return n;
}
