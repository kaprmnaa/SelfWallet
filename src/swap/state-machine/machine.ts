import { TERMINAL_STATES, type SwapExecution, type SwapState } from "../domain/types";

/** Transisi yang diizinkan (blueprint bagian 9). Selain ini ditolak agar status tidak melompat. */
const ALLOWED: Record<SwapState, SwapState[]> = {
  quoted: ["awaiting_approval", "awaiting_signature", "failed"],
  awaiting_approval: ["awaiting_signature", "failed"],
  awaiting_signature: ["source_submitted", "failed"],
  source_submitted: ["source_confirmed", "failed", "recovery_required"],
  source_confirmed: ["bridging", "completed", "failed", "refunded", "recovery_required"],
  bridging: ["completed", "refunded", "failed", "recovery_required"],
  recovery_required: ["bridging", "completed", "refunded", "failed"],
  completed: [],
  failed: [],
  refunded: [],
};

export const isTerminal = (s: SwapState) => TERMINAL_STATES.includes(s);
export const canTransition = (from: SwapState, to: SwapState) => from === to || ALLOWED[from].includes(to);

/** Murni dan idempoten: transisi ke status yang sama tidak mengubah apa pun. */
export function transition(e: SwapExecution, next: SwapState, note?: string, now = Date.now()): SwapExecution {
  if (e.state === next) return note && note !== e.message ? { ...e, message: note, updatedAt: now } : e;
  if (!canTransition(e.state, next)) throw new Error(`Transisi status tidak valid: ${e.state} -> ${next}`);
  return {
    ...e,
    state: next,
    message: note ?? e.message,
    updatedAt: now,
    history: [...e.history, { state: next, ts: now, note }],
  };
}
