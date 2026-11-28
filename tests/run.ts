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
import {
  allocate, checkWithdrawal, outgoingValue, setFunded, modeOf, isLockMode, lockGoals, poolCurrency,
} from "../src/goals/allocation";
import { blake2b } from "@noble/hashes/blake2b";
import { sha256 as zsha256 } from "@noble/hashes/sha256";
import { createBase58check } from "@scure/base";
import { encodeP2pkh, encodeP2sh, parseRecipient, hash160, p2pkhScript } from "../src/chains/zcash/address";
import { branchIdAt } from "../src/chains/zcash/params";
import { MAX_INPUTS, MIN_CHANGE, compactSize, i64, parseV5, planSpend, serializeV5, sigHashV5, signV5, zip317Fee, type ZTx } from "../src/chains/zcash/tx";
import { zecBalance, zecBalanceOrStale, zecBroadcast, zecTip, zecTxStatus } from "../src/chains/zcash/provider";
import { nativePrices, tokenPrices, resetPriceState, MIN_LIQUIDITY_USD } from "../src/lib/prices";
import { parseItem } from "../src/history/crypto";
import { verifyAssertion, derToRaw, b64u } from "../src/txauth/webauthn";
import { getTxSettings, setSendMode, clearTxAuth, assertTxAuthorized } from "../src/txauth/store";
import { normalizeAddress, sameAddress, validateContact, isContact, isRecipientAllowed, type Contact } from "../src/contacts/logic";
import { keyFromSecret, sealPassword, openPassword } from "../src/lib/biometric";
import { hkdf32 } from "../src/lib/kdf";
import { durationMs, planTimeLock, activeTimeLock, mergeTimeLock, formatRemaining } from "../src/goals/timelock";
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

/* ------------------------------------------- Mode lock/unlock + kunci waktu */
const POOL = (total: number, currency: "usd" | "native" = "usd", nativeUsd: number | null = 2000) => ({ total, currency, nativeUsd });
const invest = G({ id: "inv", name: "invest", target: 1000, start: 0, mode: "lock", funded: 701, createdAt: 1 });
const run100 = G({ id: "r100", name: "10 to 100", target: 100, start: 10, mode: "unlock", funded: 27, createdAt: 2 });

const alloc = allocate([invest, run100], POOL(728));
ok("alokasi: contoh 728$ -> terkunci 701$", alloc.locked === 701);
ok("alokasi: contoh 728$ -> bisa ditarik hanya 27$", alloc.free === 27);
ok("alokasi: nilai goal = dana masing-masing (701 dan 27)", alloc.values.inv === 701 && alloc.values.r100 === 27);
ok("tarik: 27$ boleh", checkWithdrawal(alloc, 27).ok);
ok("tarik: 27.01$ ditolak", !checkWithdrawal(alloc, 27.01).ok);
ok("tarik: 100$ ditolak (parsial)", (() => { const v = checkWithdrawal(alloc, 100); return !v.ok && v.reason === "partial" && v.free === 27; })());
ok("alokasi: hanya goal unlock -> semua bebas", allocate([run100], POOL(728)).free === 728);
ok("alokasi: goal unlock tidak pernah membatasi", checkWithdrawal(allocate([run100], POOL(728)), 728).ok);
ok("alokasi: goal tercapai tidak lagi mengunci", allocate([{ ...invest, status: "achieved" }, run100], POOL(728)).free === 728);
ok("alokasi: saldo turun -> terkunci dibatasi saldo nyata", (() => { const a = allocate([invest], POOL(500)); return a.locked === 500 && a.free === 0; })());
ok("alokasi: goal unlock hanya dapat sisa yang bebas", allocate([invest, G({ id: "u", mode: "unlock", funded: 100, createdAt: 3 })], POOL(750)).values.u === 49);
ok("alokasi: lock tanpa dana (goal lama) mengunci seluruh jaringan", (() => { const a = allocate([G()], POOL(50)); return a.wholeLocked && a.free === 0 && !checkWithdrawal(a, 0.0001).ok; })());
ok("alokasi: goal tanpa mode = lock (kompatibel)", modeOf(G()) === "lock" && isLockMode(G()));
ok("alokasi: unlock tanpa dana memakai sisa saldo bebas", allocate([invest, G({ id: "w", mode: "unlock", createdAt: 3 })], POOL(728)).values.w === 27);
ok("alokasi: goal native di pool USD dikonversi (0.1 ETH x 2000 = 200$)", (() => { const a = allocate([G({ unit: "native", mode: "lock", funded: 0.1, target: 1 })], POOL(1000)); return a.locked === 200 && a.free === 800 && Math.abs(a.values.g1 - 0.1) < 1e-12; })());
ok("alokasi: pool native (testnet)", (() => { const a = allocate([G({ unit: "native", mode: "lock", funded: 0.4, target: 1 })], POOL(1, "native", null)); return a.locked === 0.4 && Math.abs(a.free - 0.6) < 1e-12; })());
ok("alokasi: goal native di pool USD tanpa harga -> galat", (() => { try { allocate([G({ unit: "native", funded: 1 })], POOL(10, "usd", null)); return false; } catch { return true; } })());
ok("alokasi: mata uang pool USD jika ada goal USD", poolCurrency([G(), G({ unit: "native" })]) === "usd" && poolCurrency([G({ unit: "native" })]) === "native");

const outEth = { native: 0.01 };
ok("keluar: native di pool USD bernilai x harga", outgoingValue(outEth, POOL(728), {}) === 20);
ok("keluar: token memakai harga token", outgoingValue({ token: { address: "0xAbC", amount: 25 } }, POOL(728), { "0xabc": 1 }) === 25);
ok("keluar: token + gas dijumlahkan", outgoingValue({ native: 0.001, token: { address: "0xabc", amount: 25 } }, POOL(728), { "0xabc": 1 }) === 27);
ok("keluar: token tanpa harga di pool USD ditolak", (() => { try { outgoingValue({ token: { address: "0xabc", amount: 1 } }, POOL(728), {}); return false; } catch { return true; } })());
ok("keluar: pool native mengabaikan token (hanya gas native)", outgoingValue({ native: 0.001, token: { address: "0xabc", amount: 999 } }, POOL(1, "native", null), {}) === 0.001);

ok("dana: lock bisa ditambah", setFunded(invest, 800, 9).funded === 800);
ok("dana: lock tidak bisa dikurangi (celah membuka kunci)", (() => { try { setFunded(invest, 100); return false; } catch { return true; } })());
ok("dana: lock tanpa dana tidak bisa diberi alokasi", (() => { try { setFunded(G(), 10); return false; } catch { return true; } })());
ok("dana: unlock bebas naik/turun", setFunded(run100, 5).funded === 5 && setFunded(run100, 90).funded === 90);
ok("dana: harus > 0 dan goal aktif", (() => { try { setFunded(run100, 0); return false; } catch { return true; } })() && (() => { try { setFunded({ ...run100, status: "achieved" }, 5); return false; } catch { return true; } })());
ok("kunci: blockingGoal mengabaikan goal unlock", blockingGoal([run100], "refA", 8453) === null && blockingGoal([invest], "refA", 8453)?.id === "inv");
ok("kunci: lockGoals hanya yang lock aktif", lockGoals([invest, run100, { ...invest, id: "x", status: "cancelled" }], "refA", 8453).length === 1);
ok("validasi: mode & dana dicek", (() => { try { validateNewGoal({ ...vOk, funded: -1 }); return false; } catch { return true; } })() && (() => { try { validateNewGoal({ ...vOk, funded: 5, mode: "unlock" }); return true; } catch { return false; } })());

