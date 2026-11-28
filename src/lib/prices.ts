import { load, save } from "./storage";
import { CHAINS, type ChainConfig } from "./chains";

/**
 * Harga dari beberapa sumber publik tanpa key, dengan cadangan berlapis supaya aset tidak "tanpa harga" hanya
 * karena satu penyedia membatasi laju. HANYA id koin / simbol / alamat contract token yang dikirim ke penyedia,
 * TIDAK ada alamat dompet Anda.
 *
 *  Koin native : DefiLlama -> Binance (data-api.binance.vision) -> CoinGecko
 *  Token       : DefiLlama (banyak alamat per permintaan) -> DexScreener -> CoinGecko (satu alamat per permintaan)
 *  Kurs Rupiah : dihitung dari kurs USD->IDR (open.er-api.com -> Frankfurter), atau dari CoinGecko bila ada
 *
 * Perlindungan token palsu/spam: harga dari DEX hanya diterima jika likuiditas pasangan >= MIN_LIQUIDITY_USD, dan
 * harga DefiLlama hanya jika confidence >= MIN_CONFIDENCE. Token tanpa harga yang lolos pemeriksaan tetap "tanpa harga"
 * (lebih baik daripada menampilkan nilai palsu yang bisa menyesatkan total aset dan Goal).
 *
 * Tiap penyedia punya jeda sendiri (2 menit setelah gagal/dibatasi), hasil di-cache (5 menit) dan disimpan di
 * localStorage; data lama (<= 24 jam) dipakai bila semua sumber gagal.
 */
export type Price = { usd: number; idr: number };
type Entry<T> = { at: number; data: T; ttl?: number };
type Snapshot = {
  native?: Entry<Record<number, Price | null>>;
  tokens: Record<string, Entry<Price | null>>;
  fx?: { at: number; rate: number };
  cgPlatforms?: Entry<Record<number, string>>;
};
type Src = "llama" | "binance" | "coingecko" | "dexscreener" | "fx" | "fx2";

const CG = "https://api.coingecko.com/api/v3";
const LLAMA = "https://coins.llama.fi/prices/current";
const BINANCE = "https://data-api.binance.vision/api/v3/ticker/price";
const DEXSCREENER = "https://api.dexscreener.com/latest/dex/tokens";
const FX_PRIMARY = "https://open.er-api.com/v6/latest/USD";
const FX_FALLBACK = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=IDR";

const TTL = 5 * 60_000;
const UNKNOWN_TTL = 3 * 60_000; // tak ditemukan karena ada sumber yang gagal: coba lagi sebentar lagi
const REJECTED_TTL = 30 * 60_000; // semua sumber utama menjawab dan tidak mengenal token ini
const FX_TTL = 6 * 3_600_000;
const FX_STALE_MAX = 7 * 24 * 3_600_000;
const STALE_MAX = 24 * 3_600_000;
const PLATFORM_TTL = 24 * 3_600_000;
const COOLDOWN = 2 * 60_000;
const MAX_CG_REQUESTS_PER_ROUND = 6;
const CG_SPACING_MS = 1_100;
const LLAMA_CHUNK = 40;
const DEX_CHUNK = 30;
export const MIN_CONFIDENCE = 0.8;
export const MIN_LIQUIDITY_USD = 50_000;

/** Koin native per chainId: id CoinGecko (juga dipakai DefiLlama) dan simbol pasangan Binance. */
const NATIVE: Record<number, { cg: string; sym: string }> = {
  1: { cg: "ethereum", sym: "ETH" },
  9745: { cg: "plasma", sym: "XPL" },
  8453: { cg: "ethereum", sym: "ETH" },
  56: { cg: "binancecoin", sym: "BNB" },
  137: { cg: "polygon-ecosystem-token", sym: "POL" },
  900_000_001: { cg: "bitcoin", sym: "BTC" },
  900_000_101: { cg: "solana", sym: "SOL" },
  900_000_201: { cg: "zcash", sym: "ZEC" },
};

