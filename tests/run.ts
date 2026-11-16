import { selectCoins, selectMax, vsize, DUST } from "../src/chains/bitcoin/coin-selection";
import { parseLifiQuote } from "../src/swap/providers/lifi";
import { validateQuote, QuoteRejected, type Expectation } from "../src/swap/quote/validate";
import { breakdown } from "../src/swap/fees/breakdown";
import { transition, canTransition } from "../src/swap/state-machine/machine";
import { LIFI_DIAMOND } from "../src/swap/registry";
import { Lane } from "../src/lib/lane";
import { explainError, hostOf } from "../src/lib/explain";
import type { SwapExecution } from "../src/swap/domain/types";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "OK   " : "GAGAL"} ${name}`);
};
const rejects = (name: string, fn: () => unknown) => {
  try {
    fn();
    ok(name, false);
  } catch (e) {
    ok(name, e instanceof QuoteRejected);
  }
};

/* ---------------------------------------------------------------- Bitcoin */
const u = (v: bigint, c = true, i = 0) => ({ txid: "aa".repeat(32), vout: i, value: v, confirmed: c, branch: 0 as const, index: i, address: "x" });
let s = selectCoins([u(500000n, true, 0), u(300000n, true, 1)], 600000n, 10, 22);
ok("btc: contoh blueprint memilih 2 input", s.inputs.length === 2);
ok("btc: invarian input = jumlah + kembalian + fee", 800000n === 600000n + s.change + s.fee);
ok("btc: fee = ceil(vsize*rate)", s.fee === BigInt(Math.ceil(vsize(2, [22, 22]) * 10)));
s = selectCoins([u(100500n)], 100000n, 1, 22);
ok("btc: kembalian di bawah dust dilebur ke fee", s.change === 0n && s.fee === 500n);
try { selectCoins([u(1_000_000n, false)], 10000n, 1, 22); ok("btc: UTXO unconfirmed ditolak", false); } catch { ok("btc: UTXO unconfirmed ditolak", true); }
const m = selectMax([u(300000n, true, 0), u(200000n, true, 1)], 5, 22);
ok("btc: maks (jumlah + fee = total)", m.amount + m.fee === 500000n && m.change === 0n);
ok("btc: DUST 546", DUST === 546n);

/* ------------------------------------------------------------------- Swap */
const OWNER = "0x1111111111111111111111111111111111111111";
const ZERO = "0x0000000000000000000000000000000000000000";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const tok = (address: string, symbol: string, decimals: number, chainId: number) => ({ address, symbol, decimals, chainId });

// Bentuk mengikuti dokumentasi LI.FI (docs.li.fi): tool, action, estimate, transactionRequest.
const rawQuote = (over: Record<string, unknown> = {}) => ({
  id: "q1:0",
  tool: "lifi-dex",
  toolDetails: { name: "LI.FI DEX" },
  action: {
    fromChainId: 8453, toChainId: 8453,
    fromToken: tok(ZERO, "ETH", 18, 8453),
    toToken: tok(USDC, "USDC", 6, 8453),
    fromAmount: "1000000000000000", slippage: 0.005,
    fromAddress: OWNER, toAddress: OWNER,
  },
  estimate: {
    fromAmount: "1000000000000000", toAmount: "3000000", toAmountMin: "2985000",
    approvalAddress: LIFI_DIAMOND, executionDuration: 30,
    feeCosts: [{ name: "LIFI Fixed Fee", amount: "0", token: tok(ZERO, "ETH", 18, 8453), amountUSD: "0.00", included: true }],
    gasCosts: [{ type: "SEND", amount: "20000000000000", amountUSD: "0.06", token: tok(ZERO, "ETH", 18, 8453) }],
    fromAmountUSD: "3.00", toAmountUSD: "2.99",
  },
  transactionRequest: {
    from: OWNER, to: LIFI_DIAMOND, chainId: 8453, value: "0x38d7ea4c68000",
    data: "0xdeadbeef" + "000000000000000000000000" + OWNER.slice(2) + "00".repeat(32),
  },
  ...over,
});

const NOW = 1_000_000;
const expect = (over: Partial<Expectation> = {}): Expectation => ({
  fromChain: 8453, toChain: 8453, fromToken: ZERO, toToken: USDC,
  fromAmount: 1000000000000000n, owner: OWNER, slippage: 0.005,
  allowedTargets: [LIFI_DIAMOND], now: NOW + 1000, ...over,
});
const q = (mut?: (r: any) => void) => {
  const r: any = rawQuote();
  mut?.(r);
  return parseLifiQuote(r, NOW);
};

try { ok("swap: quote valid lolos", Array.isArray(validateQuote(q(), expect()))); } catch (e) { ok("swap: quote valid lolos (" + (e as Error).message + ")", false); }
rejects("swap: kontrak tujuan tak dikenal ditolak", () => validateQuote(q((r) => (r.transactionRequest.to = "0x2222222222222222222222222222222222222222")), expect()));
rejects("swap: penerima bukan alamat sendiri ditolak", () => validateQuote(q((r) => (r.action.toAddress = "0x3333333333333333333333333333333333333333")), expect()));
rejects("swap: calldata tanpa alamat penerima ditolak", () => validateQuote(q((r) => (r.transactionRequest.data = "0xdeadbeef" + "00".repeat(64))), expect()));
rejects("swap: nilai native berlebih ditolak", () => validateQuote(q((r) => (r.transactionRequest.value = "0xde0b6b3a7640000")), expect()));
rejects("swap: nilai native kurang dari jumlah bayar ditolak", () => validateQuote(q((r) => (r.transactionRequest.value = "0x1")), expect()));
rejects("swap: quote kedaluwarsa ditolak", () => validateQuote(q(), expect({ now: NOW + 61_000 })));
rejects("swap: slippage berbeda ditolak", () => validateQuote(q((r) => (r.action.slippage = 0.03)), expect()));
rejects("swap: jumlah berbeda ditolak", () => validateQuote(q(), expect({ fromAmount: 2n })));
rejects("swap: token tujuan berbeda ditolak", () => validateQuote(q(), expect({ toToken: "0x4444444444444444444444444444444444444444" })));
rejects("swap: chain ID transaksi salah ditolak", () => validateQuote(q((r) => (r.transactionRequest.chainId = 1)), expect()));
rejects("swap: minimum jauh di bawah slippage ditolak", () => validateQuote(q((r) => (r.estimate.toAmountMin = "1000000")), expect()));
rejects("swap: kehilangan nilai >50% ditolak", () => validateQuote(q((r) => (r.estimate.toAmountUSD = "1.00")), expect()));
rejects("swap: approval ke alamat tak dikenal (ERC-20) ditolak", () =>
  validateQuote(
    q((r) => { r.action.fromToken = tok(USDC, "USDC", 6, 8453); r.estimate.approvalAddress = "0x5555555555555555555555555555555555555555"; r.transactionRequest.value = "0x0"; }),
    expect({ fromToken: USDC }),
  ));
try { validateQuote(q((r) => { r.action.fromToken = tok(USDC, "USDC", 6, 8453); r.transactionRequest.value = "0x0"; }), expect({ fromToken: USDC })); ok("swap: ERC-20 dengan approval valid lolos", true); } catch (e) { ok("swap: ERC-20 dengan approval valid lolos (" + (e as Error).message + ")", false); }
try { parseLifiQuote({ tool: "x" }); ok("swap: bentuk quote tak dikenal ditolak", false); } catch { ok("swap: bentuk quote tak dikenal ditolak", true); }

const bd = breakdown(q());
ok("swap: rincian gas terpisah dari biaya provider", bd.gas.length === 1 && bd.provider.length === 1 && bd.provider[0].included === true);
ok("swap: tanpa native tambahan", bd.nativeExtra === 0n);

/* ------------------------------------------------------------ State machine */
const exec: SwapExecution = {
  id: "e1", provider: "lifi", owner: OWNER, createdAt: 1, updatedAt: 1, state: "source_submitted", tool: "x",
  from: { chainId: 1, symbol: "ETH", address: ZERO, decimals: 18, amount: "1" },
  to: { chainId: 56, symbol: "USDT", address: USDC, decimals: 18, expected: "1", minimum: "1" },
  srcHash: "0xabc", approvalHashes: [], history: [],
};
const a = transition(exec, "source_confirmed", "ok", 5);
ok("state: source_submitted -> source_confirmed", a.state === "source_confirmed" && a.history.length === 1);
ok("state: transisi sama idempoten", transition(a, "source_confirmed") === a);
const b = transition(transition(a, "bridging", undefined, 6), "completed", undefined, 7);
ok("state: bridging -> completed", b.state === "completed");
try { transition(b, "bridging"); ok("state: status akhir tidak bisa berubah", false); } catch { ok("state: status akhir tidak bisa berubah", true); }
ok("state: source_submitted tidak boleh langsung completed", !canTransition("source_submitted", "completed"));
ok("state: recovery_required bisa pulih ke completed", canTransition("recovery_required", "completed"));

/* ------------------------------------------------ Pembatas laju & galat */
explainOk();
function explainOk() {
  ok("explain: 403 dijelaskan", /endpoint kustom/.test(explainError(new Error("x.com: HTTP 403"))));
  ok("explain: 429 dijelaskan", /dibatasi laju/.test(explainError(new Error("x.com: HTTP 429"))));
  ok("explain: Failed to fetch -> pesan jelas", /CORS/.test(explainError(new TypeError("Failed to fetch"))));
  ok("explain: host dari URL", hostOf("https://mempool.space/testnet4/api") === "mempool.space");
}

async function laneTest() {
  const lane = new Lane(2, 120);
  let active = 0;
  let maxActive = 0;
  const starts: number[] = [];
  await Promise.all(
    Array.from({ length: 6 }, () =>
      lane.run(async () => {
        starts.push(Date.now());
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 40));
        active--;
      }),
    ),
  );
  starts.sort((a, b) => a - b);
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  ok("lane: maksimal 2 permintaan serentak", maxActive <= 2);
  ok("lane: jeda antar permintaan >= ~120 ms", gaps.every((g) => g >= 100));
  const t0 = Date.now();
  const l2 = new Lane(1, 10);
  l2.pause(200);
  await l2.run(async () => {});
  ok("lane: pause() menahan permintaan berikutnya", Date.now() - t0 >= 180);
}

laneTest().then(() => {
  console.log(`\n${pass} lolos, ${fail} gagal`);
  process.exit(fail === 0 ? 0 : 1);
});
