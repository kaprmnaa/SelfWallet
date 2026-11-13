import { CHAINS, type ChainConfig } from "./chains";

export function parseRpcUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("URL RPC tidak valid.");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    throw new Error("RPC harus memakai https (http hanya untuk localhost).");
  }
  if (u.username || u.password) throw new Error("URL RPC tidak boleh berisi username/password.");
  return u.toString();
}

export function parseExplorerUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new Error("URL explorer tidak valid.");
  }
  if (u.protocol !== "https:") throw new Error("URL explorer harus memakai https.");
  return (u.origin + u.pathname).replace(/\/+$/, "");
}

export type CustomChainInput = {
  name: string;
  symbol: string;
  rpc: string;
  chainId: string;
  explorer: string;
  testnet: boolean;
};

export function buildCustomChain(input: CustomChainInput, existing: ChainConfig[]): ChainConfig {
  const name = input.name.trim();
  if (!name || name.length > 32) throw new Error("Nama jaringan harus 1 sampai 32 karakter.");
  const symbol = input.symbol.trim();
  if (!/^[A-Za-z0-9]{1,10}$/.test(symbol)) throw new Error("Simbol koin native: 1 sampai 10 huruf/angka.");
  const idText = input.chainId.trim();
  if (!/^\d+$/.test(idText)) throw new Error("Chain ID harus angka bulat positif.");
  const chainId = Number(idText);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Chain ID di luar rentang yang didukung.");
  const dup = existing.find((c) => c.chainId === chainId);
  if (dup) throw new Error(`Chain ID ${chainId} sudah dipakai oleh ${dup.name}.`);
  return {
    chainId,
    name,
    symbol,
    testnet: input.testnet,
    rpcUrls: [parseRpcUrl(input.rpc)],
    explorer: parseExplorerUrl(input.explorer),
    custom: true,
  };
}

/** Validasi ulang data dari localStorage (bisa saja rusak atau diubah). */
export function sanitizeStored(x: unknown): ChainConfig | null {
  try {
    const o = x as Partial<ChainConfig>;
    return buildCustomChain(
      {
        name: String(o.name),
        symbol: String(o.symbol),
        rpc: String(o.rpcUrls?.[0]),
        chainId: String(o.chainId),
        explorer: String(o.explorer ?? ""),
        testnet: !!o.testnet,
      },
      CHAINS,
    );
  } catch {
    return null;
  }
}