const T0 = 1_000_000;
ok("waktu: 5 menit/2 jam/3 hari", durationMs(5, "minute") === 300_000 && durationMs(2, "hour") === 7_200_000 && durationMs(3, "day") === 259_200_000);
ok("waktu: desimal 1.5 jam", durationMs(1.5, "hour") === 5_400_000);
ok("waktu: kurang dari 1 menit / nol / negatif / >365 hari ditolak", [0.5, 0, -1, 366].every((v, i) => { try { durationMs(v, i === 0 ? "minute" : i === 3 ? "day" : "hour"); return false; } catch { return true; } }));
const tl = planTimeLock(undefined, "refA", 2, "hour", T0);
ok("waktu: kunci berakhir sekarang + durasi", tl.until === T0 + 7_200_000);
ok("waktu: aktif sebelum habis, tidak aktif setelahnya", activeTimeLock([tl], "refA", T0 + 7_199_999) !== null && activeTimeLock([tl], "refA", T0 + 7_200_000) === null);
ok("waktu: wallet lain tidak terkunci", activeTimeLock([tl], "refB", T0) === null);
ok("waktu: tidak bisa diperpendek saat aktif", (() => { try { planTimeLock(tl, "refA", 30, "minute", T0 + 1000); return false; } catch { return true; } })());
ok("waktu: bisa diperpanjang", planTimeLock(tl, "refA", 1, "day", T0 + 1000).until === T0 + 1000 + 86_400_000);
ok("waktu: setelah habis boleh kunci pendek lagi", planTimeLock(tl, "refA", 5, "minute", T0 + 8_000_000).until === T0 + 8_000_000 + 300_000);
ok("waktu: merge memilih yang berakhir paling akhir", mergeTimeLock(tl, { ...tl, until: tl.until + 5 }).until === tl.until + 5 && mergeTimeLock(tl, { ...tl, until: tl.until - 5 }) === tl);
ok("waktu: format sisa", formatRemaining(90_061_000) === "1 hari 1 jam 2 menit" && formatRemaining(30_000) === "1 menit");

/* ------------------------------------------------- Riwayat: validasi data server */
const HI = { hash: "0xabc123def", chainId: 56, from: "0xF00", to: "0xBA5", amount: "0.00032147", symbol: "BNB", ts: 1700000000000, status: "success" };
ok("riwayat: item valid diterima", parseItem(HI)?.hash === "0xabc123def");
ok("riwayat: field tak dikenal dibuang", !("evil" in (parseItem({ ...HI, evil: "x" }) ?? {})));
ok("riwayat: status asing ditolak", parseItem({ ...HI, status: "hacked" }) === null);
ok("riwayat: hash berisi karakter aneh ditolak (anti URL explorer palsu)", parseItem({ ...HI, hash: "0xab/../../evil" }) === null && parseItem({ ...HI, hash: "0xab?x=1" }) === null);
ok("riwayat: jumlah non-numerik ditolak", parseItem({ ...HI, amount: "1e999<script>" }) === null);
ok("riwayat: string kepanjangan ditolak", parseItem({ ...HI, to: "x".repeat(101) }) === null);
ok("riwayat: bukan objek ditolak", parseItem(null) === null && parseItem("x") === null && parseItem(42) === null);
ok("riwayat: chainId/ts tidak valid ditolak", parseItem({ ...HI, chainId: 1.5 }) === null && parseItem({ ...HI, ts: NaN }) === null);

/* ------------------------------------------------------------ Face ID: segel password */
{
  const secretA = new Uint8Array(32).fill(7);
  const secretB = new Uint8Array(32).fill(8);
  const kA = await keyFromSecret(secretA);
  const kB = await keyFromSecret(secretB);
  const blob = await sealPassword(kA, "0xwallet1", "Sandi-Rahasia 123!");
  ok("faceid: segel lalu buka = password asli", (await openPassword(kA, "0xwallet1", blob)) === "Sandi-Rahasia 123!");
  ok("faceid: ciphertext tidak memuat password", !Buffer.from(blob, "base64").toString("latin1").includes("Sandi"));
  ok("faceid: dua penyegelan menghasilkan blob berbeda (IV acak)", blob !== (await sealPassword(kA, "0xwallet1", "Sandi-Rahasia 123!")));
  ok("faceid: kunci biometrik lain ditolak", await openPassword(kB, "0xwallet1", blob).then(() => false, () => true));
  ok("faceid: dipindah ke wallet lain ditolak (AAD)", await openPassword(kA, "0xwallet2", blob).then(() => false, () => true));
  ok("faceid: blob rusak/pendek ditolak", await openPassword(kA, "0xwallet1", "AAAA").then(() => false, () => true));
  ok("faceid: hkdf32 deterministik dan 32 byte", hkdf32(secretA, new Uint8Array([1])).length === 32 && Buffer.from(hkdf32(secretA, new Uint8Array([1]))).equals(Buffer.from(hkdf32(secretA, new Uint8Array([1])))));
  ok("faceid: info berbeda -> kunci berbeda", !Buffer.from(hkdf32(secretA, new Uint8Array([1]))).equals(Buffer.from(hkdf32(secretA, new Uint8Array([2])))));
}

