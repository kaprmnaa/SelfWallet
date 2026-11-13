import { m } from "framer-motion";
import { ArrowSquareOut, ClockCounterClockwise } from "@phosphor-icons/react";
import type { ChainConfig } from "../lib/chains";
import { useSettings } from "../context/SettingsContext";
import { shortAddr, timeAgo, trimAmount } from "../lib/format";
import CoinIcon from "./CoinIcon";
import { StatusDot, spring } from "./ui";

const LABEL = { pending: "Menunggu", success: "Berhasil", failed: "Gagal" } as const;
const TONE = { pending: "warn", success: "ok", failed: "bad" } as const;

export default function HistoryPanel({ chain, address }: { chain: ChainConfig; address: string }) {
  const { history } = useSettings();
  const items = history.filter((h) => h.chainId === chain.chainId && h.from === address);

  if (items.length === 0) {
    return (
      <div className="flex items-start gap-4 border-y border-white/[0.06] py-8">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 text-zinc-500">
          <ClockCounterClockwise />
        </span>
        <div>
          <p className="text-sm text-zinc-200">Belum ada transaksi di {chain.name}</p>
          <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-zinc-500">
            Transaksi yang Anda kirim dari perangkat ini muncul di sini. Riwayat hanya menyimpan hash dan alamat
            publik di browser, tanpa data rahasia.
          </p>
        </div>
      </div>
    );
  }

  return (
    <m.ul
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
      className="divide-y divide-white/[0.06] border-y border-white/[0.06]"
    >
      {items.map((h) => (
        <m.li
          key={h.hash}
          layout
          variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: spring } }}
          className="flex items-center justify-between gap-4 py-4"
        >
          <div className="flex min-w-0 items-center gap-4">
            <CoinIcon symbol={h.symbol} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-100">
                <span className="font-mono">
                  {trimAmount(h.amount, 8)} {h.symbol}
                </span>{" "}
                <span className="text-zinc-500">ke {shortAddr(h.to)}</span>
              </p>
              <p className="flex items-center gap-2 text-xs text-zinc-500">
                <StatusDot tone={TONE[h.status]} still={h.status !== "pending"} />
                {LABEL[h.status]} · {timeAgo(h.ts)}
              </p>
            </div>
          </div>
          {chain.explorer && (
<a
            href={`${chain.explorer}/tx/${h.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Buka di explorer"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-500 transition-colors duration-300 hover:bg-white/5 hover:text-zinc-200"
          >
            <ArrowSquareOut />
          </a>
)}
        </m.li>
      ))}
    </m.ul>
  );
}
