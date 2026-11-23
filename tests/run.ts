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
import { parseItem } from "../src/history/crypto";
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

laneTest().then(() => {
  console.log(`\n${pass} lolos, ${fail} gagal`);
  process.exit(fail === 0 ? 0 : 1);
});
