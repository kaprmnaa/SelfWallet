import type { Portfolio } from "../lib/portfolio";
import { timeAgo } from "../lib/format";
import PortfolioPanel from "./PortfolioPanel";
import NetworkCard, { type CardAction } from "./shell/NetworkCard";
import { Skeleton } from "./ui";

type Props = {
  pf: Portfolio;
  testMode: boolean;
  /** Teks ringkas total: sudah diformat (null saat tidak berlaku). */
  totalUsd: string | null;
  /** null = kurs Rupiah tidak tersedia (tidak ditampilkan, tidak dikarang). */
  totalIdr: string | null;
  card: Omit<Parameters<typeof NetworkCard>[0], "actions">;
  actions: CardAction[];
  activeChainId: number;
};

/** Halaman Aset: total semua jaringan (pendukung), kartu jaringan aktif (utama), lalu daftar aset. */
export default function HomePanel({ pf, testMode, totalUsd, totalIdr, card, actions, activeChainId }: Props) {
  return (
    <div className="grid gap-8">
      <div className="flex items-end justify-between gap-4 px-1">
        <div className="min-w-0">
          <p className="text-sm text-zinc-400">Total semua jaringan {testMode ? "testnet" : "mainnet"}</p>
          {pf.loading ? (
            <Skeleton className="mt-2 h-8 w-44" />
          ) : testMode ? (
            <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-zinc-500">Testnet tidak punya nilai uang. Jumlah koin tiap jaringan ada di daftar di bawah.</p>
          ) : pf.priceError && pf.totalUsd === 0 ? (
            <p className="mt-1 text-sm text-zinc-500">Harga tidak bisa dimuat. Jumlah koin tetap ada di daftar di bawah.</p>
          ) : (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-3 text-zinc-50">
              <span className="text-[1.75rem] font-medium tracking-[-0.02em] tabular-nums">{totalUsd}</span>
              <span className="text-sm text-zinc-400 tabular-nums">
                {[totalIdr, pf.unpriced > 0 ? `${pf.unpriced} aset belum berharga` : null].filter(Boolean).join(", ")}
              </span>
            </p>
          )}
        </div>
        <p className="hidden shrink-0 pb-1 text-xs text-zinc-500 sm:block">{pf.updated ? `Diperbarui ${timeAgo(pf.updated)}` : "Memuat…"}</p>
      </div>

      <NetworkCard {...card} actions={actions} />

      <PortfolioPanel pf={pf} testMode={testMode} activeChainId={activeChainId} />
    </div>
  );
}
