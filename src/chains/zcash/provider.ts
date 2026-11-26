import type { ChainConfig } from "../../lib/chains";
import { hostOf } from "../../lib/explain";
import { Breaker, Lane } from "../../lib/lane";

/**
 * Penyedia data Zcash (UTXO, tinggi blok, status, siaran). Tiga jenis API dikenali dari URL dasarnya:
 *  - JSON-RPC    : node Zebra (atau zcashd dengan -addressindex) seperti https://zcash-mainnet-zebrad.gateway.tatum.io (bawaan).
 *                  Dikenali dari host *.gateway.tatum.io atau akhiran "#jsonrpc" pada URL. API key (jika perlu) lewat ?key=KUNCI
 *                  pada URL; dikirim sebagai header x-api-key dan TIDAK ikut di URL permintaan.
 *  - Blockchair  : https://api.blockchair.com/zcash   (cadangan)
 *  - Blockbook   : server Blockbook Zcash mana pun (/api/v2/...), mis. milik Anda sendiri
 * Catatan: lightwalletd (gRPC, mis. :9067) TIDAK bisa dipakai langsung dari browser.
 * Catatan privasi: alamat Anda dikirim ke penyedia data, sehingga penyedia bisa mengaitkan alamat dan IP Anda.
 *
 * API publik gratis membatasi laju (Blockchair menjawab HTTP 430 dan memblokir IP sementara). Karena itu: pembatas
 * laju (Lane) + pemutus sirkuit (Breaker) per penyedia, cache, dan data terakhir yang berhasil ditampilkan saat diblokir.
 * API key Blockchair bisa dipasang pada URL endpoint: https://api.blockchair.com/zcash?key=KUNCI_ANDA
 */
export type ZUtxoInfo = { txid: string; vout: number; value: bigint; confirmed: boolean };
export type ZBalance = { utxos: ZUtxoInfo[]; confirmed: bigint; unconfirmed: bigint; total: bigint };

