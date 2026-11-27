import type { CSSProperties, ReactNode } from "react";
import { m } from "framer-motion";
import { ArrowSquareOut, ArrowsClockwise } from "@phosphor-icons/react";
import { chainTint } from "../../lib/chainTint";
import CoinIcon from "../CoinIcon";
import { CopyButton, Notice, Skeleton, spring } from "../ui";
import type { NavIcon } from "./nav";

export type CardAction = { key: string; label: string; icon: NavIcon; primary?: boolean; onClick: () => void };

type Props = {
  name: string;
  symbol: string;
  testnet: boolean;
  /** Saldo koin native yang sudah diformat; null = belum ada / gagal. */
  balance: string | null;
  loading: boolean;
  /** Nilai fiat dari saldo native, sudah diformat (null = tanpa harga / testnet). */
  fiat: string | null;
  pending: string | null;
  note: string | null;
  error: string | null;
  unsupported: string | null;
  address: string | null;
  explorerLink: string | null;
  emptyHint: string | null;
  actions: CardAction[];
  status?: ReactNode;
  onRefresh: () => void;
  onOpenEndpoints: () => void;
};

/**
 * Kartu jaringan aktif: pusat halaman Aset. Yang besar adalah saldo jaringan yang sedang dipilih, karena
 * itulah yang bisa langsung dikirim/diterima. Cahaya lembut memakai warna khas jaringan.
 */
export default function NetworkCard(p: Props) {
  const tint = chainTint(p.symbol);
  return (
    <section
      className="glass-surface glass-rim relative overflow-hidden rounded-[2rem] p-6 sm:p-7"
      style={{ "--tint": tint } as CSSProperties}
      aria-label={`Saldo ${p.name}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-24 size-[22rem] rounded-full"
        style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--tint) 30%, transparent), transparent)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-16 size-[18rem] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(57,139,255,0.16), transparent)" }}
      />

      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="grid size-11 shrink-0 place-items-center rounded-full bg-black/20"
              style={{ boxShadow: "0 0 0 1px color-mix(in srgb, var(--tint) 55%, transparent), 0 0 26px color-mix(in srgb, var(--tint) 32%, transparent)" }}
            >
              <CoinIcon symbol={p.symbol} size={28} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium text-zinc-50">{p.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400">
                <span className={`size-1.5 rounded-full ${p.testnet ? "bg-accent" : "bg-amber-400"}`} />
                {p.testnet ? "Testnet" : "Mainnet, dana sungguhan"}
              </p>
            </div>
          </div>
          {p.status && <div className="lg:hidden">{p.status}</div>}
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-400">Saldo</p>
            <button
              type="button"
              onClick={p.onRefresh}
              aria-label="Segarkan saldo"
              className="-mr-2 grid size-9 place-items-center rounded-xl text-zinc-400 transition-colors duration-300 hover:bg-white/5 hover:text-zinc-100 active:scale-95"
            >
              <ArrowsClockwise />
            </button>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {p.unsupported ? null : p.loading && p.balance === null ? (
              <Skeleton className="h-12 w-56" />
            ) : p.balance !== null ? (
              <m.p
                key={p.balance}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring}
                className="text-[clamp(2.1rem,9vw,3.25rem)] font-medium leading-none tracking-[-0.03em] text-zinc-50 tabular-nums"
              >
                {p.balance}
              </m.p>
            ) : (
              <div className="max-w-[60ch]" role="alert">
                <p className="break-words text-sm leading-relaxed text-rose-400">{p.error}</p>
                <button type="button" onClick={p.onOpenEndpoints} className="mt-2 text-xs text-accent hover:underline">
                  Cek koneksi dan ubah endpoint
                </button>
              </div>
            )}
            {p.balance !== null && <span className="text-lg text-zinc-400">{p.symbol}</span>}
          </div>
          {p.fiat && p.balance !== null && <p className="mt-2 text-sm text-zinc-400 tabular-nums">≈ {p.fiat}</p>}
          {p.pending && <p className="mt-2 text-sm text-zinc-400 tabular-nums">+ {p.pending} {p.symbol} menunggu konfirmasi</p>}
          {p.note && <p className="mt-3 max-w-[60ch] text-xs leading-relaxed text-amber-300/80">{p.note}</p>}
          {p.emptyHint && <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-zinc-400">{p.emptyHint}</p>}
          {p.unsupported && (
            <div className="mt-1 max-w-[60ch]">
              <Notice>{p.unsupported}</Notice>
            </div>
          )}
        </div>

        {p.address && (
          <div className="mt-6 flex items-center gap-1 rounded-2xl border border-white/10 bg-black/15 py-1.5 pl-4 pr-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300" title={p.address}>
              {p.address}
            </span>
            <CopyButton text={p.address} label="Salin alamat" />
            {p.explorerLink && (
              <a
                href={p.explorerLink}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Lihat alamat di explorer"
                className="grid size-9 place-items-center rounded-xl text-zinc-400 transition-colors duration-300 hover:bg-white/5 hover:text-zinc-100"
              >
                <ArrowSquareOut />
              </a>
            )}
          </div>
        )}

        <div className={`mt-4 grid gap-2 ${p.actions.length >= 3 ? "grid-cols-3" : "grid-cols-2"}`}>
          {p.actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.key}
                type="button"
                onClick={a.onClick}
                className={`flex h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-2xl text-sm font-medium transition-[transform,filter,box-shadow] duration-300 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  a.primary ? "btn-primary" : "glass border border-white/10 text-zinc-100"
                }`}
              >
                <Icon size={22} weight="bold" />
                {a.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
