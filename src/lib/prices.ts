import { load, save } from "./storage";

// Harga dari CoinGecko (API publik tanpa key). Hanya id koin / alamat contract yang dikirim,
// TIDAK ada alamat dompet Anda.
//
// API publik membatasi permintaan dari browser dengan ketat (429). Respons 429 tidak membawa
// header CORS, sehingga browser melaporkannya sebagai error CORS. Karena itu:
//  - harga token diminta SATU alamat per permintaan (menghindari 400 untuk permintaan banyak alamat),
//    dengan jeda antar permintaan dan batas jumlah permintaan per putaran;
//  - hasil di-cache per alamat (5 menit; 30 menit jika ditolak 400) dan disimpan di localStorage;
//  - setelah satu kegagalan (429/jaringan) semua permintaan dijeda 2 menit sambil memakai cache lama.
const API = "https://api.coingecko.com/api/v3";

export type Price = { usd: number; idr: number };
type Entry<T> = { at: number; data: T; ttl?: number };
type Snapshot = {
  native?: Entry<Record<number, Price | null>>;
  tokens: Record<string, Entry<Price | null>>;
};

const TTL = 5 * 60_000;
const REJECTED_TTL = 30 * 60_000;
const STALE_MAX = 24 * 3_600_000;
const COOLDOWN = 2 * 60_000;
const MAX_REQUESTS_PER_ROUND = 6;
const SPACING_MS = 1_100;

const NATIVE_ID: Record<number, string> = {
  1: "ethereum",
  8453: "ethereum",
  56: "binancecoin",
  137: "polygon-ecosystem-token",
  900_000_001: "bitcoin",
  900_000_101: "solana",
};
const PLATFORM: Record<number, string> = {
  1: "ethereum",
  56: "binance-smart-chain",
  137: "polygon-pos",
  8453: "base",
};

const STORE_KEY = "prices2"; // format baru: cache per alamat
let snap: Snapshot = load<Snapshot>(STORE_KEY, { tokens: {} });
if (!snap || typeof snap !== "object" || !snap.tokens) snap = { tokens: {} };
let blockedUntil = 0;
const inflight = new Map<string, Promise<Record<string, Partial<Price>>>>();

class HttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`harga ${status}`);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getJson(url: string): Promise<Record<string, Partial<Price>>> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = (async () => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    try {
      const r = await fetch(url, { signal: ctl.signal, referrerPolicy: "no-referrer" });
      if (!r.ok) throw new HttpError(r.status);
      return (await r.json()) as Record<string, Partial<Price>>;
    } catch (e) {
      // 429 / CORS / timeout: beri jeda. Status 400 = permintaan ditolak, bukan beban server.
      if (!(e instanceof HttpError && e.status === 400)) blockedUntil = Date.now() + COOLDOWN;
      throw e;
    } finally {
      clearTimeout(t);
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

const toPrice = (x?: Partial<Price>): Price | null =>
  x && typeof x.usd === "number" ? { usd: x.usd, idr: typeof x.idr === "number" ? x.idr : 0 } : null;

/** true jika jaringan ini punya harga native di CoinGecko (mainnet bawaan). */
export const hasNativePrice = (chainId: number) => chainId in NATIVE_ID;

/** Harga koin native per chainId (hanya mainnet bawaan). Satu permintaan, cache 5 menit. */
export async function nativePrices(): Promise<Record<number, Price | null>> {
  const now = Date.now();
  const entry = snap.native;
  if (entry && now - entry.at < TTL) return entry.data;
  const usable = entry && now - entry.at < STALE_MAX ? entry.data : undefined;
  if (now < blockedUntil) {
    if (usable) return usable;
    throw new Error("Harga sementara dibatasi (rate limit). Coba lagi sebentar lagi.");
  }
  try {
    const ids = [...new Set(Object.values(NATIVE_ID))].join(",");
    const j = await getJson(`${API}/simple/price?ids=${ids}&vs_currencies=usd,idr`);
    const out: Record<number, Price | null> = {};
    for (const [chainId, id] of Object.entries(NATIVE_ID)) out[Number(chainId)] = toPrice(j[id]);
    snap.native = { at: Date.now(), data: out };
    save(STORE_KEY, snap);
    return out;
  } catch (e) {
    if (usable) return usable;
    throw e;
  }
}

/**
 * Harga token per alamat contract (kunci = alamat huruf kecil).
 * Alamat yang belum ter-cache diminta satu per satu (maks. 6 per putaran); sisanya menyusul
 * pada putaran berikutnya. Melempar error hanya jika SEMUA gagal sementara dan tidak ada harga sama sekali.
 */
export async function tokenPrices(chainId: number, addresses: string[]): Promise<Record<string, Price | null>> {
  const platform = PLATFORM[chainId];
  if (!platform || addresses.length === 0) return {};
  const addrs = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out: Record<string, Price | null> = {};
  let budget = MAX_REQUESTS_PER_ROUND;
  let requested = false;
  let transient = 0;
  let changed = false;

  for (const a of addrs) {
    const key = `${chainId}:${a}`;
    const entry = snap.tokens[key];
    const now = Date.now();
    if (entry && now - entry.at < (entry.ttl ?? TTL)) {
      out[a] = entry.data;
      continue;
    }
    const stale = entry && now - entry.at < STALE_MAX ? entry.data : null;
    if (now < blockedUntil || budget <= 0) {
      out[a] = stale;
      if (now < blockedUntil) transient++;
      continue;
    }
    try {
      if (requested) await sleep(SPACING_MS);
      requested = true;
      budget--;
      const j = await getJson(
        `${API}/simple/token_price/${platform}?contract_addresses=${a}&vs_currencies=usd,idr`,
      );
      const price = toPrice(j[a]);
      snap.tokens[key] = { at: Date.now(), data: price };
      out[a] = price;
      changed = true;
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) {
        snap.tokens[key] = { at: Date.now(), data: null, ttl: REJECTED_TTL };
        out[a] = null;
        changed = true;
      } else {
        out[a] = stale;
        transient++;
      }
    }
  }
  if (changed) save(STORE_KEY, snap);
  if (transient > 0 && Object.values(out).every((v) => v === null)) {
    throw new Error("Harga token sementara tidak tersedia.");
  }
  return out;
}