const hostnameOf = (base: string): string => {
  try {
    return new URL(base).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const isBlockchair = (base: string) => {
  const h = hostnameOf(base);
  return h === "blockchair.com" || h.endsWith(".blockchair.com");
};
const isRpc = (base: string) => {
  if (/#jsonrpc$/i.test(base)) return true;
  const h = hostnameOf(base);
  return h === "gateway.tatum.io" || h.endsWith(".gateway.tatum.io");
};
type Adapter = "rpc" | "blockchair" | "blockbook";
const adapterOf = (base: string): Adapter => (isRpc(base) ? "rpc" : isBlockchair(base) ? "blockchair" : "blockbook");

class RpcErr extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

/** Panggil metode JSON-RPC. API key dari query (?key=, ?apikey=, ?x-api-key=) dipindah ke header x-api-key. */
async function rpc(base: string, method: string, params: unknown[]): Promise<unknown> {
  const u = new URL(base);
  u.hash = "";
  let key = "";
  for (const k of ["key", "apikey", "api_key", "x-api-key"]) {
    const v = u.searchParams.get(k);
    if (v) {
      key = v;
      u.searchParams.delete(k);
    }
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers["x-api-key"] = key;
  const j = (await http(u.toString(), { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })) as {
    result?: unknown;
    error?: { code?: number; message?: string } | null;
  };
  if (j.error) throw new RpcErr(Number(j.error.code), j.error.message ?? "galat RPC");
  return j.result;
}

class HttpErr extends Error {
  constructor(
    public status: number,
    host: string,
    body: string,
    public retryAfterMs?: number,
  ) {
    super(`${host}: HTTP ${status}${body ? ` (${body.slice(0, 100)})` : ""}`);
  }
}

/** Gabungkan base URL (boleh berisi ?key=…) dengan path tanpa merusak query string. */
function join(base: string, path: string): string {
  const u = new URL(base);
  u.pathname = u.pathname.replace(/\/+$/, "") + path;
  return u.toString();
}

const breakers = new Map<string, Breaker>();
const lanes = new Map<string, Lane>();
const breakerFor = (b: string) => breakers.get(b) ?? (breakers.set(b, new Breaker(30_000, 600_000)), breakers.get(b)!);
const laneFor = (b: string) => lanes.get(b) ?? (lanes.set(b, new Lane(1, 400)), lanes.get(b)!);
/** Blockchair 430 = IP diblokir sementara karena melebihi batas. Beri jeda panjang supaya blokir tidak diperpanjang. */
const BLACKLIST_PAUSE_MS = 300_000;

async function http(url: string, init: RequestInit = {}): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, referrerPolicy: "no-referrer" });
    const text = await r.text();
    if (!r.ok) {
      const ra = Number(r.headers.get("retry-after"));
      throw new HttpErr(r.status, hostOf(url), text, Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 600_000) : undefined);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${hostOf(url)}: jawaban bukan JSON.`);
    }
  } finally {
    clearTimeout(t);
  }
}

/**
 * Coba tiap endpoint berurutan. Galat 404 dikembalikan apa adanya (pemanggil menafsirkannya). `bypass` = diagnosa
 * koneksi: abaikan jeda pemutus sirkuit.
 */
async function withBases<T>(chain: ChainConfig, fn: (base: string, a: Adapter) => Promise<T>, bypass = false): Promise<T> {
  const errs: string[] = [];
  for (const base of chain.rpcUrls) {
    const host = hostOf(base);
    const br = breakerFor(base);
    const left = bypass ? 0 : br.remaining();
    if (left > 0) {
      errs.push(`${host}: dijeda ${Math.ceil(left / 1000)} dtk karena membatasi permintaan; akan dicoba lagi otomatis`);
      continue;
    }
    const lane = laneFor(base);
    // Diagnosa koneksi menembus antrean/jeda dan tidak mengubah status pemutus sirkuit.
    const trip = (ms?: number) => (bypass ? 0 : br.trip(Date.now(), ms));
    const pause = (ms: number) => {
      if (!bypass) lane.pause(ms);
    };
    try {
      const r = await (bypass ? fn(base, adapterOf(base)) : lane.run(() => fn(base, adapterOf(base))));
      if (!bypass) br.reset();
      return r;
    } catch (e) {
      if (e instanceof HttpErr) {
        if (e.status === 404) throw e;
        if (e.status === 430) {
          trip(BLACKLIST_PAUSE_MS);
          pause(BLACKLIST_PAUSE_MS);
          errs.push(`${host}: HTTP 430, IP Anda diblokir sementara karena melebihi batas permintaan penyedia. Dijeda ${BLACKLIST_PAUSE_MS / 60_000} menit. Tunggu, atau pasang endpoint lain / API key (…/zcash?key=…) lewat "Cek koneksi dan endpoint".`);
          continue;
        }
        if (e.status === 401 || e.status === 403) {
          const wait = trip();
          pause(wait);
          errs.push(`${host}: HTTP ${e.status}, endpoint ini butuh API key valid (tambahkan ?key=KUNCI_ANDA pada URL endpoint).`);
          continue;
        }
        if (e.status === 429 || e.status === 402) {
          const wait = trip(e.retryAfterMs);
          pause(wait);
          errs.push(`${host}: HTTP ${e.status} (dibatasi laju)${bypass ? "" : `; dijeda ${Math.ceil(wait / 1000)} dtk`}`);
          continue;
        }
        errs.push(e.message);
      } else if ((e as { name?: string }).name === "AbortError") {
        errs.push(`${host}: tidak merespons (timeout)`);
      } else if (e instanceof TypeError) {
        // fetch gagal total: jaringan putus, CORS ditolak, ATAU respons pembatasan tanpa header CORS.
        const wait = trip();
        pause(wait);
        errs.push(`${host}: tidak bisa dihubungi (jaringan, CORS, atau pembatasan laju).${bypass ? "" : ` Dijeda ${Math.ceil(wait / 1000)} dtk lalu dicoba lagi.`}`);
      } else {
        // Galat logika/RPC (bukan masalah koneksi): tampilkan apa adanya, tanpa jeda.
        errs.push(`${host}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  throw new Error(`Semua endpoint Zcash gagal: ${errs.join(" | ")}`);
}

/* ------------------------------------------------------------------ UTXO */

type BcAddress = {
  data: Record<string, { address?: { balance?: number; unspent_output_count?: number }; utxo?: { block_id: number; transaction_hash: string; index: number; value: number }[] }>;
};
type BbUtxo = { txid: string; vout: number; value: string; confirmations?: number; height?: number }[];

const TTL = 45_000;
const cache = new Map<string, { at: number; p: Promise<ZBalance> }>();
const lastGood = new Map<string, { at: number; v: ZBalance }>();
const STALE_MAX_MS = 30 * 60_000;

async function fetchBalance(chain: ChainConfig, address: string): Promise<ZBalance> {
  const utxos = await withBases(chain, async (base, a) => {
    if (a === "rpc") {
      // Zebra/zcashd getaddressutxos: hanya UTXO terkonfirmasi di rantai utama.
      const r = (await rpc(base, "getaddressutxos", [{ addresses: [address] }])) as { txid: string; outputIndex: number; satoshis: number; height?: number }[];
      if (!Array.isArray(r)) throw new Error("Jawaban getaddressutxos tidak dikenal (node perlu indeks alamat).");
      return r.map((u) => ({ txid: u.txid, vout: u.outputIndex, value: BigInt(u.satoshis), confirmed: true }));
    }
    if (a === "blockchair") {
      const j = (await http(join(base, `/dashboards/address/${address}`))) as BcAddress;
      const d = Object.values(j.data ?? {})[0];
      if (!d) return [] as ZUtxoInfo[];
      const list = d.utxo ?? [];
      // Daftar UTXO dari Blockchair dibatasi jumlahnya: jangan menghitung saldo dari data yang terpotong.
      const expected = d.address?.unspent_output_count ?? list.length;
      if (expected > list.length) throw new Error(`UTXO terlalu banyak (${expected}) untuk dipindai penyedia ini. Gunakan server Blockbook sendiri.`);
      return list.map((u) => ({ txid: u.transaction_hash, vout: u.index, value: BigInt(u.value), confirmed: u.block_id > 0 }));
    }
    const j = (await http(join(base, `/api/v2/utxo/${address}`))) as BbUtxo;
    if (!Array.isArray(j)) throw new Error("Jawaban Blockbook tidak dikenal.");
    return j.map((u) => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value), confirmed: (u.confirmations ?? 0) > 0 }));
  });
  let confirmed = 0n;
  let unconfirmed = 0n;
  for (const u of utxos) (u.confirmed ? (confirmed += u.value) : (unconfirmed += u.value));
  return { utxos, confirmed, unconfirmed, total: confirmed + unconfirmed };
}