/* -------------------------------------------------------- Buku alamat + whitelist */
{
  const A1 = "0x52908400098527886E0F7030069857D2E4169EE7"; // alamat EIP-55 valid
  const A2 = "0xde709f2102306220921060314715629080e2fb77";
  const SOL = "11111111111111111111111111111111"; // 32 byte nol (System Program)
  const mk = (over: Partial<Contact>): Contact => ({ id: "c1", name: "Budi", address: A1, kind: "evm", createdAt: 1, updatedAt: 1, ...over });

  ok("kontak: EVM valid dinormalisasi (checksum)", normalizeAddress("evm", A2.toLowerCase()) === normalizeAddress("evm", A2));
  ok("kontak: EVM checksum salah ditolak (ethers asli)", (() => { try { normalizeAddress("evm", A1.slice(0, -2) + "e7"); return false; } catch { return true; } })());
  ok("kontak: EVM format salah ditolak", ["0x123", "bukan-alamat", "", "0x" + "g".repeat(40)].every((v) => { try { normalizeAddress("evm", v); return false; } catch { return true; } }));
  ok("kontak: Solana 32 byte valid, panjang salah ditolak", normalizeAddress("sol", SOL) === SOL && (() => { try { normalizeAddress("sol", "abc"); return false; } catch { return true; } })());
  ok("kontak: BTC bech32 dinormalisasi huruf kecil", normalizeAddress("btc", "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4") === "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
  ok("kontak: BTC bech32 huruf campuran ditolak", (() => { try { normalizeAddress("btc", "bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"); return false; } catch { return true; } })());
  ok("kontak: BTC legacy base58 diterima, sampah ditolak", normalizeAddress("btc", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2") === "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" && (() => { try { normalizeAddress("btc", "0OIl"); return false; } catch { return true; } })());
  ok("kontak: sameAddress EVM tak peka huruf, base58 peka", sameAddress("evm", A1, A1.toLowerCase()) && !sameAddress("sol", "AbC", "abc") && sameAddress("btc", "bc1qabc", "BC1QABC"));

  const base = [mk({})];
  ok("kontak: nama kosong / terlalu panjang ditolak", ["", "   ", "x".repeat(25)].every((n) => { try { validateContact([], { name: n, address: A1, kind: "evm" }); return false; } catch { return true; } }));
  ok("kontak: nama ganda ditolak (tak peka huruf)", (() => { try { validateContact(base, { name: "budi", address: A2, kind: "evm" }); return false; } catch { return true; } })());
  ok("kontak: alamat ganda ditolak (jenis sama)", (() => { try { validateContact(base, { name: "Lain", address: A1.toLowerCase(), kind: "evm" }); return false; } catch { return true; } })());
  ok("kontak: ubah diri sendiri tidak dianggap duplikat", validateContact(base, { name: "Budi", address: A1, kind: "evm", note: "  teman  " }, "c1").note === "teman");
  ok("kontak: spasi & karakter kontrol dirapikan", validateContact([], { name: "  Ana \n\t Maria ", address: A1, kind: "evm" }).name === "Ana Maria");
  ok("kontak: catatan > 60 ditolak", (() => { try { validateContact([], { name: "X", address: A1, kind: "evm", note: "y".repeat(61) }); return false; } catch { return true; } })());
  ok("kontak: batas jumlah kontak", (() => { try { validateContact(Array.from({ length: 200 }, (_, i) => mk({ id: "i" + i, name: "n" + i, address: "0x" + i.toString(16).padStart(40, "0") })), { name: "Baru", address: A2, kind: "evm" }); return false; } catch { return true; } })());
  ok("kontak: data tersimpan yang rusak ditolak isContact", !isContact(null) && !isContact({ id: 1 }) && !isContact({ ...mk({}), kind: "xyz" }) && isContact(mk({})));

  ok("whitelist: nonaktif -> semua boleh", isRecipientAllowed(false, [], "evm", A2));
  ok("whitelist: aktif -> alamat di kontak boleh", isRecipientAllowed(true, base, "evm", A1.toLowerCase()));
  ok("whitelist: aktif -> alamat asing ditolak", !isRecipientAllowed(true, base, "evm", A2));
  ok("whitelist: aktif -> alamat sendiri boleh", isRecipientAllowed(true, [], "evm", A2, A2.toLowerCase()));
  ok("whitelist: aktif -> alamat tak valid ditolak", !isRecipientAllowed(true, base, "evm", "ngawur"));
  ok("whitelist: kontak EVM tidak berlaku untuk jenis lain", !isRecipientAllowed(true, base, "sol", SOL));
}

/* ------------------------------------------------- 2FA kirim: verifikasi assertion */
{
  const enc = new TextEncoder();
  const sha = async (u: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", u as unknown as BufferSource));
  const rawToDer = (raw: Uint8Array) => {
    const part = (x: Uint8Array) => { let i = 0; while (i < 31 && x[i] === 0) i++; let v = x.slice(i); if (v[0] & 0x80) v = new Uint8Array([0, ...v]); return [0x02, v.length, ...v]; };
    const body = [...part(raw.slice(0, 32)), ...part(raw.slice(32))];
    return new Uint8Array([0x30, body.length, ...body]);
  };
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey));
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const RP = "kunci.example", ORIGIN = "https://kunci.example";
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  async function make(o: { flags?: number; rp?: string; origin?: string; type?: string; chal?: Uint8Array; key?: CryptoKeyPair; tamper?: boolean } = {}) {
    const ad = new Uint8Array(37);
    ad.set(await sha(enc.encode(o.rp ?? RP)));
    ad[32] = o.flags ?? 0x05; // UP + UV
    const cdj = enc.encode(JSON.stringify({ type: o.type ?? "webauthn.get", challenge: b64u(o.chal ?? challenge), origin: o.origin ?? ORIGIN }));
    const signed = new Uint8Array(ad.length + 32); signed.set(ad); signed.set(await sha(cdj), ad.length);
    const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, (o.key ?? kp).privateKey, signed));
    if (o.tamper) raw[5] ^= 1;
    return { pub, authenticatorData: ad, clientDataJSON: cdj, signature: rawToDer(raw), challenge, rpId: RP, origin: ORIGIN };
  }
  const rejects = async (input: Awaited<ReturnType<typeof make>>) => verifyAssertion(input).then(() => false, () => true);

  ok("2fa: assertion sah diterima", await verifyAssertion(await make()).then(() => true, () => false));
  ok("2fa: tanpa flag UV ditolak (tidak ada verifikasi biometrik)", await rejects(await make({ flags: 0x01 })));
  ok("2fa: tanpa flag UP ditolak", await rejects(await make({ flags: 0x04 })));
  ok("2fa: challenge lain ditolak (replay)", await rejects(await make({ chal: crypto.getRandomValues(new Uint8Array(32)) })));
  ok("2fa: rpId lain ditolak", await rejects(await make({ rp: "jahat.example" })));
  ok("2fa: origin lain ditolak", await rejects(await make({ origin: "https://jahat.example" })));
  ok("2fa: jenis bukan webauthn.get ditolak", await rejects(await make({ type: "webauthn.create" })));
  ok("2fa: ditandatangani kunci lain ditolak", await rejects(await make({ key: other })));
  ok("2fa: tanda tangan diubah ditolak", await rejects(await make({ tamper: true })));
  ok("2fa: DER dengan nol di depan & r pendek diproses benar", (() => { const raw = new Uint8Array(64); raw[31] = 1; raw[32] = 0x80; raw[63] = 2; const back = derToRaw(rawToDer(raw)); return back.every((v, i) => v === raw[i]); })());
  ok("2fa: DER rusak ditolak", [new Uint8Array([1, 2, 3]), new Uint8Array([0x30, 2, 0x02, 0]), new Uint8Array(0)].every((d) => { try { derToRaw(d); return false; } catch { return true; } }));
  ok("2fa: base64url tanpa padding", b64u(new Uint8Array([251, 255, 254])) === "-__-" && b64u(new Uint8Array([1])) === "AQ");
}

/* ------------------------------------------------- 2FA kirim: pengaturan + penegak */
{
  const W = "0xwallettes";
  ok("2fa: bawaan = mode tinjau tanpa Face ID", getTxSettings(W).mode === "review" && getTxSettings(W).auth === false);
  setSendMode(W, "fast");
  ok("2fa: mode cepat tersimpan per wallet", getTxSettings(W).mode === "fast" && getTxSettings("0xlain").mode === "review");
  ok("2fa: penegak tidak menghalangi saat 2FA mati", (() => { try { assertTxAuthorized({ address: W }, { kind: "evm", chainId: 1, to: "0xabc" }); return true; } catch { return false; } })());
  clearTxAuth(W);
  ok("2fa: hapus data wallet mengembalikan bawaan", getTxSettings(W).mode === "review");
}

