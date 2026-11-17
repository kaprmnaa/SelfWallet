import { selectCoins, selectMax, vsize, DUST } from "../src/chains/bitcoin/coin-selection";
import { parseLifiQuote } from "../src/swap/providers/lifi";
import { validateQuote, QuoteRejected, type Expectation } from "../src/swap/quote/validate";
import { breakdown } from "../src/swap/fees/breakdown";
import { transition, canTransition } from "../src/swap/state-machine/machine";
import { LIFI_DIAMOND } from "../src/swap/registry";
import { Lane, Breaker } from "../src/lib/lane";
import {
  progress, evaluate, cancelInfo, requestCancel, revokeCancel, confirmCancel, blockingGoal, lockMessage,
  shouldSnapshot, validateNewGoal, mergeGoal, CANCEL_COOLDOWN_MS, SNAPSHOT_MIN_INTERVAL_MS,
} from "../src/goals/logic";
import type { Goal } from "../src/goals/types";
import { missingWindow, hintCandidates } from "../src/chains/bitcoin/gap";
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

/* ----------------------------------------- Gap limit & pemutus sirkuit */
ok("gap: wallet kosong memeriksa indeks 0..2 (gap 3)", JSON.stringify(missingWindow(new Set(), -1, 3)) === "[0,1,2]");
ok("gap: setelah indeks 0 terpakai, hanya indeks 3 yang baru", JSON.stringify(missingWindow(new Set([0, 1, 2]), 0, 3)) === "[3]");
ok("gap: stabil bila jendela sudah diperiksa semua", missingWindow(new Set([0, 1, 2, 3]), 0, 3).length === 0);
ok("gap: gap 20 memeriksa 20 indeks", missingWindow(new Set(), -1, 20).length === 20);
ok("hint: tanpa petunjuk tidak ada kandidat", hintCandidates(undefined).length === 0 && hintCandidates({ last: -1, funded: [] }).length === 0);
ok("hint: alamat berdana + beberapa alamat terakhir diperiksa ulang", JSON.stringify(hintCandidates({ last: 20, funded: [3] })) === "[3,16,17,18,19,20]");
ok("hint: dompet kecil memeriksa ulang semuanya (faucet memakai ulang alamat lama)", JSON.stringify(hintCandidates({ last: 0, funded: [] })) === "[0]");

const br = new Breaker(1000, 4000);
ok("breaker: awalnya terbuka", br.remaining(0) === 0);
ok("breaker: kegagalan pertama menjeda 1000 ms", br.trip(0) === 1000 && br.remaining(0) === 1000);
ok("breaker: backoff berlipat 2000 ms", br.trip(0) === 2000);
ok("breaker: dibatasi maksimum", (br.trip(0), br.trip(0)) === 4000);
ok("breaker: Retry-After dari server dihormati", br.trip(0, 7000) === 7000);
br.reset();
ok("breaker: reset setelah sukses", br.remaining(0) === 0 && br.trip(0) === 1000);

/* ------------------------------------------------------------------ Goal */
const G = (over: Partial<Goal> = {}): Goal => ({
  id: "g1", ref: "refA", name: "target 100$", chainId: 8453, unit: "usd", start: 10, target: 100,
  status: "active", createdAt: 0, updatedAt: 0, ...over,
});
ok('goal: "10 to 100" progres dari nilai awal (10 -> 0%)', progress(G(), 10) === 0);
ok('goal: "10 to 100" nilai 55 -> 50%', Math.abs(progress(G(), 55) - 0.5) < 1e-9);
ok("goal: progres dibatasi 0..1", progress(G(), 5) === 0 && progress(G(), 500) === 1);

let g = G();
g = evaluate(g, 100, 1);
ok("goal: pembacaan pertama >= target belum cukup (butuh 2 berturut-turut)", g.status === "active" && g.hits === 1);
g = evaluate(g, 50, 2);
ok("goal: turun di bawah target mereset hits", g.status === "active" && g.hits === 0);
g = evaluate(evaluate(g, 120, 3), 120, 4);
ok("goal: dua pembacaan berturut-turut => tercapai", g.status === "achieved" && g.achievedAt === 4);
ok("goal: status tercapai bersifat tetap walau nilai turun", evaluate(g, 1, 5).status === "achieved");

