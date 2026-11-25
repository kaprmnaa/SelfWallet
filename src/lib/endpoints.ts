import { kindOf, type ChainConfig } from "./chains";
import { parseRpcUrl } from "./customChains";
import { probeRpc } from "./rpc";
import { zecTip } from "../chains/zcash/provider";
import { btcTip } from "../chains/bitcoin/esplora";
import { assertSolCluster } from "../chains/solana/rpc";

/** Rapikan URL endpoint. Esplora (Bitcoin) memakai base URL tanpa garis miring di akhir. */
export function normalizeEndpoint(chain: ChainConfig, raw: string): string {
  const u = parseRpcUrl(raw);
  return kindOf(chain) === "btc" || kindOf(chain) === "zec" ? u.replace(/\/+$/, "") : u;
}

/** Uji satu endpoint untuk jaringan ini. Mengembalikan latensi (ms) atau melempar galat yang jelas. */
export async function testEndpoint(chain: ChainConfig, url: string): Promise<number> {
  const probe: ChainConfig = { ...chain, rpcUrls: [url] };
  const t0 = performance.now();
  switch (kindOf(chain)) {
    case "btc":
      await btcTip(probe, true); // diagnosa: abaikan jeda pemutus sirkuit
      break;
    case "sol":
      await assertSolCluster(probe); // memastikan cluster (genesis hash) cocok
      break;
    case "zec":
      await zecTip(probe); // tinggi blok valid = endpoint Zcash hidup
      break;
    default: {
      const id = await probeRpc(url);
      if (id !== chain.chainId) throw new Error(`RPC ini melayani chain ID ${id}, bukan ${chain.chainId}.`);
    }
  }
  return Math.round(performance.now() - t0);
}