/** `force` (dipakai saat membelanjakan) melewati cache. Permintaan serentak digabung. */
export function zecBalance(chain: ChainConfig, address: string, force = false): Promise<ZBalance> {
  const key = `${chain.chainId}:${address}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.p;
  const p = fetchBalance(chain, address);
  cache.set(key, { at: Date.now(), p });
  p.then((v) => lastGood.set(key, { at: Date.now(), v })).catch(() => cache.delete(key));
  return p;
}

/**
 * UNTUK TAMPILAN SAJA: jika penyedia gagal/memblokir, kembalikan saldo terakhir yang berhasil dimuat (maks 30 menit)
 * dengan penanda `stale`. JANGAN dipakai untuk menyusun transaksi (prepareZec memakai zecBalance(force=true)).
 */
export async function zecBalanceOrStale(chain: ChainConfig, address: string): Promise<ZBalance & { stale?: boolean }> {
  try {
    return await zecBalance(chain, address);
  } catch (e) {
    const g = lastGood.get(`${chain.chainId}:${address}`);
    if (g && Date.now() - g.at < STALE_MAX_MS) return { ...g.v, stale: true };
    throw e;
  }
}
export const invalidateZec = (chain: ChainConfig, address: string) => {
  cache.delete(`${chain.chainId}:${address}`);
};

/* ------------------------------------------------------- tip, status, siaran */

const TIP_TTL = 30_000;
const tipCache = new Map<number, { at: number; p: Promise<number> }>();
const tipGood = new Map<number, { at: number; n: number }>();

/** Tinggi blok terbaru. Di-cache 30 dtk dan permintaan serentak digabung; `bypass` untuk diagnosa koneksi. */
export function zecTip(chain: ChainConfig, bypass = false): Promise<number> {
  const hit = tipCache.get(chain.chainId);
  if (!bypass && hit && Date.now() - hit.at < TIP_TTL) return hit.p;
  const p = fetchTip(chain, bypass).catch((e) => {
    tipCache.delete(chain.chainId);
    const g = tipGood.get(chain.chainId);
    if (!bypass && g && Date.now() - g.at < 10 * 60_000) return g.n; // data terakhir lebih baik daripada "offline"
    throw e;
  });
  if (!bypass) tipCache.set(chain.chainId, { at: Date.now(), p });
  p.then((n) => tipGood.set(chain.chainId, { at: Date.now(), n })).catch(() => {});
  return p;
}

async function fetchTip(chain: ChainConfig, bypass: boolean): Promise<number> {
  const n = await withBases(chain, async (base, a) => {
    if (a === "rpc") return Number(await rpc(base, "getblockcount", []));
    if (a === "blockchair") {
      const j = (await http(join(base, "/stats"))) as { data?: { blocks?: number } };
      return Number(j.data?.blocks);
    }
    const j = (await http(join(base, "/api/v2"))) as { backend?: { blocks?: number }; blockbook?: { bestHeight?: number } };
    return Number(j.backend?.blocks ?? j.blockbook?.bestHeight);
  }, bypass);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Tinggi blok Zcash tidak valid.");
  return n;
}

export async function zecTxStatus(chain: ChainConfig, txid: string): Promise<"pending" | "success"> {
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) throw new Error("txid tidak valid.");
  try {
    return await withBases(chain, async (base, a) => {
      if (a === "rpc") {
        try {
          const t = (await rpc(base, "getrawtransaction", [txid, 1])) as { confirmations?: number | null; height?: number | null } | null;
          return t && (Number(t.confirmations) > 0 || Number(t.height) > 0) ? "success" : "pending";
        } catch (e) {
          if (e instanceof RpcErr && e.code === -5) return "pending"; // belum terlihat node: anggap menunggu
          throw e;
        }
      }
      if (a === "blockchair") {
        const j = (await http(join(base, `/dashboards/transaction/${txid}`))) as { data?: Record<string, { transaction?: { block_id?: number } } | undefined> };
        const t = Object.values(j.data ?? {})[0]?.transaction;
        return t && Number(t.block_id) > 0 ? "success" : "pending"; // belum terindeks / di mempool = pending
      }
      const j = (await http(join(base, `/api/v2/tx/${txid}`))) as { blockHeight?: number; confirmations?: number };
      return (j.confirmations ?? 0) > 0 || Number(j.blockHeight) > 0 ? "success" : "pending";
    });
  } catch (e) {
    if (e instanceof HttpErr && e.status === 404) return "pending";
    throw e;
  }
}

/** Siarkan transaksi bertanda tangan (hex). Mengembalikan txid dari penyedia. */
export async function zecBroadcast(chain: ChainConfig, hex: string): Promise<string> {
  if (!/^[0-9a-f]+$/i.test(hex)) throw new Error("Transaksi tidak valid.");
  return withBases(chain, async (base, a) => {
    if (a === "rpc") {
      const id = await rpc(base, "sendrawtransaction", [hex]);
      if (typeof id !== "string" || !/^[0-9a-fA-F]{64}$/.test(id)) throw new Error("Jawaban sendrawtransaction tidak dikenal.");
      return id;
    }
    if (a === "blockchair") {
      const j = (await http(join(base, "/push/transaction"), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${hex}`,
      })) as { data?: { transaction_hash?: string }; context?: { error?: string } };
      const id = j.data?.transaction_hash;
      if (!id) throw new Error(j.context?.error ?? "Penyedia menolak transaksi.");
      return id;
    }
    const j = (await http(join(base, "/api/v2/sendtx/"), { method: "POST", headers: { "Content-Type": "text/plain" }, body: hex })) as {
      result?: string;
      error?: string;
    };
    if (!j.result) throw new Error(j.error ?? "Penyedia menolak transaksi.");
    return j.result;
  });
}
