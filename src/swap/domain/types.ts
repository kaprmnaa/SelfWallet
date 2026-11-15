export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Status sesuai blueprint v2.0 bagian 9. */
export type SwapState =
  | "quoted"
  | "awaiting_approval"
  | "awaiting_signature"
  | "source_submitted"
  | "source_confirmed"
  | "bridging"
  | "completed"
  | "failed"
  | "refunded"
  | "recovery_required";

export const TERMINAL_STATES: SwapState[] = ["completed", "failed", "refunded"];

export const STATE_LABEL: Record<SwapState, string> = {
  quoted: "Quote siap",
  awaiting_approval: "Menunggu approval",
  awaiting_signature: "Menunggu tanda tangan",
  source_submitted: "Transaksi sumber terkirim",
  source_confirmed: "Sumber terkonfirmasi",
  bridging: "Diproses lintas chain",
  completed: "Selesai",
  failed: "Gagal",
  refunded: "Dikembalikan",
  recovery_required: "Perlu pemulihan",
};

export type TokenRef = { address: string; symbol: string; decimals: number; chainId: number };

export type Fee = {
  name: string;
  amount: bigint;
  token: TokenRef;
  usd: number | null;
  /** true = sudah dipotong dari output (jangan dijumlahkan lagi dengan output). */
  included: boolean;
};

export type QuoteRequest = {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: bigint;
  fromAddress: string;
  /** Desimal: 0.005 = 0,5%. */
  slippage: number;
};

/** Model quote netral-provider. Seluruh isinya dianggap TIDAK TEPERCAYA sampai divalidasi. */
export type NormalizedQuote = {
  provider: string;
  id: string;
  tool: string;
  toolName: string;
  fromChainId: number;
  toChainId: number;
  fromToken: TokenRef;
  toToken: TokenRef;
  fromAmount: bigint;
  toAmount: bigint;
  toAmountMin: bigint;
  slippage: number;
  fromAddress: string;
  toAddress: string;
  approvalAddress: string | null;
  executionSeconds: number | null;
  feeCosts: Fee[];
  gasCosts: Fee[];
  fromUsd: number | null;
  toUsd: number | null;
  tx: { to: string; data: string; value: bigint; chainId: number; from?: string };
  /** Catatan dari proses parsing (mis. rincian biaya tidak lengkap). */
  parseWarnings: string[];
  fetchedAt: number;
  expiresAt: number;
};

export type SwapExecution = {
  id: string;
  provider: string;
  owner: string; // alamat EVM wallet pemilik
  createdAt: number;
  updatedAt: number;
  state: SwapState;
  message?: string;
  tool: string;
  from: { chainId: number; symbol: string; address: string; decimals: number; amount: string };
  to: { chainId: number; symbol: string; address: string; decimals: number; expected: string; minimum: string };
  srcHash: string;
  dstHash?: string;
  received?: string;
  receivedSymbol?: string;
  approvalHashes: string[];
  history: { state: SwapState; ts: number; note?: string }[];
};