/* ------------------------------------------------------------------ Zcash transparent */
{
  const te = new TextEncoder();
  const hexOf = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
  const rnd20 = () => Uint8Array.from({ length: 20 }, () => Math.floor(Math.random() * 256));
  const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

  // --- alamat
  ok("zec: prefix 1CB8 selalu menghasilkan 't1' (35 karakter)", Array.from({ length: 300 }, () => encodeP2pkh(rnd20())).every((a) => a.startsWith("t1") && a.length === 35));
  ok("zec: prefix 1CBD selalu menghasilkan 't3' (35 karakter)", Array.from({ length: 300 }, () => encodeP2sh(rnd20())).every((a) => a.startsWith("t3") && a.length === 35));
  const h = rnd20();
  const a1 = encodeP2pkh(h);
  const r1 = parseRecipient(a1);
  ok("zec: parse t1 -> p2pkh, hash sama, script 25 byte", r1.type === "p2pkh" && hexOf(r1.hash) === hexOf(h) && r1.script.length === 25 && r1.script[0] === 0x76 && r1.script[24] === 0xac);
  const r3 = parseRecipient(encodeP2sh(h));
  ok("zec: parse t3 -> p2sh, script 23 byte (a9 14 .. 87)", r3.type === "p2sh" && r3.script.length === 23 && r3.script[0] === 0xa9 && r3.script[22] === 0x87);
  ok("zec: spasi di sekitar alamat dipangkas", parseRecipient(`  ${a1} \n`).address === a1);
  ok("zec: alamat shielded/unified ditolak dengan pesan jelas", ["zs1qqqqqqqqqqqq", "u1qqqqqqqqqqqq", "ztestsapling1qqqq", "tex1qqqqqqqq"].every((v) => { try { parseRecipient(v); return false; } catch (e) { return /shielded|unified/i.test((e as Error).message); } }));
  ok("zec: checksum salah ditolak", throws(() => parseRecipient(a1.slice(0, -1) + (a1.endsWith("A") ? "B" : "A"))));
  ok("zec: alamat Bitcoin ditolak", throws(() => parseRecipient("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")) && throws(() => parseRecipient("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")));
  ok("zec: kosong/sampah ditolak", throws(() => parseRecipient("")) && throws(() => parseRecipient("0OIl")) && throws(() => parseRecipient("t1")));
  const testnet = (() => { const p = new Uint8Array(22); p.set([0x1d, 0x25]); p.set(h, 2); return createBase58check(zsha256).encode(p); })();
  ok("zec: alamat testnet (tm…) ditolak di mainnet", testnet.startsWith("tm") && throws(() => parseRecipient(testnet)));
  ok("zec: hash160 pubkey G = 751e76e8…3bd6 (vektor baku)", hexOf(hash160(Uint8Array.from("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798".match(/../g)!, (x) => parseInt(x, 16)))) === "751e76e8199196d454941c45d1b3a323f1433bd6");

  // --- parameter konsensus
  ok("zec: branch ID per tinggi blok", branchIdAt(1_687_104) === 0xc2d6d0b4 && branchIdAt(2_726_399) === 0xc2d6d0b4 && branchIdAt(2_726_400) === 0xc8e71055 && branchIdAt(3_146_400) === 0x4dec4df0 && branchIdAt(9_000_000) === 0x4dec4df0);
  ok("zec: tinggi di bawah NU5 ditolak", throws(() => branchIdAt(1_000_000)));

  // --- fee ZIP-317
  ok("zec: fee ZIP-317", zip317Fee(1, 1) === 10_000n && zip317Fee(1, 2) === 10_000n && zip317Fee(3, 2) === 15_000n && zip317Fee(2, 5) === 25_000n);

  // --- pemilihan koin
  const U = (v: number, i = 0) => ({ txid: i.toString(16).padStart(64, "0"), vout: i, value: BigInt(v) });
  const one = planSpend([U(1_000_000)], 100_000n, false);
  ok("zec: 1 input -> jumlah + kembalian + fee 10000", one.inputs.length === 1 && one.fee === 10_000n && one.change === 890_000n);
  ok("zec: saldo pas (tanpa kembalian) menjadi fee", (() => { const p = planSpend([U(110_000)], 100_000n, false); return p.change === 0n && p.fee === 10_000n; })());
  ok("zec: kembalian < MIN_CHANGE dilebur ke fee", (() => { const p = planSpend([U(115_000)], 100_000n, false); return p.change === 0n && p.fee === 15_000n; })());
  ok("zec: kurang 1 zatoshi -> galat", throws(() => planSpend([U(109_999)], 100_000n, false)));
  ok("zec: jumlah < 0.0001 ZEC ditolak", throws(() => planSpend([U(1_000_000)], 9_999n, false)));
  ok("zec: tanpa UTXO ditolak", throws(() => planSpend([], 20_000n, false)));
  ok("zec: gabung beberapa UTXO, terbesar dulu", (() => { const p = planSpend([U(50_000, 1), U(300_000, 2), U(40_000, 3)], 320_000n, false); return p.inputs.length === 2 && p.inputs[0].value === 300_000n; })());
  ok("zec: maks = seluruh saldo - fee", (() => { const p = planSpend([U(50_000, 1), U(300_000, 2)], 0n, true); return p.amount === 350_000n - 10_000n && p.fee === 10_000n && p.change === 0n && p.inputs.length === 2; })());
  ok("zec: maks dengan saldo terlalu kecil ditolak", throws(() => planSpend([U(15_000)], 0n, true)));
  ok("zec: lebih dari MAX_INPUTS ditolak", throws(() => planSpend(Array.from({ length: MAX_INPUTS + 1 }, (_, i) => U(20_000, i)), 0n, true)));
  ok("zec: uji acak 3000x: jumlah = input, fee wajar, kembalian valid", (() => {
    for (let n = 0; n < 3000; n++) {
      const us = Array.from({ length: 1 + Math.floor(Math.random() * 12) }, (_, i) => U(Math.floor(Math.random() * 5_000_000) + 1, i));
      const amount = BigInt(Math.floor(Math.random() * 6_000_000) + 10_000);
      let p;
      try { p = planSpend(us, amount, false); } catch {
        // boleh gagal hanya jika memang tidak ada awalan UTXO (terbesar dulu) yang cukup
        const sorted = [...us].sort((a, b) => Number(b.value - a.value)); let s = 0n;
        for (let k = 0; k < sorted.length; k++) { s += sorted[k].value; if (s >= amount + zip317Fee(k + 1, 1)) return false; }
        continue;
      }
      const inSum = p.inputs.reduce((s, u) => s + u.value, 0n);
      const outs = p.change > 0n ? 2 : 1;
      if (inSum !== p.amount + p.fee + p.change) return false;
      if (p.amount !== amount) return false;
      if (p.fee < zip317Fee(p.inputs.length, outs)) return false;
      if (p.fee > zip317Fee(p.inputs.length, 2) + MIN_CHANGE) return false;
      if (p.change !== 0n && p.change < MIN_CHANGE) return false;
      if (!p.inputs.every((i) => us.some((u) => u.txid === i.txid && u.vout === i.vout))) return false;
    }
    return true;
  })());

  // --- penyandian
  ok("zec: compactSize batas 252/253/65535/65536", hexOf(compactSize(252)) === "fc" && hexOf(compactSize(253)) === "fdfd00" && hexOf(compactSize(0xffff)) === "fdffff" && hexOf(compactSize(0x10000)) === "fe00000100");
  ok("zec: i64 menolak negatif dan melebihi 2^63-1", throws(() => i64(-1n)) && throws(() => i64(1n << 63n)) && hexOf(i64(1n)) === "0100000000000000");

  const own = p2pkhScript(hash160(new Uint8Array(33).fill(2)));
  const tx: ZTx = {
    branchId: 0x4dec4df0, lockTime: 0, expiryHeight: 3_200_040,
    inputs: [
      { txid: "11".repeat(31) + "aa", vout: 1, value: 500_000n, script: own },
      { txid: "22".repeat(31) + "bb", vout: 0, value: 700_000n, script: own },
    ],
    outputs: [{ value: 600_000n, script: r1.script }, { value: 590_000n, script: own }],
  };
  const raw = serializeV5(tx, [null, null]);
  ok("zec: header v5 (05000080 0a27a726 + branch) dan akhiran 000000", hexOf(raw.slice(0, 12)) === "050000800a27a726f04dec4d" && hexOf(raw.slice(-3)) === "000000");
  const back = parseV5(raw);
  ok("zec: serialisasi lalu parse = data semula", back.branchId === tx.branchId && back.expiryHeight === tx.expiryHeight && back.inputs.length === 2 && back.inputs[0].txid === tx.inputs[0].txid && back.inputs[1].vout === 0 && back.outputs[0].value === 600_000n && hexOf(back.outputs[1].script) === hexOf(own) && back.shieldedEmpty);
  ok("zec: txid ditulis urutan terbalik (byte pertama = byte terakhir txid)", raw[21] === 0xaa);
  ok("zec: transaksi terpotong / kelebihan byte ditolak", throws(() => parseV5(raw.slice(0, raw.length - 1))) && throws(() => parseV5(Uint8Array.from([...raw, 0]))));
  ok("zec: txid bukan 64 hex ditolak", throws(() => serializeV5({ ...tx, inputs: [{ ...tx.inputs[0], txid: "abc" }] }, [null])));

  // --- sighash ZIP-244
  const p16 = (s: string) => { const o = new Uint8Array(16); o.set(te.encode(s)); return o; };
  ok("zec: konstanta ZIP-244 digest Sapling kosong cocok", hexOf(blake2b(new Uint8Array(0), { dkLen: 32, personalization: p16("ZTxIdSaplingHash") })) === "6f2fc8f98feafd94e74a0df4bed74391ee0b5a69945e4ced8ca8a095206f00ae");
  ok("zec: konstanta ZIP-244 digest Orchard kosong cocok", hexOf(blake2b(new Uint8Array(0), { dkLen: 32, personalization: p16("ZTxIdOrchardHash") })) === "9fbe4ed13b0c08e671c11a3407d84e1117cd45028a2eee1b9feae78b48a6e2c1");
  const s0 = sigHashV5(tx, 0), s1 = sigHashV5(tx, 1);
  ok("zec: sighash 32 byte, deterministik, beda per input", s0.length === 32 && hexOf(s0) === hexOf(sigHashV5(tx, 0)) && hexOf(s0) !== hexOf(s1));
  const changed = (f: (t: ZTx) => ZTx) => hexOf(sigHashV5(f(tx), 0)) !== hexOf(s0);
  ok("zec: sighash berubah jika output/jumlah/branch/expiry/input diubah", changed((t) => ({ ...t, outputs: [{ ...t.outputs[0], value: 600_001n }, t.outputs[1]] }))
    && changed((t) => ({ ...t, outputs: [{ ...t.outputs[0], script: own }, t.outputs[1]] }))
    && changed((t) => ({ ...t, branchId: 0xc8e71055 }))
    && changed((t) => ({ ...t, expiryHeight: t.expiryHeight + 1 }))
    && changed((t) => ({ ...t, inputs: [{ ...t.inputs[0], value: 500_001n }, t.inputs[1]] }))
    && changed((t) => ({ ...t, inputs: [t.inputs[0], { ...t.inputs[1], vout: 9 }] })));

  // --- tanda tangan (stub di sandbox): struktur scriptSig
  const pub = new Uint8Array(33).fill(2);
  const ps = parseV5(signV5(tx, new Uint8Array(32).fill(1), pub));
  ok("zec: transaksi bertanda tangan: scriptSig terisi per input, output tak berubah", ps.inputs.every((i) => i.scriptSigLen > 34 && i.scriptSigLen <= 107) && ps.outputs.length === 2 && ps.outputs[0].value === 600_000n && ps.shieldedEmpty);
}