const base = G({ cancelRequestedAt: undefined });
ok("goal: belum ada pengajuan pembatalan", cancelInfo(base, 0).requested === false);
const req = requestCancel(base, 1000);
ok("goal: pengajuan membuka masa tunggu 24 jam", cancelInfo(req, 1000).ready === false && cancelInfo(req, 1000 + CANCEL_COOLDOWN_MS).ready === true);
try { confirmCancel(req, 1000 + 1000); ok("goal: konfirmasi sebelum masa tunggu ditolak", false); } catch { ok("goal: konfirmasi sebelum masa tunggu ditolak", true); }
ok("goal: konfirmasi setelah masa tunggu membatalkan", confirmCancel(req, 1000 + CANCEL_COOLDOWN_MS).status === "cancelled");
ok("goal: pengajuan bisa dibatalkan kembali", revokeCancel(req, 5).cancelRequestedAt === undefined);
try { requestCancel(G({ status: "achieved" })); ok("goal: goal tercapai tidak bisa dibatalkan", false); } catch { ok("goal: goal tercapai tidak bisa dibatalkan", true); }

const goalsList = [G(), G({ id: "g2", chainId: 1 }), G({ id: "g3", ref: "refB" }), G({ id: "g4", status: "achieved" }), G({ id: "g5", status: "cancelled" })];
ok("kunci: goal aktif di jaringan + wallet yang sama memblokir", blockingGoal(goalsList, "refA", 8453)?.id === "g1");
ok("kunci: jaringan lain tidak terkunci", blockingGoal([G()], "refA", 56) === null);
ok("kunci: wallet lain tidak terkunci", blockingGoal([G()], "refZ", 8453) === null);
ok("kunci: goal tercapai/dibatalkan tidak memblokir", blockingGoal([G({ status: "achieved" }), G({ status: "cancelled" })], "refA", 8453) === null);
ok("kunci: pesan menyebut nama goal", lockMessage(G()).includes("target 100$"));

ok("snapshot: pertama selalu dicatat", shouldSnapshot(undefined, 5, 100, 0));
ok("snapshot: perubahan kecil dalam interval tidak dicatat", !shouldSnapshot({ ts: 0, value: 50 }, 50.5, 100, 1000));
ok("snapshot: perubahan >= 1% target dicatat", shouldSnapshot({ ts: 0, value: 50 }, 51, 100, 1000));
ok("snapshot: lewat interval dicatat", shouldSnapshot({ ts: 0, value: 50 }, 50, 100, SNAPSHOT_MIN_INTERVAL_MS));

const vOk = { name: "  target   100$ ", unit: "usd" as const, usdSupported: true, start: 0, target: 100 };
ok("validasi: nama dirapikan", validateNewGoal(vOk) === "target 100$");
const bad = (over: object) => { try { validateNewGoal({ ...vOk, ...over }); return false; } catch { return true; } };
ok("validasi: nama kosong ditolak", bad({ name: "   " }));
ok("validasi: USD di jaringan tanpa harga ditolak", bad({ usdSupported: false }));
ok("validasi: target <= 0 ditolak", bad({ target: 0 }));
ok("validasi: nilai awal >= target ditolak", bad({ start: 100 }));
ok("validasi: koin native di testnet diterima", (() => { try { validateNewGoal({ ...vOk, unit: "native", usdSupported: false }); return true; } catch { return false; } })());

const act = G({ updatedAt: 100 });
const ach = G({ status: "achieved", updatedAt: 50 });
ok("merge: status akhir menang atas aktif walau lebih lama", mergeGoal(act, ach).status === "achieved");
ok("merge: status akhir lokal tidak ditimpa remote aktif", mergeGoal(ach, act).status === "achieved");
ok("merge: sama-sama aktif, yang terbaru menang", mergeGoal(G({ updatedAt: 1, name: "a" }), G({ updatedAt: 2, name: "b" })).name === "b");
ok("merge: tanpa data lokal memakai remote", mergeGoal(undefined, act) === act);

laneTest().then(() => {
  console.log(`\n${pass} lolos, ${fail} gagal`);
  process.exit(fail === 0 ? 0 : 1);
});
