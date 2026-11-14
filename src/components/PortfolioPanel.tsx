import { useMemo } from "react";
import { m } from "framer-motion";
import { ArrowsClockwise } from "@phosphor-icons/react";
import type { ChainConfig } from "../lib/chains";
import { fmtUsd, type Portfolio, type PortfolioRow } from "../lib/portfolio";
import { timeAgo, trimAmount } from "../lib/format";
import CoinIcon from "./CoinIcon";
import { Notice, Skeleton, spring } from "./ui";

export default function PortfolioPanel({ pf, testMode }: { pf: Portfolio; testMode: boolean }) {
  const groups = useMemo(() => {
    const byChain = new Map<number, { chain: ChainConfig; rows: PortfolioRow[] }>();
    pf.rows.forEach((r) => {
      const g = byChain.get(r.chain.chainId) ?? { chain: r.chain, rows: [] };
      g.rows.push(r);
      byChain.set(r.chain.chainId, g);
    });
    return [...byChain.values()];
  }, [pf.rows]);

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-zinc-500">
          {pf.updated ? `Diperbarui ${timeAgo(pf.updated)}` : "Memuat saldo semua jaringan…"}
        </p>
        <button
          type="button"
          onClick={pf.refresh}
          aria-label="Segarkan portofolio"
          className="grid size-8 place-items-center rounded-lg text-zinc-500 transition-colors duration-300 hover:bg-white/5 hover:text-zinc-200 active:scale-95"
        >
          <ArrowsClockwise />
        </button>
      </div>

      {testMode && (
        <Notice tone="info">Testnet tidak memiliki nilai uang. Yang ditampilkan hanya jumlah koin per jaringan.</Notice>
      )}
      {!testMode && pf.priceError && (
        <Notice>Sebagian harga tidak bisa dimuat dari CoinGecko, jadi total bisa kurang dari sebenarnya.</Notice>
      )}
      {!testMode && !pf.priceError && pf.unpriced > 0 && (
        <Notice tone="info">
          {pf.unpriced} aset belum punya harga di CoinGecko dan tidak dihitung dalam total.
        </Notice>
      )}

      {pf.loading ? (
        <div className="grid gap-4 border-y border-white/[0.06] py-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        groups.map((g) => {
          const sub = g.rows.reduce((a, r) => a + (r.usd ?? 0), 0);
          return (
            <section key={g.chain.chainId}>
              <div className="flex items-baseline justify-between">
                <h3 className="text-xs uppercase tracking-[0.14em] text-zinc-500">{g.chain.name}</h3>
                {!testMode && <span className="font-mono text-xs text-zinc-500">{fmtUsd(sub)}</span>}
              </div>
              <m.ul
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
                className="mt-3 divide-y divide-white/[0.06] border-y border-white/[0.06]"
              >
                {g.rows.map((r) => (
                  <m.li
                    key={`${r.chain.chainId}-${r.address ?? "native"}`}
                    variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: spring } }}
                    className="flex items-center justify-between gap-4 py-3.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <CoinIcon symbol={r.symbol} size={32} />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-zinc-100">{r.symbol}</p>
                        <p className="truncate text-xs text-zinc-600">{r.address ? r.name : "koin native"}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      {r.note ? (
                        <p className="max-w-[10rem] text-xs text-zinc-500">{r.note}</p>
                      ) : r.error ? (
                        <p className="text-xs text-rose-400">gagal dimuat</p>
                      ) : (
                        <>
                          <p className="font-mono text-sm text-zinc-100">{trimAmount(r.amount, 6)}</p>
                          {!testMode && (
                            <p className="font-mono text-xs text-zinc-500">{r.usd !== null ? fmtUsd(r.usd) : "tanpa harga"}</p>
                          )}
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