/* ------------------------------------------------- Zcash: penyedia data (fetch palsu) */
{
const zchain = { chainId: 900_000_201, name: "Zcash", symbol: "ZEC", testnet: false, rpcUrls: ["https://api.blockchair.com/zcash?key=SECRET"], kind: "zec" } as never;
const ADDR = "t1abc";
let zcalls: string[] = []; let zmode: "ok" | "430" | "429" | "net" = "ok";
const zbody = (o: unknown) => JSON.stringify(o);
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  zcalls.push(String(url));
  if (zmode === "430") return new Response(zbody({ data: null, context: { code: 430, error: "Your IP address is temporary blacklisted due to exceeding" } }), { status: 430 });
  if (zmode === "429") return new Response("slow down", { status: 429, headers: { "retry-after": "2" } });
  if (zmode === "net") throw new TypeError("Failed to fetch");
  if (String(url).includes("/stats")) return new Response(zbody({ data: { blocks: 3_610_156 } }));
  return new Response(zbody({ data: { [ADDR]: { address: { balance: 150000, unspent_output_count: 1 }, utxo: [{ block_id: 3610000, transaction_hash: "ab".repeat(32), index: 0, value: 150000 }] } } }));
}) as never;

const bal1 = await zecBalance(zchain, ADDR);
ok("provider: saldo dimuat, UTXO terkonfirmasi", bal1.total === 150000n && bal1.confirmed === 150000n && bal1.utxos.length === 1);
ok("provider: API key pada URL dipertahankan (?key=) dan path benar", zcalls[0] === "https://api.blockchair.com/zcash/dashboards/address/t1abc?key=SECRET");
zcalls = [];
await zecBalance(zchain, ADDR); await zecBalance(zchain, ADDR);
ok("provider: cache 45 dtk -> tidak ada permintaan ulang", zcalls.length === 0);

// tip: cache + penggabungan permintaan serentak
const [t1, t2, t3] = await Promise.all([zecTip(zchain), zecTip(zchain), zecTip(zchain)]);
ok("provider: tinggi blok, 3 pemanggil serentak = 1 permintaan", t1 === 3_610_156 && t2 === t1 && t3 === t1 && zcalls.length === 1);
zcalls = [];
await zecTip(zchain);
ok("provider: tip di-cache 30 dtk", zcalls.length === 0);

