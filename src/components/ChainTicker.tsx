import { memo } from "react";
import { m } from "framer-motion";
import { CHAINS } from "../lib/chains";

const items = CHAINS.filter((c) => !c.testnet);

function Row() {
  return (
    <div className="flex">
      {items.map((c) => (
        <span key={c.chainId} className="flex items-center gap-3 whitespace-nowrap pr-14 font-mono text-xs text-zinc-500">
          <span className="text-zinc-300">{c.name}</span>
          <span>chain {c.chainId}</span>
          <span>{c.symbol}</span>
        </span>
      ))}
    </div>
  );
}

/** Pita horizontal tanpa putus (x: 0% ke -50% dari dua salinan). */
function ChainTickerBase() {
  return (
    <div className="hidden overflow-hidden border-t border-white/[0.06] pt-5 md:block" aria-hidden="true">
      <m.div
        className="flex w-max"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 32, ease: "linear", repeat: Infinity }}
      >
        <Row />
        <Row />
      </m.div>
    </div>
  );
}

export default memo(ChainTickerBase);
