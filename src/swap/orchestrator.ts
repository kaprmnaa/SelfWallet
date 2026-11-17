import { type ChainConfig } from "../lib/chains";
import type { Account } from "../lib/vault";
import { prepareCall, readAllowance, sendCall, encodeApprove, waitReceipt } from "../chains/evm/call";
import { lifi } from "./providers/lifi";
import { allowedTargets } from "./registry";
import { validateQuote } from "./quote/validate";
import { upsertSwap } from "./store";
import { assertNotLocked } from "../goals/guard";
import type { NormalizedQuote, SwapExecution } from "./domain/types";
import { ZERO_ADDRESS } from "./domain/types";

export type ResolvedToken = { address: string; symbol: string; decimals: number; native: boolean };

export type SwapInput = {
  account: Account;
  fromChain: ChainConfig;
  toChain: ChainConfig;
  fromToken: ResolvedToken;
  toToken: ResolvedToken;
  amount: bigint;
  slippage: number;
};

export type Review = {
  input: SwapInput;
  quote: NormalizedQuote;
  warnings: string[];
  allowance: bigint;
  needsApproval: boolean;
};

/** Ambil quote, validasi lokal, dan cek allowance. Tidak mengirim apa pun. */
export async function fetchReview(input: SwapInput): Promise<Review> {
  const owner = input.account.address;
  const quote = await lifi.getQuote({
    fromChain: input.fromChain.chainId,
    toChain: input.toChain.chainId,
    fromToken: input.fromToken.address,
    toToken: input.toToken.address,
    fromAmount: input.amount,
    fromAddress: owner,
    slippage: input.slippage,
  });
  const warnings = validateQuote(quote, {
    fromChain: input.fromChain.chainId,
    toChain: input.toChain.chainId,
    fromToken: input.fromToken.address,
    toToken: input.toToken.address,
    fromAmount: input.amount,
    owner,
    slippage: input.slippage,
    allowedTargets: allowedTargets(input.fromChain.chainId),
  });

  let allowance = 0n;
  let needsApproval = false;
  if (!input.fromToken.native) {
    allowance = await readAllowance(input.fromChain, input.fromToken.address, owner, quote.approvalAddress!);
    needsApproval = allowance < input.amount;
  }
  return { input, quote, warnings, allowance, needsApproval };
}

/**
 * Approval dengan JUMLAH PERSIS (bukan unlimited). Jika sudah ada allowance parsial yang bukan nol,
 * di-reset ke 0 dulu (beberapa token seperti USDT di Ethereum mewajibkannya).
 * Mengembalikan hash approval; setelahnya quote harus diambil ulang (quote cepat kedaluwarsa).
 */
export async function runApproval(review: Review, onStep?: (text: string) => void): Promise<string[]> {
  const { input, quote, allowance } = review;
  assertNotLocked(input.account, input.fromChain.chainId);
  const owner = input.account.address;
  const token = input.fromToken.address;
  const spender = quote.approvalAddress!;
  const amounts = allowance > 0n ? [0n, input.amount] : [input.amount];
  const hashes: string[] = [];
  for (const [i, amount] of amounts.entries()) {
    onStep?.(amount === 0n ? "Mereset approval lama…" : `Menandatangani approval ${input.fromToken.symbol}…`);
    const prepared = await prepareCall(input.fromChain, owner, { to: token, data: encodeApprove(spender, amount), value: 0n });
    const hash = await sendCall(input.account, prepared);
    hashes.push(hash);
    onStep?.(`Menunggu konfirmasi approval (${i + 1}/${amounts.length})…`);
    await waitReceipt(input.fromChain, hash);
  }
  return hashes;
}

/** Tanda tangani dan kirim transaksi swap, lalu catat eksekusi untuk dipantau. */
export async function executeSwap(review: Review, approvalHashes: string[]): Promise<SwapExecution> {
  const { input, quote } = review;
  assertNotLocked(input.account, input.fromChain.chainId);
  if (Date.now() >= quote.expiresAt) throw new Error("Quote sudah kedaluwarsa. Perbarui quote.");
  if (review.needsApproval) throw new Error("Approval belum selesai.");
  // Validasi ulang tepat sebelum menandatangani.
  validateQuote(quote, {
    fromChain: input.fromChain.chainId,
    toChain: input.toChain.chainId,
    fromToken: input.fromToken.address,
    toToken: input.toToken.address,
    fromAmount: input.amount,
    owner: input.account.address,
    slippage: input.slippage,
    allowedTargets: allowedTargets(input.fromChain.chainId),
  });

  const prepared = await prepareCall(input.fromChain, input.account.address, {
    to: quote.tx.to,
    data: quote.tx.data,
    value: quote.tx.value,
  });
  const srcHash = await sendCall(input.account, prepared);

  const now = Date.now();
  const exec: SwapExecution = {
    id: crypto.randomUUID(),
    provider: quote.provider,
    owner: input.account.address,
    createdAt: now,
    updatedAt: now,
    state: "source_submitted",
    tool: quote.toolName,
    from: {
      chainId: input.fromChain.chainId,
      symbol: input.fromToken.symbol,
      address: input.fromToken.address,
      decimals: input.fromToken.decimals,
      amount: input.amount.toString(),
    },
    to: {
      chainId: input.toChain.chainId,
      symbol: input.toToken.symbol,
      address: input.toToken.address,
      decimals: input.toToken.decimals,
      expected: quote.toAmount.toString(),
      minimum: quote.toAmountMin.toString(),
    },
    srcHash,
    approvalHashes,
    history: [
      { state: "awaiting_signature", ts: now },
      { state: "source_submitted", ts: now, note: "Transaksi sumber dikirim." },
    ],
  };
  upsertSwap(exec);
  return exec;
}

export const nativeToken = (chain: ChainConfig): ResolvedToken => ({
  address: ZERO_ADDRESS,
  symbol: chain.symbol,
  decimals: 18,
  native: true,
});
