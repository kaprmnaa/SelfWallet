import type { Fee, NormalizedQuote, QuoteRequest, SwapExecution, TokenRef } from "../domain/types";
import type { ProviderStatus, SwapProvider } from "./provider";

// Endpoint dan bentuk respons diverifikasi dari dokumentasi LI.FI (docs.li.fi):
//   GET /v1/quote  -> tool, action, estimate{toAmount,toAmountMin,approvalAddress,executionDuration,feeCosts,gasCosts}, transactionRequest
//   GET /v1/status -> status NOT_FOUND|INVALID|PENDING|DONE|FAILED, substatus COMPLETED|PARTIAL|REFUNDED, receiving{txHash}
// Quote berlaku sekitar 60 detik. LI.FI TIDAK mendukung testnet: hanya mainnet.
const BASE = "https://li.quest/v1";
const QUOTE_TTL_MS = 55_000;

class Bad extends Error {}
const bad = (what: string) => new Bad(`Quote tidak valid: ${what}.`);

const asStr = (x: unknown, what: string): string => {
  if (typeof x !== "string" || x.length === 0) throw bad(what);
  return x;
};
const asNum = (x: unknown, what: string): number => {
  if (typeof x !== "number" || !Number.isFinite(x)) throw bad(what);
  return x;
};
const asBig = (x: unknown, what: string): bigint => {
  try {
    if (typeof x === "string" || typeof x === "number") return BigInt(x);
  } catch {
    /* jatuh ke galat di bawah */
  }
  throw bad(what);
};
const usd = (x: unknown): number | null => {
  const n = typeof x === "string" || typeof x === "number" ? Number.parseFloat(String(x)) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (x: unknown, what: string): Record<string, unknown> => {
  if (!x || typeof x !== "object") throw bad(what);
  return x as Record<string, unknown>;
};

function token(x: unknown, what: string): TokenRef {
  const o = obj(x, what);
  return {
    address: asStr(o.address, `${what}.address`),
    symbol: asStr(o.symbol, `${what}.symbol`),
    decimals: asNum(o.decimals, `${what}.decimals`),
    chainId: asNum(o.chainId, `${what}.chainId`),
  };
}

function fees(list: unknown, warnings: string[], label: string): Fee[] {
  if (list == null) return [];
  if (!Array.isArray(list)) {
    warnings.push(`Rincian ${label} tidak lengkap.`);
    return [];
  }
  const out: Fee[] = [];
  for (const raw of list) {
    try {
      const o = obj(raw, label);
      out.push({
        name: typeof o.name === "string" ? o.name : label,
        amount: asBig(o.amount, `${label}.amount`),
        token: token(o.token, `${label}.token`),
        usd: usd(o.amountUSD),
        included: o.included === true,
      });
    } catch {
      warnings.push(`Rincian ${label} tidak lengkap.`);
    }
  }
  return out;
}

/** Parsing ketat: bentuk yang tidak dikenal menggagalkan quote (data provider tidak tepercaya). */
export function parseLifiQuote(raw: unknown, now = Date.now()): NormalizedQuote {
  const q = obj(raw, "respons");
  const action = obj(q.action, "action");
  const est = obj(q.estimate, "estimate");
  const tr = obj(q.transactionRequest, "transactionRequest");
  const warnings: string[] = [];
  const details = q.toolDetails && typeof q.toolDetails === "object" ? (q.toolDetails as Record<string, unknown>) : {};

  return {
    provider: "lifi",
    id: typeof q.id === "string" ? q.id : "",
    tool: asStr(q.tool, "tool"),
    toolName: typeof details.name === "string" ? details.name : asStr(q.tool, "tool"),
    fromChainId: asNum(action.fromChainId, "action.fromChainId"),
    toChainId: asNum(action.toChainId, "action.toChainId"),
    fromToken: token(action.fromToken, "fromToken"),
    toToken: token(action.toToken, "toToken"),
    fromAmount: asBig(action.fromAmount, "action.fromAmount"),
    toAmount: asBig(est.toAmount, "estimate.toAmount"),
    toAmountMin: asBig(est.toAmountMin, "estimate.toAmountMin"),
    slippage: asNum(action.slippage, "action.slippage"),
    fromAddress: asStr(action.fromAddress, "action.fromAddress"),
    toAddress: asStr(action.toAddress, "action.toAddress"),
    approvalAddress: typeof est.approvalAddress === "string" ? est.approvalAddress : null,
    executionSeconds: typeof est.executionDuration === "number" ? est.executionDuration : null,
    feeCosts: fees(est.feeCosts, warnings, "biaya provider"),
    gasCosts: fees(est.gasCosts, warnings, "biaya gas"),
    fromUsd: usd(est.fromAmountUSD),
    toUsd: usd(est.toAmountUSD),
    tx: {
      to: asStr(tr.to, "transactionRequest.to"),
      data: asStr(tr.data, "transactionRequest.data"),
      value: asBig(tr.value ?? "0x0", "transactionRequest.value"),
      chainId: asNum(tr.chainId, "transactionRequest.chainId"),
      from: typeof tr.from === "string" ? tr.from : undefined,
    },
    parseWarnings: warnings,
    fetchedAt: now,
    expiresAt: now + QUOTE_TTL_MS,
  };
}

async function get(path: string, params: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const url = `${BASE}${path}?${new URLSearchParams(params).toString()}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await fetch(url, { signal: ctl.signal, referrerPolicy: "no-referrer", headers: { accept: "application/json" } });
    let json: unknown = null;
    try {
      json = await r.json();
    } catch {
      /* tubuh bukan JSON */
    }
    return { status: r.status, json };
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") throw new Error("LI.FI tidak merespons (timeout).");
    throw new Error("LI.FI tidak bisa dihubungi (jaringan, CORS, atau pembatasan laju).");
  } finally {
    clearTimeout(t);
  }
}

export const lifi: SwapProvider = {
  id: "lifi",
  name: "LI.FI",

  async getQuote(req: QuoteRequest): Promise<NormalizedQuote> {
    const { status, json } = await get("/quote", {
      fromChain: String(req.fromChain),
      toChain: String(req.toChain),
      fromToken: req.fromToken,
      toToken: req.toToken,
      fromAmount: req.fromAmount.toString(),
      fromAddress: req.fromAddress,
      toAddress: req.fromAddress, // penerima SELALU alamat sendiri
      slippage: String(req.slippage),
      integrator: "kunci-wallet",
    });
    if (status === 429) throw new Error("LI.FI membatasi laju permintaan. Coba lagi sebentar lagi.");
    if (status < 200 || status >= 300) {
      const msg = (json as { message?: string } | null)?.message;
      if (status === 404 || /no available quotes/i.test(msg ?? "")) {
        throw new Error("Tidak ada rute untuk pasangan, jumlah, dan jaringan ini.");
      }
      throw new Error(`LI.FI menolak permintaan${msg ? `: ${msg}` : ` (HTTP ${status})`}.`);
    }
    return parseLifiQuote(json);
  },

  async getStatus(exec: SwapExecution): Promise<ProviderStatus> {
    const { status, json } = await get("/status", {
      txHash: exec.srcHash,
      fromChain: String(exec.from.chainId),
      toChain: String(exec.to.chainId),
    });
    if (status === 404) return { state: "unknown", message: "Belum ditemukan oleh penyedia." };
    if (status === 429) throw new Error("rate limit");
    if (status < 200 || status >= 300 || !json || typeof json !== "object") return { state: "unknown" };

    const s = json as {
      status?: string;
      substatus?: string;
      substatusMessage?: string;
      receiving?: { txHash?: string; amount?: string; token?: { symbol?: string } };
    };
    const base = {
      message: s.substatusMessage,
      dstHash: s.receiving?.txHash,
      received: s.receiving?.amount,
      receivedSymbol: s.receiving?.token?.symbol,
    };
    switch (s.status) {
      case "PENDING":
        return { state: "pending", ...base };
      case "DONE":
        if (s.substatus === "REFUNDED") return { state: "refunded", ...base };
        if (s.substatus === "PARTIAL") return { state: "partial", ...base };
        return { state: "done", ...base };
      case "FAILED":
        return { state: "failed", ...base };
      default:
        return { state: "unknown", ...base };
    }
  },
};
