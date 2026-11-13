import { JsonRpcProvider, Network } from "ethers";
import type { ChainConfig } from "./chains";

const cache = new Map<string, JsonRpcProvider>();

function providerFor(chain: ChainConfig, url: string) {
  const key = `${chain.chainId}:${url}`;
  let p = cache.get(key);
  if (!p) {
    // staticNetwork: tidak ada probing otomatis; chainId diverifikasi eksplisit lewat assertChain.
    p = new JsonRpcProvider(url, chain.chainId, { staticNetwork: Network.from(chain.chainId) });
    cache.set(key, p);
  }
  return p;
}

function withTimeout<T>(pr: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("RPC timeout")), ms);
    pr.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Error deterministik: mencoba RPC lain tidak akan mengubah hasil.
const FATAL = new Set([
  "CALL_EXCEPTION",
  "INSUFFICIENT_FUNDS",
  "NONCE_EXPIRED",
  "REPLACEMENT_UNDERPRICED",
  "UNPREDICTABLE_GAS_LIMIT",
  "ACTION_REJECTED",
  "INVALID_ARGUMENT",
]);

/** Jalankan fn dengan RPC pertama yang berhasil (fallback berurutan). */
export async function withProvider<T>(
  chain: ChainConfig,
  fn: (p: JsonRpcProvider) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (const url of chain.rpcUrls) {
    try {
      return await withTimeout(fn(providerFor(chain, url)), 12_000);
    } catch (e) {
      lastErr = e;
      const code = (e as { code?: string }).code;
      if (code && FATAL.has(code)) throw e;
    }
  }
  throw lastErr ?? new Error("Tidak ada RPC yang tersedia.");
}

/** Pastikan RPC benar-benar melayani chain yang dikonfigurasi. */
export async function assertChain(p: JsonRpcProvider, chain: ChainConfig) {
  const hex: string = await p.send("eth_chainId", []);
  if (BigInt(hex) !== BigInt(chain.chainId)) {
    throw new Error("Chain ID RPC tidak sesuai konfigurasi. Operasi dibatalkan.");
  }
}

/** Tanya chain ID langsung ke sebuah URL RPC (dipakai saat menambah jaringan kustom). */
export async function probeRpc(url: string): Promise<number> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: ctl.signal,
      referrerPolicy: "no-referrer",
    });
    if (!r.ok) throw new Error(`RPC menjawab status ${r.status}.`);
    const j = (await r.json()) as { result?: string };
    if (typeof j.result !== "string") throw new Error("Jawaban RPC tidak valid.");
    const id = Number(BigInt(j.result));
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Chain ID dari RPC tidak wajar.");
    return id;
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") throw new Error("RPC tidak merespons (timeout).");
    if (e instanceof TypeError) throw new Error("RPC tidak bisa dihubungi (jaringan, CORS, atau URL salah).");
    throw e;
  } finally {
    clearTimeout(t);
  }
}
