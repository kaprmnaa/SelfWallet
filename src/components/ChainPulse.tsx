import { memo, useEffect, useState } from "react";
import type { ChainConfig } from "../lib/chains";
import { withProvider } from "../lib/rpc";
import { useVisibleInterval } from "../lib/visibility";
import { Skeleton, StatusDot } from "./ui";

/** Nomor blok terbaru. Polling terisolasi di komponen ini dan berhenti saat tab tersembunyi. */
function ChainPulseBase({ chain }: { chain: ChainConfig }) {
  const [block, setBlock] = useState<number | null | "err">(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setBlock(null);
  }, [chain]);

  useEffect(() => {
    let alive = true;
    withProvider(chain, (p) => p.getBlockNumber())
      .then((n) => alive && setBlock(n))
      .catch(() => alive && setBlock("err"));
    return () => {
      alive = false;
    };
  }, [chain, tick]);

  useVisibleInterval(() => setTick((t) => t + 1), 15_000);

  return (
    <div className="hidden items-center gap-2.5 font-mono text-xs text-zinc-500 md:flex" aria-live="polite">
      <StatusDot tone={block === "err" ? "bad" : "ok"} />
      {block === null ? (
        <Skeleton className="h-3 w-24" />
      ) : block === "err" ? (
        <span>RPC offline</span>
      ) : (
        <span>Blok {block.toLocaleString("id-ID")}</span>
      )}
    </div>
  );
}

export default memo(ChainPulseBase);