// 430: pemblokiran IP -> jeda panjang, tidak menghantam lagi
zmode = "430";
const forced = await zecBalance(zchain, ADDR, true).then(() => "ok", (e) => String(e.message));
ok("provider: HTTP 430 -> pesan jelas (diblokir sementara, jeda 5 menit, saran endpoint/API key)", /430/.test(forced) && /diblokir sementara/.test(forced) && /5 menit/.test(forced));
const zcallsAfter430 = zcalls.length;
await zecBalance(zchain, ADDR, true).catch(() => {}); await zecBalance(zchain, ADDR, true).catch(() => {}); await zecBalance(zchain, ADDR, true).catch(() => {});
ok("provider: setelah 430, permintaan berikutnya TIDAK menyentuh jaringan (tidak memperpanjang blokir)", zcalls.length === zcallsAfter430);
const again = await zecBalance(zchain, ADDR, true).then(() => "ok", (e) => String(e.message));
ok("provider: pesan jeda menyebut sisa detik", /dijeda \d+ dtk/.test(again));

// saldo lama untuk tampilan
const stale = await zecBalanceOrStale(zchain, ADDR);
ok("provider: saat diblokir, tampilan memakai saldo terakhir yang berhasil (stale)", stale.total === 150000n && stale.stale === true);
const tipStale = await zecTip(zchain, false);
ok("provider: tip memakai nilai terakhir saat diblokir (bukan 'RPC offline')", tipStale === 3_610_156);
ok("provider: diagnosa (bypass) tetap menembus jeda untuk menguji endpoint", await zecTip(zchain, true).then(() => false, (e) => /430/.test(e.message)));

// alamat lain tanpa data lama: galat tetap dilempar (tidak mengarang saldo)
ok("provider: tanpa data lama, galat dilempar (tidak ada saldo karangan)", await zecBalanceOrStale(zchain, "t1lain").then(() => false, () => true));

globalThis.fetch = realFetch;
}

/* ------------------------------------------------- Zcash: adapter JSON-RPC (Zebra/Tatum) */
{
const mk = (urls: string[]) => ({ chainId: 900_000_201, name: "Zcash", symbol: "ZEC", testnet: false, rpcUrls: urls, kind: "zec" }) as never;
const ADDR = "t1abc";
type Req = { url: string; headers: Record<string, string>; body: { method: string; params: unknown[] } | null };
let log: Req[] = [];
let handler: (r: Req) => Response = () => new Response("{}");
const realFetchRpc = globalThis.fetch;
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const r: Req = { url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : null };
  log.push(r);
  return handler(r);
}) as never;
const rpcOk = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
const rpcErr = (code: number, message: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code, message } }));

// 1) Tatum Zebra: dikenali sebagai JSON-RPC, key dipindah ke header
const TAT = "https://zcash-mainnet-zebrad.gateway.tatum.io?key=KUNCI123";
handler = (r) => {
  if (r.body?.method === "getaddressutxos") return rpcOk([{ address: ADDR, txid: "ab".repeat(32), outputIndex: 1, script: "76a914", satoshis: 250000, height: 3600000 }, { address: ADDR, txid: "cd".repeat(32), outputIndex: 0, script: "76a914", satoshis: 50000, height: 3600001 }]);
  if (r.body?.method === "getblockcount") return rpcOk(3610500);
  return rpcErr(-32601, "Method not found");
};
const b = await zecBalance(mk([TAT]), ADDR, true);
ok("rpc: saldo = jumlah UTXO, semua terkonfirmasi", b.total === 300000n && b.confirmed === 300000n && b.unconfirmed === 0n && b.utxos.length === 2 && b.utxos[0].vout === 1);
ok("rpc: metode & parameter getaddressutxos benar", log[0].body?.method === "getaddressutxos" && JSON.stringify(log[0].body?.params) === JSON.stringify([{ addresses: [ADDR] }]));
ok("rpc: API key dikirim sebagai header x-api-key dan TIDAK ada di URL", log[0].headers["x-api-key"] === "KUNCI123" && !log[0].url.includes("KUNCI123") && !log[0].url.includes("key="));
ok("rpc: POST JSON ke URL dasar", log[0].url === "https://zcash-mainnet-zebrad.gateway.tatum.io/" && log[0].headers["Content-Type"] === "application/json");
ok("rpc: tinggi blok dari getblockcount", (await zecTip(mk([TAT]), true)) === 3610500);

// 2) akhiran #jsonrpc untuk node sendiri
log = [];
await zecTip(mk(["https://node.example.com:8232/#jsonrpc"]), true);
ok("rpc: akhiran #jsonrpc memilih adapter RPC, fragment dibuang dari URL", log[0].body?.method === "getblockcount" && !log[0].url.includes("#"));

// 3) status tx
handler = (r) => r.body?.method === "getrawtransaction" ? rpcOk({ confirmations: 3, height: 3610000 }) : rpcOk(null);
ok("rpc: tx terkonfirmasi -> success", (await zecTxStatus(mk([TAT]), "ab".repeat(32))) === "success");
handler = () => rpcOk({ confirmations: 0 });
ok("rpc: tx di mempool -> pending", (await zecTxStatus(mk([TAT]), "ab".repeat(32))) === "pending");
handler = () => rpcErr(-5, "No such mempool or main chain transaction");
ok("rpc: tx belum terlihat (galat -5) -> pending, bukan galat", (await zecTxStatus(mk([TAT]), "ab".repeat(32))) === "pending");

// 4) siaran
handler = (r) => r.body?.method === "sendrawtransaction" ? rpcOk("ef".repeat(32)) : rpcOk(null);
log = [];
ok("rpc: sendrawtransaction mengembalikan txid", (await zecBroadcast(mk([TAT]), "0500008001")) === "ef".repeat(32) && JSON.stringify(log[0].body?.params) === JSON.stringify(["0500008001"]));
handler = () => rpcErr(-26, "mandatory-script-verify-flag-failed");
ok("rpc: transaksi ditolak node -> pesan galat apa adanya (tanpa dikira masalah jaringan)", await zecBroadcast(mk(["https://other-zebra.gateway.tatum.io"]), "0500008001").then(() => false, (e) => /mandatory-script-verify/.test(e.message) && !/tidak bisa dihubungi/.test(e.message)));

// 5) butuh API key (401/403) dan fallback ke penyedia kedua
let n = 0;
handler = (r) => {
  if (r.url.includes("tatum.io")) return new Response("Unauthorized", { status: 401 });
  if (r.url.includes("/stats")) return new Response(JSON.stringify({ data: { blocks: 3610777 } }));
  return new Response("{}");
};
const two = mk(["https://zcash-mainnet-zebrad.gateway.tatum.io", "https://api.blockchair.com/zcash"]);
ok("rpc: penyedia pertama 401 -> otomatis jatuh ke Blockchair", (await zecTip(two, true)) === 3610777);
handler = () => new Response("Forbidden", { status: 403 });
const msg = await zecTip(mk(["https://zcash-mainnet-zebrad.gateway.tatum.io"]), true).then(() => "", (e) => e.message);
ok("rpc: 403 -> pesan menyuruh menambahkan ?key=", /API key/.test(msg) && /\?key=/.test(msg));
void n;

