import type { NormalizedQuote, QuoteRequest, SwapExecution } from "../domain/types";

export type ProviderStatus = {
  state: "pending" | "done" | "partial" | "refunded" | "failed" | "unknown";
  message?: string;
  dstHash?: string;
  received?: string;
  receivedSymbol?: string;
};

/**
 * Antarmuka netral-provider (blueprint bagian 8). Pemetaan:
 *  - getQuote()      : di sini
 *  - validateQuote() : swap/quote/validate.ts (sama untuk semua provider)
 *  - buildExecution()/submit(): swap/orchestrator.ts (calldata + penandatanganan lokal)
 *  - getStatus()     : di sini
 *  - recover()       : recoveryHint() + swap/recovery/guide.ts (tanpa refund otomatis)
 */
export interface SwapProvider {
  id: string;
  name: string;
  getQuote(req: QuoteRequest): Promise<NormalizedQuote>;
  getStatus(exec: SwapExecution): Promise<ProviderStatus>;
}
