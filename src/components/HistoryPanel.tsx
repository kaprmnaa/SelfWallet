import { m } from "framer-motion";
import { ArrowSquareOut, ClockCounterClockwise } from "@phosphor-icons/react";
import { explorerTx, type ChainConfig } from "../lib/chains";
import { useSettings } from "../context/SettingsContext";
import { shortAddr, timeAgo, trimAmount } from "../lib/format";
import CoinIcon from "./CoinIcon";
import type { HistorySyncState } from "../history/useHistorySync";
import type { SyncState } from "../goals/sync";
import { StatusDot, spring } from "./ui";

const LABEL = { pending: "Menunggu", success: "Berhasil", failed: "Gagal" } as const;
const TONE = { pending: "warn", success: "ok", failed: "bad" } as const;

function SyncLine({ status, h }: { status: SyncState["status"]; h: HistorySyncState }) {
  if (status === "off") return null;
  let tone: "ok" | "warn" | "bad" = "ok";
  let text = "Tersimpan terenkripsi · terlihat di semua perangkat";
  if (status === "signed-out") {
    tone = "warn";
    text = "Masuk di tab Goal agar riwayat tersimpan dan terlihat di perangkat lain";
  } else if (status === "connecting" || h.status === "syncing" || h.status === "off") {
    tone = "warn";
    text = "Menyinkronkan…";
  } else if (status === "error" || h.status === "error") {
    tone = "bad";
    text = h.message ?? "Sinkron riwayat gagal";
  }
  return (
    <p className="mb-4 flex items-center gap-2 text-xs text-zinc-500" role="status">
      <StatusDot tone={tone} still />
      {text}
    </p>
  );
}

export default function HistoryPanel({
  chain,
  address,
  syncStatus,
  hsync,
}: {
  chain: ChainConfig;
  address: string;
  syncStatus: SyncState["status"];
  hsync: HistorySyncState;
}) {
  const { history } = useSettings();
  const items = history.filter((h) => h.chainId === chain.chainId && h.from === address);

  if (items.length === 0) {
    return (
      <div>
      <SyncLine status={syncStatus} h={hsync} />
      <div className="flex items-start gap-4 border-y border-white/[0.06] py-8">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 text-zinc-500">
          <ClockCounterClockwise />
        </span>
        <div>
          <p className="text-sm text-zinc-200">Belum ada transaksi di {chain.name}</p>
          <p className="mt-1 text-sm text-zinc-500">Transaksi yang Anda kirim muncul di sini.</p>
        </div>
      </div>
      </div>
    );
  }

  return (
    <div>
    <SyncLine status={syncStatus} h={hsync} />
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
            href={explorerTx(chain, h.hash) ?? "#"}
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
    </div>
  );
}