// 6) fetch gagal (CORS/jaringan) -> penyedia berikutnya, pesan menyebut CORS
globalThis.fetch = (async (url: string) => { if (String(url).includes("tatum")) throw new TypeError("Failed to fetch"); return new Response(JSON.stringify({ data: { blocks: 3610888 } })); }) as never;
ok("rpc: fetch gagal (mis. CORS) di penyedia pertama -> lanjut ke penyedia kedua", (await zecTip(mk(["https://x-zebrad.gateway.tatum.io", "https://api.blockchair.com/zcash"]), true)) === 3610888);
const m2 = await zecTip(mk(["https://y-zebrad.gateway.tatum.io"]), true).then(() => "", (e) => e.message);
ok("rpc: pesan kegagalan fetch menyebut CORS", /CORS/.test(m2));

globalThis.fetch = realFetchRpc;
}

/* ------------------------------------------------- Harga: sumber berlapis (fetch palsu) */
{
type Handler = (url: URL) => Response | Promise<Response>;
let calls: string[] = [];
let routes: { test: RegExp; h: Handler }[] = [];
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const on = (test: RegExp, h: Handler) => routes.unshift({ test, h });
const realFetchPr = globalThis.fetch;
globalThis.fetch = (async (u: string) => {
  calls.push(String(u));
  const r = routes.find((x) => x.test.test(String(u)));
  if (!r) throw new TypeError("Failed to fetch (tak ada rute): " + u);
  return r.h(new URL(String(u)));
}) as never;
const reset = () => { resetPriceState(); calls = []; routes = []; };
const hits = (re: RegExp) => calls.filter((c) => re.test(c)).length;
const LL = /coins\.llama\.fi/, BN = /binance\.vision/, CGR = /coingecko\.com/, DX = /dexscreener\.com/, FX1 = /open\.er-api\.com/, FX2 = /frankfurter/;
const llamaNatives = (miss: string[] = []) => on(LL, (u) => {
  const P: Record<string, number> = { "coingecko:ethereum": 3000, "coingecko:binancecoin": 600, "coingecko:polygon-ecosystem-token": 0.5, "coingecko:plasma": 2, "coingecko:bitcoin": 90000, "coingecko:solana": 150, "coingecko:zcash": 33 };
  const coins: Record<string, unknown> = {};
  for (const k of decodeURIComponent(u.pathname).split("/").pop()!.split(",")) if (P[k] && !miss.includes(k)) coins[k] = { price: P[k], confidence: 0.99 };
  return json({ coins });
});
const fxOk = (rate = 16000) => on(FX1, () => json({ rates: { IDR: rate } }));

// ---------------- koin native
reset(); llamaNatives(); fxOk();
let n = await nativePrices();
ok("native: DefiLlama dipakai pertama, 1 permintaan untuk semua koin", hits(LL) === 1 && hits(BN) === 0 && hits(CGR) === 0);
ok("native: harga benar per chainId (ETH & Base sama)", n[1]?.usd === 3000 && n[8453]?.usd === 3000 && n[56]?.usd === 600 && n[900_000_201]?.usd === 33 && n[900_000_001]?.usd === 90000);
ok("native: IDR = USD x kurs dari API kurs", n[56]?.idr === 600 * 16000);

reset(); on(LL, () => json({}, 500)); on(BN, (u) => { const syms = JSON.parse(u.searchParams.get("symbols")!) as string[]; const P: Record<string, string> = { ETHUSDT: "3001", BNBUSDT: "601", POLUSDT: "0.51", XPLUSDT: "2.1", BTCUSDT: "90001", SOLUSDT: "151", ZECUSDT: "34" }; return json(syms.map((s) => ({ symbol: s, price: P[s] }))); }); fxOk();
n = await nativePrices();
ok("native: DefiLlama gagal -> Binance mengisi semua", n[1]?.usd === 3001 && n[56]?.usd === 601 && n[900_000_201]?.usd === 34 && hits(CGR) === 0);
ok("native: Binance diminta lewat parameter symbols (JSON) dengan pasangan USDT", calls.some((c) => /symbols=%5B/.test(c) && /ZECUSDT/.test(decodeURIComponent(c))));

reset(); llamaNatives(["coingecko:zcash"]); on(BN, (u) => json(JSON.parse(u.searchParams.get("symbols")!).map((s: string) => ({ symbol: s, price: "35" })))); fxOk();
n = await nativePrices();
ok("native: Llama tanpa ZEC -> Binance hanya diminta untuk yang kurang (ZEC)", n[900_000_201]?.usd === 35 && n[1]?.usd === 3000 && hits(BN) === 1 && JSON.parse(new URL(calls.find((c) => BN.test(c))!).searchParams.get("symbols")!).join() === "ZECUSDT");

reset(); on(LL, () => json({}, 429)); on(BN, () => json({}, 451)); on(CGR, () => json({ ethereum: { usd: 2900, idr: 46_400_000 }, binancecoin: { usd: 580, idr: 9_280_000 }, "polygon-ecosystem-token": { usd: 0.4, idr: 6400 }, plasma: { usd: 1.8, idr: 28_800 }, bitcoin: { usd: 88000, idr: 1_408_000_000 }, solana: { usd: 140, idr: 2_240_000 }, zcash: { usd: 30, idr: 480_000 } }));
n = await nativePrices();
ok("native: Llama & Binance gagal -> CoinGecko jadi cadangan terakhir (IDR langsung dari CG)", n[1]?.usd === 2900 && n[1]?.idr === 46_400_000 && hits(FX1) === 0);

reset(); on(LL, () => json({}, 500)); on(BN, () => json({}, 500)); on(CGR, () => json({}, 429));
ok("native: semua sumber gagal dan tanpa data lama -> galat", await nativePrices().then(() => false, () => true));

reset(); llamaNatives(); fxOk();
await nativePrices(); const firstCalls = calls.length; await nativePrices();
ok("native: cache 5 menit, panggilan kedua tanpa jaringan", calls.length === firstCalls);

reset(); on(LL, () => json({}, 500)); on(BN, () => json({}, 500));
on(CGR, (u) => {
  if (u.pathname.endsWith("/search")) {
    const symbol = u.searchParams.get("query")!.toLowerCase();
    return json({ coins: symbol === "xyz"
      ? [{ id: "xyz-coin", symbol: "XYZ" }]
      : [{ id: "dup-one", symbol: "DUP" }, { id: "dup-two", symbol: "dup" }] });
  }
  return json({ "xyz-coin": { usd: 2, idr: 32000 } });
});
const customNative = [
  { chainId: 912345, name: "Custom XYZ", symbol: "XYZ", testnet: false, custom: true, rpcUrls: [], explorer: "" },
  { chainId: 912346, name: "Custom DUP", symbol: "DUP", testnet: false, custom: true, rpcUrls: [], explorer: "" },
];
n = await nativePrices(customNative);
ok("native: custom chain otomatis menemukan CoinGecko berdasarkan simbol yang unik", n[912345]?.usd === 2);
ok("native: simbol CoinGecko ambigu tidak diberi harga tebakan", n[912346] === null);

// kurs IDR
reset(); llamaNatives(); on(FX1, () => json({}, 500)); on(FX2, () => json({ rates: { IDR: 15900 } }));
n = await nativePrices();
ok("kurs: er-api gagal -> Frankfurter", n[56]?.idr === 600 * 15900 && hits(FX2) === 1);
reset(); llamaNatives(); on(FX1, () => json({ rates: { IDR: 5 } })); on(FX2, () => json({ rates: { IDR: 16100 } }));
n = await nativePrices();
ok("kurs: nilai tak masuk akal (5) ditolak, pakai cadangan", n[56]?.idr === 600 * 16100);
reset(); llamaNatives(); on(FX1, () => json({}, 500)); on(FX2, () => json({}, 500));
n = await nativePrices();
ok("kurs: semua sumber kurs gagal -> USD tetap ada, IDR = 0 (tidak dikarang)", n[56]?.usd === 600 && n[56]?.idr === 0);

// ---------------- token
const T1 = "0x" + "a1".repeat(20), T2 = "0x" + "b2".repeat(20), T3 = "0x" + "c3".repeat(20);
reset(); fxOk();
on(LL, (u) => { const keys = decodeURIComponent(u.pathname).split("/").pop()!.split(","); const coins: Record<string, unknown> = {}; for (const k of keys) { if (k.endsWith(T1)) coins[k.replace(T1, T1.toUpperCase().replace("0X", "0x"))] = { price: 1.0002, confidence: 0.99 }; if (k.endsWith(T2)) coins[k] = { price: 777, confidence: 0.3 }; } return json({ coins }); });
on(DX, () => json({ pairs: null }));
let t = await tokenPrices(56, [T1, T2, T3]);
ok("token: DefiLlama 1 permintaan untuk banyak alamat", hits(LL) === 1);
ok("token: kunci respons huruf campuran tetap dicocokkan (tak peka huruf besar/kecil)", t[T1]?.usd === 1.0002);
ok("token: confidence rendah (0.3) ditolak -> null, bukan harga 777", t[T2] === null);
ok("token: kunci hasil selalu huruf kecil, IDR dari kurs", t[T1]?.idr === 1.0002 * 16000 && Object.keys(t).every((k) => k === k.toLowerCase()));
const c0 = calls.length; await tokenPrices(56, [T1, T2, T3]);
ok("token: hasil termasuk 'tidak dikenal' di-cache (tak diulang ke jaringan)", calls.length === c0);

// DexScreener
reset(); fxOk(); on(LL, () => json({ coins: {} }));
on(DX, () => json({ pairs: [
  { chainId: "bsc", baseToken: { address: T1 }, priceUsd: "2.5", liquidity: { usd: 80_000 } },
  { chainId: "bsc", baseToken: { address: T1 }, priceUsd: "2.4", liquidity: { usd: 900_000 } },
  { chainId: "ethereum", baseToken: { address: T1 }, priceUsd: "999", liquidity: { usd: 9_000_000 } },
  { chainId: "bsc", baseToken: { address: T2 }, priceUsd: "50000", liquidity: { usd: 1_200 } },
  { chainId: "bsc", baseToken: { address: "0x" + "ee".repeat(20) }, priceUsd: "5", liquidity: { usd: 5_000_000 } },
] }));
t = await tokenPrices(56, [T1, T2]);
ok("token: DexScreener dipakai bila Llama tak punya; pasangan likuiditas tertinggi di jaringan yang benar", t[T1]?.usd === 2.4);
ok(`token: pasangan di jaringan lain (999) tidak dipakai`, t[T1]?.usd !== 999);
ok(`token: likuiditas < $${MIN_LIQUIDITY_USD} ditolak (token spam dengan harga palsu 50000 -> null)`, t[T2] === null);
ok("token: alamat bukan milik daftar diabaikan", !("0x" + "ee".repeat(20) in t));

// semua gagal
reset(); on(LL, () => json({}, 500)); on(DX, () => json({}, 500)); on(CGR, () => json({}, 429));
ok("token: semua sumber gagal & tidak ada data -> galat", await tokenPrices(56, [T1]).then(() => false, (e) => /sementara/.test(e.message)));

// hanya Llama gagal -> Dex, tapi tak dikenal TIDAK di-cache 30 menit (bisa dicoba lagi)
reset(); fxOk(); on(LL, () => json({}, 500)); on(DX, () => json({ pairs: [{ chainId: "bsc", baseToken: { address: T1 }, priceUsd: "3", liquidity: { usd: 100_000 } }] }));
t = await tokenPrices(56, [T1, T3]);
ok("token: Llama gagal -> DexScreener mengisi yang dikenal", t[T1]?.usd === 3);

// CoinGecko terakhir, satu per satu
reset(); on(LL, () => json({}, 500)); on(DX, () => json({}, 500)); on(CGR, (u) => json({ [u.searchParams.get("contract_addresses")!]: { usd: 7, idr: 112000 } }));
t = await tokenPrices(1, [T1, T2]);
ok("token: Llama & Dex gagal -> CoinGecko satu alamat per permintaan", hits(CGR) === 2 && t[T1]?.usd === 7 && t[T1]?.idr === 112000);

reset(); on(LL, () => json({ coins: {} })); on(DX, () => json({ pairs: [] }));
on(CGR, (u) => u.pathname.endsWith("/asset_platforms")
  ? json([{ id: "custom-evm", chain_identifier: "912345" }])
  : json({ [T1]: { usd: 8, idr: 128000 } }));
const customEvm = { chainId: 912345, name: "Custom EVM", symbol: "CST", testnet: false, custom: true, rpcUrls: [], explorer: "" };
t = await tokenPrices(customEvm.chainId, [T1], customEvm);
ok("token: custom chain menemukan platform CoinGecko dari chain ID", t[T1]?.usd === 8 && hits(CGR) === 2);

// pemotongan batch
reset(); fxOk(); const many = Array.from({ length: 85 }, (_, i) => "0x" + i.toString(16).padStart(40, "0"));
on(LL, () => json({ coins: {} })); on(DX, () => json({ pairs: [] }));
await tokenPrices(1, many);
ok("token: 85 alamat -> Llama 3 permintaan (40+40+5), Dex 3 permintaan (30+30+25)", hits(LL) === 3 && hits(DX) === 3);
ok("token: panjang URL aman (< 4000 karakter)", calls.every((c) => c.length < 4000));
const cBefore = calls.length;
ok("token: jaringan tak dikenal -> kosong tanpa permintaan", Object.keys(await tokenPrices(999999, [T1])).length === 0 && calls.length === cBefore);

// jeda per sumber
reset(); on(LL, () => json({}, 503)); on(DX, () => json({ pairs: null })); fxOk(); on(CGR, () => json({}, 400));
await tokenPrices(56, [T1]).catch(() => {}); const l1 = hits(LL);
await tokenPrices(56, [T2]).catch(() => {});
ok("jeda: setelah Llama gagal, permintaan berikutnya tidak menyentuh Llama selama 2 menit", l1 === 1 && hits(LL) === 1);

globalThis.fetch = realFetchPr;
}

laneTest().then(() => {
  console.log(`\n${pass} lolos, ${fail} gagal`);
  process.exit(fail === 0 ? 0 : 1);
});
