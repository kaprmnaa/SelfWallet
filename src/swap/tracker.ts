import type { ChainConfig } from "../lib/chains";
import { checkReceipt } from "../lib/tx";
import { useVisibleInterval } from "../lib/visibility";
import { lifi } from "./providers/lifi";
import { getSwaps, upsertSwap } from "./store";
import { isTerminal, transition } from "./state-machine/machine";
import type { SwapExecution } from "./domain/types";

/** Satu langkah pemantauan. Idempoten: aman dipanggil berulang dan setelah browser dibuka kembali. */
export async function advance(e: SwapExecution, chains: ChainConfig[]): Promise<SwapExecution> {
  const src = chains.find((c) => c.chainId === e.from.chainId);
  if (!src || isTerminal(e.state)) return e;
  const sameChain = e.from.chainId === e.to.chainId;
  let cur = e;

  if (cur.state === "source_submitted") {
    const r = await checkReceipt(src, cur.srcHash);
    if (r === "pending") return cur;
    if (r === "failed") return transition(cur, "failed", "Transaksi sumber revert di chain.");
    cur = transition(cur, "source_confirmed", "Transaksi sumber terkonfirmasi.");
    // Swap satu chain bersifat atomik: receipt sukses berarti swap selesai.
    if (sameChain) return transition(cur, "completed", "Swap selesai di chain yang sama.");
  }

  if (!sameChain && (cur.state === "source_confirmed" || cur.state === "bridging" || cur.state === "recovery_required")) {
    const s = await lifi.getStatus(cur);
    const extra = { dstHash: s.dstHash ?? cur.dstHash, received: s.received ?? cur.received, receivedSymbol: s.receivedSymbol ?? cur.receivedSymbol };
    switch (s.state) {
      case "pending":
        cur = transition(cur, "bridging", s.message ?? "Diproses lintas chain.");
        break;
      case "done":
        cur = transition(cur, "completed", s.message ?? "Aset tujuan diterima.");
        break;
      case "partial":
        cur = transition(cur, "completed", "Selesai sebagian: Anda menerima token/jumlah berbeda dari yang diminta. Periksa saldo tujuan.");
        break;
      case "refunded":
        cur = transition(cur, "refunded", s.message ?? "Dana dikembalikan.");
        break;
      case "failed":
        cur = transition(cur, "recovery_required", s.message ?? "Penyedia melaporkan proses gagal.");
        break;
      default:
        break; // belum ditemukan / tidak pasti: tetap di status saat ini
    }
    if (extra.dstHash !== cur.dstHash || extra.received !== cur.received || extra.receivedSymbol !== cur.receivedSymbol) {
      cur = { ...cur, ...extra, updatedAt: Date.now() };
    }
  }
  return cur;
}

/** Hook pemantau di Dashboard: berhenti saat tab tersembunyi. */
export function useSwapTracker(chains: ChainConfig[], onChange: () => void) {
  useVisibleInterval(async () => {
    for (const e of getSwaps().filter((x) => !isTerminal(x.state))) {
      try {
        const next = await advance(e, chains);
        if (next !== e) {
          upsertSwap(next);
          if (next.state !== e.state) onChange();
        }
      } catch {
        /* coba lagi pada putaran berikutnya */
      }
    }
  }, 12_000);
}