const LLAMA_CHAIN: Record<number, string> = { 1: "ethereum", 9745: "plasma", 56: "bsc", 137: "polygon", 8453: "base", 10: "optimism", 42161: "arbitrum", 43114: "avax", 250: "fantom", 100: "xdai" };
const DEX_CHAIN: Record<number, string> = { 1: "ethereum", 9745: "plasma", 56: "bsc", 137: "polygon", 8453: "base", 10: "optimism", 42161: "arbitrum", 43114: "avalanche", 250: "fantom", 100: "gnosischain" };
const CG_PLATFORM: Record<number, string> = {
  1: "ethereum",
  9745: "plasma",
  56: "binance-smart-chain",
  137: "polygon-pos",
  8453: "base",
  10: "optimistic-ethereum",
  42161: "arbitrum-one",
  43114: "avalanche",
  250: "fantom",
  100: "xdai",
};

const STORE_KEY = "prices2";
let snap: Snapshot = load<Snapshot>(STORE_KEY, { tokens: {} });
if (!snap || typeof snap !== "object" || !snap.tokens) snap = { tokens: {} };

const blocked: Partial<Record<Src, number>> = {};
const inflight = new Map<string, Promise<unknown>>();

class HttpError extends Error {
  constructor(public status: number) {
    super(`harga HTTP ${status}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const okNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

/** GET JSON dengan jeda per sumber. 400/404 = permintaan/ data tidak ada, bukan beban server: tanpa jeda. */
function getJson<T>(src: Src, url: string): Promise<T> {
  const existing = inflight.get(url);
  if (existing) return existing as Promise<T>;
  if (Date.now() < (blocked[src] ?? 0)) return Promise.reject(new Error(`${src} sedang dijeda`));
  const p = (async () => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    try {
      const r = await fetch(url, { signal: ctl.signal, referrerPolicy: "no-referrer" });
      if (!r.ok) throw new HttpError(r.status);
      return (await r.json()) as T;
    } catch (e) {
      if (!(e instanceof HttpError && (e.status === 400 || e.status === 404))) blocked[src] = Date.now() + COOLDOWN;
      throw e;
    } finally {
      clearTimeout(t);
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

/** Custom mainnet juga dapat dicari otomatis dari simbol koin native. */
export const hasNativePrice = (chain: ChainConfig) =>
  !chain.testnet && (chain.chainId in NATIVE || chain.custom === true);

/* ------------------------------------------------------------- kurs IDR */

/** Kurs USD -> IDR (cache 6 jam). 0 jika tidak ada sumber (IDR lalu tidak ditampilkan, tidak dikarang). */
async function fxRate(): Promise<number> {
  const now = Date.now();
  if (snap.fx && now - snap.fx.at < FX_TTL) return snap.fx.rate;
  const sane = (x: unknown): x is number => okNum(x) && x > 1_000 && x < 100_000;
  const save_ = (rate: number) => {
    snap.fx = { at: Date.now(), rate };
    save(STORE_KEY, snap);
    return rate;
  };
  try {
    const j = await getJson<{ rates?: { IDR?: number } }>("fx", FX_PRIMARY);
    if (sane(j.rates?.IDR)) return save_(j.rates!.IDR!);
  } catch {
    /* coba cadangan */
  }
  try {
    const j = await getJson<{ rates?: { IDR?: number } }>("fx2", FX_FALLBACK);
    if (sane(j.rates?.IDR)) return save_(j.rates!.IDR!);
  } catch {
    /* pakai data lama */
  }
  return snap.fx && now - snap.fx.at < FX_STALE_MAX ? snap.fx.rate : 0;
}

/* ---------------------------------------------------------- koin native */

type NativeUsd = Record<string, { usd: number; idr?: number }>; // kunci = id CoinGecko

async function nativeFromLlama(ids: string[]): Promise<NativeUsd> {
  const j = await getJson<{ coins?: Record<string, { price?: number; confidence?: number }> }>("llama", `${LLAMA}/${ids.map((i) => `coingecko:${i}`).join(",")}?searchWidth=4h`);
  const out: NativeUsd = {};
  for (const id of ids) {
    const c = j.coins?.[`coingecko:${id}`];
    if (c && okNum(c.price) && (c.confidence === undefined || c.confidence >= 0.5)) out[id] = { usd: c.price };
  }
  return out;
}

async function nativeFromBinance(ids: string[]): Promise<NativeUsd> {
  const bySym = new Map<string, string>(); // simbol pasangan -> id CoinGecko
  for (const v of Object.values(NATIVE)) if (ids.includes(v.cg)) bySym.set(`${v.sym}USDT`, v.cg);
  if (bySym.size === 0) return {};
  const symbols = encodeURIComponent(JSON.stringify([...bySym.keys()]));
  const rows = await getJson<{ symbol: string; price: string }[]>("binance", `${BINANCE}?symbols=${symbols}`);
  const out: NativeUsd = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = bySym.get(r.symbol);
    const p = Number(r.price);
    if (id && okNum(p)) out[id] = { usd: p }; // USDT dianggap setara USD
  }
  return out;
}

async function nativeFromCoinGecko(ids: string[]): Promise<NativeUsd> {
  const j = await getJson<Record<string, { usd?: number; idr?: number }>>("coingecko", `${CG}/simple/price?ids=${ids.join(",")}&vs_currencies=usd,idr`);
  const out: NativeUsd = {};
  for (const id of ids) {
    const c = j[id];
    if (c && okNum(c.usd)) out[id] = { usd: c.usd, idr: okNum(c.idr) ? c.idr : undefined };
  }
  return out;
}

async function customNativeIds(chains: ChainConfig[]): Promise<Record<number, string>> {
  const custom = chains.filter((c) => c.custom && !c.testnet && !(c.chainId in NATIVE));
  const out: Record<number, string> = {};
  const knownBySymbol = new Map<string, Set<string>>();
  for (const v of Object.values(NATIVE)) {
    const symbol = v.sym.toLowerCase();
    const ids = knownBySymbol.get(symbol) ?? new Set<string>();
    ids.add(v.cg);
    knownBySymbol.set(symbol, ids);
  }
  for (const chain of custom) {
    const symbol = chain.symbol.toLowerCase();
    const known = knownBySymbol.get(symbol);
    if (known?.size === 1) {
      out[chain.chainId] = [...known][0];
      continue;
    }
    if (known && known.size > 1) continue;
    const url = `${CG}/search?query=${encodeURIComponent(chain.symbol)}`;
    try {
      const j = await getJson<{ coins?: { id?: string; symbol?: string }[] }>("coingecko", url);
      const matches = (j.coins ?? []).filter((c) => c.id && c.symbol?.toLowerCase() === symbol);
      const ids = [...new Set(matches.map((c) => c.id!))];
      if (ids.length === 1) {
        out[chain.chainId] = ids[0];
      }
    } catch {
      // Harga native bawaan tetap tersedia; custom chain yang gagal dicari tidak diberi harga tebakan.
    }
  }
  return out;
}

/** Harga koin native per chainId. Custom mainnet dicari otomatis berdasarkan simbol yang cocok tunggal. */
export async function nativePrices(chains: ChainConfig[] = CHAINS): Promise<Record<number, Price | null>> {
  const now = Date.now();
  const entry = snap.native;
  const requested = chains.filter((c) => !c.testnet);
  if (entry && now - entry.at < TTL && requested.every((c) => c.chainId in entry.data)) return entry.data;
  const usable = entry && now - entry.at < STALE_MAX ? entry.data : undefined;

  const allIds = [...new Set(Object.values(NATIVE).map((v) => v.cg))];
  const got: NativeUsd = {};
  let lastErr: unknown = null;
  for (const src of [nativeFromLlama, nativeFromBinance, nativeFromCoinGecko]) {
    const missing = allIds.filter((id) => !got[id]);
    if (missing.length === 0) break;
    try {
      Object.assign(got, await src(missing));
    } catch (e) {
      lastErr = e;
    }
  }
  const customIds = await customNativeIds(chains);
  const missingCustomIds = [...new Set(Object.values(customIds).filter((id) => !got[id]))];
  if (missingCustomIds.length > 0) {
    try {
      Object.assign(got, await nativeFromCoinGecko(missingCustomIds));
    } catch (e) {
      lastErr = e;
    }
  }
  if (Object.keys(got).length === 0) {
    if (usable) return usable;
    throw lastErr instanceof Error ? lastErr : new Error("Harga koin tidak bisa dimuat dari sumber mana pun.");
  }

  // Kurs IDR dari CoinGecko (bila ikut menjawab) memperbarui kurs tersimpan; selain itu dari API kurs.
  const cgImplied = Object.values(got).find((g) => g.idr && g.idr > 0);
  let fx = 0;
  if (cgImplied) {
    const id = Object.keys(got).find((k) => got[k] === cgImplied)!;
    fx = cgImplied.idr! / got[id].usd;
    snap.fx = { at: Date.now(), rate: fx };
  } else fx = await fxRate();

  const out: Record<number, Price | null> = {};
  for (const [chainId, v] of Object.entries(NATIVE)) {
    const g = got[v.cg];
    out[Number(chainId)] = g ? { usd: g.usd, idr: g.idr ?? g.usd * fx } : (usable?.[Number(chainId)] ?? null);
  }
  for (const chain of chains.filter((c) => c.custom && !c.testnet && !(c.chainId in NATIVE))) {
    const id = customIds[chain.chainId];
    const g = id ? got[id] : undefined;
    out[chain.chainId] = g ? { usd: g.usd, idr: g.idr ?? g.usd * fx } : (usable?.[chain.chainId] ?? null);
  }
  snap.native = { at: Date.now(), data: out };
  save(STORE_KEY, snap);
  return out;
}

/* ---------------------------------------------------------------- token */

async function tokensFromLlama(chainId: number, addrs: string[]): Promise<Record<string, number>> {
  const slug = LLAMA_CHAIN[chainId];
  if (!slug) return {};
  const out: Record<string, number> = {};
  for (let i = 0; i < addrs.length; i += LLAMA_CHUNK) {
    const chunk = addrs.slice(i, i + LLAMA_CHUNK);
    const j = await getJson<{ coins?: Record<string, { price?: number; confidence?: number }> }>(
      "llama",
      `${LLAMA}/${chunk.map((a) => `${slug}:${a}`).join(",")}?searchWidth=4h`,
    );
    const lower = new Map(Object.entries(j.coins ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    for (const a of chunk) {
      const c = lower.get(`${slug}:${a}`);
      if (c && okNum(c.price) && (c.confidence === undefined || c.confidence >= MIN_CONFIDENCE)) out[a] = c.price;
    }
  }
  return out;
}

type DexPair = { chainId?: string; baseToken?: { address?: string }; priceUsd?: string; liquidity?: { usd?: number } };

async function tokensFromDexScreener(chainId: number, addrs: string[]): Promise<Record<string, number>> {
  const chain = DEX_CHAIN[chainId];
  if (!chain) return {};
  const out: Record<string, number> = {};
  for (let i = 0; i < addrs.length; i += DEX_CHUNK) {
    const chunk = addrs.slice(i, i + DEX_CHUNK);
    const j = await getJson<{ pairs?: DexPair[] | null }>("dexscreener", `${DEXSCREENER}/${chunk.join(",")}`);
    const best = new Map<string, { liq: number; price: number }>();
    for (const p of j.pairs ?? []) {
      const a = p.baseToken?.address?.toLowerCase();
      const liq = Number(p.liquidity?.usd);
      const price = Number(p.priceUsd);
      if (p.chainId !== chain || !a || !chunk.includes(a) || !okNum(price) || !(liq >= MIN_LIQUIDITY_USD)) continue;
      if (!best.has(a) || liq > best.get(a)!.liq) best.set(a, { liq, price });
    }
    for (const [a, b] of best) out[a] = b.price;
  }
  return out;
}

async function cgPlatformForChain(chainId: number): Promise<string | undefined> {
  const now = Date.now();
  const cached = snap.cgPlatforms;
  if (cached && now - cached.at < PLATFORM_TTL) return cached.data[chainId];

  try {
    const platforms = await getJson<{ id?: string; chain_identifier?: number | string }[]>("coingecko", `${CG}/asset_platforms`);
    const mapped: Record<number, string> = {};
    for (const p of platforms) {
      const id = Number(p.chain_identifier);
      if (p.id && Number.isSafeInteger(id) && id > 0) mapped[id] = p.id;
    }
    snap.cgPlatforms = { at: now, data: mapped };
    save(STORE_KEY, snap);
    return mapped[chainId];
  } catch {
    return cached?.data[chainId];
  }
}

/**
 * Harga token per alamat contract (kunci = alamat huruf kecil). Alamat yang belum ter-cache dicari berlapis:
 * DefiLlama (batch), DexScreener (batch), lalu CoinGecko satu per satu (maks. 6 per putaran). Melempar error hanya jika
 * SEMUA sumber gagal sementara dan tidak ada harga (baru maupun lama) sama sekali.
 */
export async function tokenPrices(
  chainId: number,
  addresses: string[],
  customChain?: ChainConfig,
): Promise<Record<string, Price | null>> {
  const isMatchingCustomChain = customChain?.custom === true && customChain.chainId === chainId;
  if (!(chainId in LLAMA_CHAIN) && !(chainId in CG_PLATFORM) && !isMatchingCustomChain) return {};
  if (addresses.length === 0) return {};
  const addrs = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out: Record<string, Price | null> = {};
  const need: string[] = [];
  const now = Date.now();
  for (const a of addrs) {
    const entry = snap.tokens[`${chainId}:${a}`];
    if (entry && now - entry.at < (entry.ttl ?? TTL)) out[a] = entry.data;
    else need.push(a);
  }
  if (need.length === 0) return out;

  const usd: Record<string, number> = {};
  const idrFromCg: Record<string, number> = {};
  let llamaOk = false;
  let dexOk = false;

  try {
    Object.assign(usd, await tokensFromLlama(chainId, need));
    llamaOk = true;
  } catch {
    /* lanjut ke sumber berikutnya */
  }
  let rest = need.filter((a) => !(a in usd));
  if (rest.length > 0) {
    try {
      Object.assign(usd, await tokensFromDexScreener(chainId, rest));
      dexOk = true;
    } catch {
      /* lanjut */
    }
    rest = need.filter((a) => !(a in usd));
  }

  const platform = CG_PLATFORM[chainId] ??
    (isMatchingCustomChain ? await cgPlatformForChain(chainId) : undefined);
  if (rest.length > 0 && platform) {
    let budget = MAX_CG_REQUESTS_PER_ROUND;
    let requested = false;
    for (const a of rest) {
      if (budget <= 0 || Date.now() < (blocked.coingecko ?? 0)) break;
      try {
        if (requested) await sleep(CG_SPACING_MS);
        requested = true;
        budget--;
        const j = await getJson<Record<string, { usd?: number; idr?: number }>>("coingecko", `${CG}/simple/token_price/${platform}?contract_addresses=${a}&vs_currencies=usd,idr`);
        const c = j[a];
        if (c && okNum(c.usd)) {
          usd[a] = c.usd;
          if (okNum(c.idr)) idrFromCg[a] = c.idr;
        }
      } catch (e) {
        void e; // 400 = token tak dikenal CoinGecko; selain itu sumber sedang dijeda (otomatis oleh getJson)
      }
    }
  }

  const fx = Object.keys(usd).some((a) => !(a in idrFromCg)) ? await fxRate() : 0;
  let changed = false;
  let transient = 0;
  for (const a of need) {
    const key = `${chainId}:${a}`;
    const old = snap.tokens[key];
    const stale = old && Date.now() - old.at < STALE_MAX ? old.data : null;
    if (a in usd) {
      const price: Price = { usd: usd[a], idr: idrFromCg[a] ?? usd[a] * fx };
      snap.tokens[key] = { at: Date.now(), data: price };
      out[a] = price;
      changed = true;
    } else if (llamaOk && dexOk) {
      // Dua sumber utama menjawab dan tidak ada harga yang lolos (tak dikenal / likuiditas kecil): jangan diulang-ulang.
      snap.tokens[key] = { at: Date.now(), data: null, ttl: REJECTED_TTL };
      out[a] = null;
      changed = true;
    } else {
      // Ada sumber yang gagal: pakai data lama, dan coba lagi sebentar lagi.
      out[a] = stale;
      transient++;
      if (!old || old.data === null) {
        snap.tokens[key] = { at: Date.now(), data: stale, ttl: UNKNOWN_TTL };
        changed = true;
      }
    }
  }
  if (changed) save(STORE_KEY, snap);
  if (transient > 0 && Object.values(out).every((v) => v === null)) throw new Error("Harga token sementara tidak tersedia.");
  return out;
}

/** Hanya untuk pengujian: kosongkan cache, jeda, dan permintaan yang sedang berjalan. */
export function resetPriceState() {
  snap = { tokens: {} };
  for (const k of Object.keys(blocked)) delete blocked[k as Src];
  inflight.clear();
}
