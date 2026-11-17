import { useEffect, useState } from "react";
import { formatEther, formatUnits } from "ethers";
import { kindOf, type ChainConfig } from "./chains";
import { withProvider } from "./rpc";
import { tokenBalance, type TokenInfo } from "./tokens";
import { nativePrices, tokenPrices, type Price } from "./prices";
import { useVisibleInterval } from "./visibility";
import type { Account } from "./vault";
import { solAccount } from "../core/derive";
import { scanBtc } from "../chains/bitcoin/account";
import { solBalance } from "../chains/solana/rpc";

export type PortfolioRow = {
  chain: ChainConfig;
  symbol: string;
  name: string;
  address?: string;
  amount: string;
  usd: number | null;
  idr: number | null;
  error: boolean;
  /** Pengganti jumlah, mis. "perlu recovery phrase". */
  note?: string;
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

const base = (chain: ChainConfig): PortfolioRow => ({
  chain,
  symbol: chain.symbol,
  name: chain.name,
  amount: "0",
  usd: null,
  idr: null,
  error: false,
});

export async function rowsFor(chain: ChainConfig, account: Account, allTokens: Record<string, TokenInfo[]>): Promise<PortfolioRow[]> {
  const kind = kindOf(chain);

  if (kind === "btc") {
    try {
      const scan = await scanBtc(chain, account);
      if (!scan) return [{ ...base(chain), note: "perlu recovery phrase" }];
      return [{ ...base(chain), amount: formatUnits(scan.total, 8) }];
    } catch {
      return [{ ...base(chain), error: true }];
    }
  }

  if (kind === "sol") {
    const sol = solAccount(account);
    if (!sol) return [{ ...base(chain), note: "perlu recovery phrase" }];
    try {
      return [{ ...base(chain), amount: formatUnits(await solBalance(chain, sol.address), 9) }];
    } catch {
      return [{ ...base(chain), error: true }];
    }
  }

  const toks = allTokens[String(chain.chainId)] ?? [];
  const [nat, ...tk] = await Promise.allSettled([
    withProvider(chain, (p) => p.getBalance(account.address)),
    ...toks.map((t) => tokenBalance(chain, t, account.address)),
  ]);
  const rows: PortfolioRow[] = [
    {
      ...base(chain),
      amount: nat.status === "fulfilled" ? formatEther(nat.value) : "0",
      error: nat.status === "rejected",
    },
  ];
  toks.forEach((t, i) => {
    const r = tk[i];
    rows.push({
      ...base(chain),
      symbol: t.symbol,
      name: t.name,
      address: t.address,
      amount: r.status === "fulfilled" ? formatUnits(r.value, t.decimals) : "0",
      error: r.status === "rejected",
    });
  });
  return rows;
}

/** Saldo semua jaringan (sesuai mode testnet/mainnet) + nilai uang di mainnet. */
export function usePortfolio(
  account: Account,
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
      let rows = (await Promise.all(chains.map((c) => rowsFor(c, account, allTokens)))).flat();
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
  }, [account, testMode, tokensKey, allChains, tick]);

  useVisibleInterval(() => setTick((t) => t + 1), 60_000);

  const totalUsd = state.rows.reduce((a, r) => a + (r.usd ?? 0), 0);
  const totalIdr = state.rows.reduce((a, r) => a + (r.idr ?? 0), 0);
  const unpriced = testMode ? 0 : state.rows.filter((r) => parseFloat(r.amount) > 0 && r.usd === null).length;

  return { ...state, totalUsd, totalIdr, unpriced, refresh: () => setTick((t) => t + 1) };
}

export type Portfolio = ReturnType<typeof usePortfolio>;
