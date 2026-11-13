import { useEffect, useState } from "react";
import { formatEther, formatUnits } from "ethers";
import type { ChainConfig } from "./chains";
import { withProvider } from "./rpc";
import { tokenBalance, type TokenInfo } from "./tokens";
import { nativePrices, tokenPrices, type Price } from "./prices";
import { useVisibleInterval } from "./visibility";

export type PortfolioRow = {
  chain: ChainConfig;
  symbol: string;
  name: string;
  address?: string;
  amount: string;
  usd: number | null;
  idr: number | null;
  error: boolean;
};

type State = {
  loading: boolean;
  rows: PortfolioRow[];
  priceError: boolean;
  updated: number | null;
};

export const fmtUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
export const fmtIdr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

/** Saldo semua jaringan (sesuai mode testnet/mainnet) + nilai uang di mainnet. */
export function usePortfolio(
  address: string,
  testMode: boolean,
  allTokens: Record<string, TokenInfo[]>,
  allChains: ChainConfig[],
) {
  const [state, setState] = useState<State>({ loading: true, rows: [], priceError: false, updated: null });
  const [tick, setTick] = useState(0);
  const tokensKey = JSON.stringify(allTokens);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: s.rows.length === 0 }));

    (async () => {
      const chains = allChains.filter((c) => c.testnet === testMode);
      const perChain = await Promise.all(
        chains.map(async (chain): Promise<PortfolioRow[]> => {
          const toks = allTokens[String(chain.chainId)] ?? [];
          const [nat, ...tk] = await Promise.allSettled([
            withProvider(chain, (p) => p.getBalance(address)),
            ...toks.map((t) => tokenBalance(chain, t, address)),
          ]);
          const rows: PortfolioRow[] = [
            {
              chain,
              symbol: chain.symbol,
              name: chain.name,
              amount: nat.status === "fulfilled" ? formatEther(nat.value) : "0",
              usd: null,
              idr: null,
              error: nat.status === "rejected",
            },
          ];
          toks.forEach((t, i) => {
            const r = tk[i];
            rows.push({
              chain,
              symbol: t.symbol,
              name: t.name,
              address: t.address,
              amount: r.status === "fulfilled" ? formatUnits(r.value, t.decimals) : "0",
              usd: null,
              idr: null,
              error: r.status === "rejected",
            });
          });
          return rows;
        }),
      );
      let rows = perChain.flat();
      let priceError = false;

      if (!testMode) {
        try {
          const nat = await nativePrices();
          const byChainTok: Record<number, Record<string, Price | null>> = {};
          // Berurutan (bukan paralel) agar tidak memicu rate limit CoinGecko.
          for (const c of chains) {
            const addrs = rows.filter((r) => r.chain.chainId === c.chainId && r.address).map((r) => r.address!);
            if (addrs.length === 0) continue;
            try {
              byChainTok[c.chainId] = await tokenPrices(c.chainId, addrs);
            } catch {
              priceError = true;
              byChainTok[c.chainId] = {};
            }
          }
          rows = rows.map((r) => {
            const price = r.address ? byChainTok[r.chain.chainId]?.[r.address.toLowerCase()] : nat[r.chain.chainId];
            const n = parseFloat(r.amount);
            return price ? { ...r, usd: n * price.usd, idr: n * price.idr } : r;
          });
        } catch {
          priceError = true;
        }
      }

      if (alive) setState({ loading: false, rows, priceError, updated: Date.now() });
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, testMode, tokensKey, allChains, tick]);

  useVisibleInterval(() => setTick((t) => t + 1), 60_000);

  const totalUsd = state.rows.reduce((a, r) => a + (r.usd ?? 0), 0);
  const totalIdr = state.rows.reduce((a, r) => a + (r.idr ?? 0), 0);
  const unpriced = testMode ? 0 : state.rows.filter((r) => parseFloat(r.amount) > 0 && r.usd === null).length;

  return { ...state, totalUsd, totalIdr, unpriced, refresh: () => setTick((t) => t + 1) };
}

export type Portfolio = ReturnType<typeof usePortfolio>;
