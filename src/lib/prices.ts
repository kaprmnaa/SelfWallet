import { load, save } from "./storage";

// Harga dari CoinGecko (API publik). Hanya id koin / alamat contract yang dikirim,
// TIDAK ada alamat dompet Anda.
//
// API publik CoinGecko membatasi permintaan dari browser dengan ketat (HTTP 429).
// Respons 429 tidak membawa header CORS, sehingga browser melaporkannya sebagai error CORS.
// Karena itu: cache 5 menit (juga disimpan di localStorage), permintaan identik digabung,
// dan setelah satu kegagalan permintaan dijeda 2 menit sambil memakai data cache lama.
const API = "https://api.coingecko.com/api/v3";

export type Price = { usd: number; idr: number };
type Entry<T> = { at: number; data: T };
type Snapshot = {
  native?: Entry<Record<number, Price | null>>;
  tokens: Record<string, Entry<Record<string, Price | null>>>;
};

const TTL = 5 * 60_000;
const STALE_MAX = 24 * 3_600_000;
const COOLDOWN = 2 * 60_000;

const NATIVE_ID: Record<number, string> = {
  1: "ethereum",
  8453: "ethereum",
  56: "binancecoin",
  137: "polygon-ecosystem-token",
};
const PLATFORM: Record<number, string> = {
  1: "ethereum",
  56: "binance-smart-chain",
  137: "polygon-pos",
  8453: "base",
};

let snap: Snapshot = load<Snapshot>("prices", { tokens: {} });
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
      // 429 / CORS / timeout: beri jeda. Status 400 = permintaan salah, bukan beban server.
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

async function cached<T>(
  entry: Entry<T> | undefined,
  fetcher: () => Promise<T>,
  store: (e: Entry<T>) => void,
): Promise<T> {
  const now = Date.now();
  if (entry && now - entry.at < TTL) return entry.data;
  const usable = entry && now - entry.at < STALE_MAX ? entry.data : undefined;
  if (now < blockedUntil) {
    if (usable) return usable;
    throw new Error("Harga sementara dibatasi (rate limit). Coba lagi sebentar lagi.");
  }
  try {
    const data = await fetcher();
    store({ at: Date.now(), data });
    save("prices", snap);
    return data;
  } catch (e) {
    if (usable) return usable;
    throw e;
  }
}

const toPrice = (x?: Partial<Price>): Price | null =>
  x && typeof x.usd === "number" ? { usd: x.usd, idr: typeof x.idr === "number" ? x.idr : 0 } : null;

/** Harga koin native per chainId (hanya mainnet bawaan). */
export function nativePrices(): Promise<Record<number, Price | null>> {
  return cached(
    snap.native,
    async () => {
      const ids = [...new Set(Object.values(NATIVE_ID))].join(",");
      const j = await getJson(`${API}/simple/price?ids=${ids}&vs_currencies=usd,idr`);
      const out: Record<number, Price | null> = {};
      for (const [chainId, id] of Object.entries(NATIVE_ID)) out[Number(chainId)] = toPrice(j[id]);
      return out;
    },
    (e) => {
      snap.native = e;
    },
  );
}

/** Harga token per alamat contract (kunci = alamat huruf kecil). */
export async function tokenPrices(chainId: number, addresses: string[]): Promise<Record<string, Price | null>> {
  const platform = PLATFORM[chainId];
  if (!platform || addresses.length === 0) return {};
  const addrs = [...new Set(addresses.map((a) => a.toLowerCase()))].sort();
  const key = `${chainId}:${addrs.join(",")}`;
  return cached(
    snap.tokens[key],
    async () => {
      const one = async (list: string[]) => {
        const j = await getJson(
          `${API}/simple/token_price/${platform}?contract_addresses=${list.join(",")}&vs_currencies=usd,idr`,
        );
        const o: Record<string, Price | null> = {};
        for (const a of list) o[a] = toPrice(j[a]);
        return o;
      };
      const none = () => Object.fromEntries(addrs.map((a) => [a, null])) as Record<string, Price | null>;
      try {
        return await one(addrs);
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 400) throw e;
        if (addrs.length === 1) return none();
        // Ada alamat yang ditolak: periksa satu per satu agar yang valid tetap berharga.
        const out = none();
        for (const a of addrs.slice(0, 8)) {
          try {
            Object.assign(out, await one([a]));
          } catch (e2) {
            if (!(e2 instanceof HttpError) || e2.status !== 400) throw e2;
          }
        }
        return out;
      }
    },
    (e) => {
      for (const k of Object.keys(snap.tokens)) if (k.startsWith(`${chainId}:`)) delete snap.tokens[k];
      snap.tokens[key] = e;
    },
  );
}
