import { useMemo } from "react";
import { m } from "framer-motion";
import type { ChainConfig } from "../lib/chains";
import { fmtUsd, type Portfolio, type PortfolioRow } from "../lib/portfolio";
import { chainTint } from "../lib/chainTint";
import { trimAmount } from "../lib/format";
import CoinIcon from "./CoinIcon";
import { Notice, Skeleton, spring } from "./ui";

export default function PortfolioPanel({ pf, testMode, activeChainId }: { pf: Portfolio; testMode: boolean; activeChainId?: number }) {
  const groups = useMemo(() => {
    const byChain = new Map<number, { chain: ChainConfig; rows: PortfolioRow[] }>();
    pf.rows.forEach((r) => {
      const g = byChain.get(r.chain.chainId) ?? { chain: r.chain, rows: [] };
      g.rows.push(r);
      byChain.set(r.chain.chainId, g);
    });
    // Jaringan yang sedang aktif tampil paling atas.
    return [...byChain.values()].sort((a, b) => Number(b.chain.chainId === activeChainId) - Number(a.chain.chainId === activeChainId));
  }, [pf.rows, activeChainId]);

  return (
    <div className="grid gap-6">
      {!testMode && pf.priceError && <Notice>Sebagian harga tidak bisa dimuat dari penyedia harga, jadi total bisa kurang dari sebenarnya.</Notice>}
      {!testMode && !pf.priceError && pf.unpriced > 0 && (
        <Notice tone="info">{pf.unpriced} aset belum punya harga yang andal (tidak ditemukan, atau likuiditasnya terlalu kecil) dan tidak dihitung dalam total.</Notice>
      )}

      {pf.loading ? (
        <div className="glass-surface grid gap-4 rounded-2xl border border-white/10 p-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        groups.map((g) => {
          const sub = g.rows.reduce((a, r) => a + (r.usd ?? 0), 0);
          return (
            <section key={g.chain.chainId}>
              <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium text-zinc-200">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: chainTint(g.chain.symbol) }} />
                  <span className="truncate">{g.chain.name}</span>
                </h3>
                {!testMode && <span className="text-sm text-zinc-500 tabular-nums">{fmtUsd(sub)}</span>}
              </div>
              <m.ul
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
                className="glass-surface divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10"
              >
                {g.rows.map((r) => (
                  <m.li
                    key={`${r.chain.chainId}-${r.address ?? "native"}`}
                    variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: spring } }}
                    className="flex items-center justify-between gap-4 px-4 py-3.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <CoinIcon symbol={r.symbol} size={36} />
                      <div className="min-w-0">
                        <p className="truncate text-[15px] text-zinc-100">{r.symbol}</p>
                        <p className="truncate text-xs text-zinc-500">{r.address ? r.name : "Koin native"}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      {r.note ? (
                        <p className="max-w-[10rem] text-xs text-zinc-500">{r.note}</p>
                      ) : r.error ? (
                        <p className="text-xs text-rose-400">Gagal dimuat</p>
                      ) : (
                        <>
                          <p className="text-[15px] text-zinc-100 tabular-nums">{trimAmount(r.amount, 6)}</p>
                          {!testMode && <p className="text-xs text-zinc-500 tabular-nums">{r.usd !== null ? fmtUsd(r.usd) : "Tanpa harga"}</p>}
                        </>
                      )}
                    </div>
                  </m.li>
                ))}
              </m.ul>
            </section>
          );
        })
      )}
    </div>
  );
}
