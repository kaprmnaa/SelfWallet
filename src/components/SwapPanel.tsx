import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatUnits } from "ethers";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { explorerTx, type ChainConfig } from "../lib/chains";
import type { Account } from "../lib/vault";
import { useSettings } from "../context/SettingsContext";
import { withProvider } from "../lib/rpc";
import { fetchTokenInfo, tokenBalance } from "../lib/tokens";
import { parseAmount } from "../lib/tx";
import { errMsg, shortAddr, timeAgo, trimAmount } from "../lib/format";
import { maxNativeForSwap } from "../chains/evm/call";
import { SLIPPAGE_OPTIONS, SWAP_CHAIN_IDS, swapPresets } from "../swap/registry";
import { executeSwap, fetchReview, nativeToken, runApproval, type Review, type ResolvedToken } from "../swap/orchestrator";
import { breakdown } from "../swap/fees/breakdown";
import { valueGapPct } from "../swap/quote/validate";
import { recoveryGuide } from "../swap/recovery/guide";
import { STATE_LABEL, TERMINAL_STATES, type SwapExecution, type SwapState } from "../swap/domain/types";
import { useSwaps } from "../swap/store";
import { useLockInfo } from "../goals/useLock";
import GoalLockNotice from "./GoalLockNotice";
import { Button, DetailRow, Field, Modal, Notice, StatusDot, inputCls } from "./ui";

type Props = { account: Account; chain: ChainConfig; onChanged: () => void };

const tokenCache = new Map<string, ResolvedToken>();

async function resolve(chain: ChainConfig, key: string, expectSymbol?: string): Promise<ResolvedToken> {
  if (key === "native") return nativeToken(chain);
  const k = `${chain.chainId}:${key.toLowerCase()}`;
  let t = tokenCache.get(k);
  if (!t) {
    const info = await fetchTokenInfo(chain, key); // validasi on-chain: contract ada dan ERC-20
    t = { address: info.address, symbol: info.symbol, decimals: info.decimals, native: false };
    tokenCache.set(k, t);
  }
  if (expectSymbol && t.symbol.toUpperCase() !== expectSymbol.toUpperCase()) {
    throw new Error(`Contract di alamat ini melapor simbol "${t.symbol}", bukan ${expectSymbol}. Dibatalkan demi keamanan.`);
  }
  return t;
}

async function balanceOf(chain: ChainConfig, t: ResolvedToken, owner: string): Promise<bigint> {
  if (t.native) return withProvider(chain, (p) => p.getBalance(owner));
  return tokenBalance(chain, { address: t.address, symbol: t.symbol, name: t.symbol, decimals: t.decimals }, owner);
}

const fmt = (v: bigint, dec: number, max = 6) => trimAmount(formatUnits(v, dec), max);
const tone = (s: SwapState): "ok" | "warn" | "bad" =>
  s === "completed" ? "ok" : s === "failed" || s === "recovery_required" ? "bad" : "warn";

export default function SwapPanel(props: Props) {
  const { chain } = props;
  if (chain.testnet) {
    return (
      <Notice>
        Swap hanya tersedia di mainnet. LI.FI tidak mendukung testnet (dokumentasi mereka menyarankan pengujian di mainnet
        dengan nominal kecil di jaringan berbiaya rendah, mis. Base atau Polygon). Pindah ke Mainnet untuk memakai swap.
      </Notice>
    );
  }
  if (!SWAP_CHAIN_IDS.includes(chain.chainId)) {
    return <Notice>Swap belum tersedia di {chain.name}. Jaringan yang didukung: Ethereum, BNB Smart Chain, Polygon, dan Base.</Notice>;
  }
  return <SwapForm {...props} />;
}

function SwapForm({ account, chain, onChanged }: Props) {
  const { chains, tokens, allTokens } = useSettings();
  const lock = useLockInfo(chain, account);
  const swapChains = chains.filter((c) => SWAP_CHAIN_IDS.includes(c.chainId));
  const owner = account.address;

  const [fromKey, setFromKey] = useState("native");
  const [toChainId, setToChainId] = useState(chain.chainId);
  const [toKey, setToKey] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(0.005);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<null | "quote" | "approve" | "swap">(null);
  const [review, setReview] = useState<Review | null>(null);
  const [approvals, setApprovals] = useState<string[]>([]);
  const [step, setStep] = useState("");
  const [modalErr, setModalErr] = useState("");
  const [now, setNow] = useState(Date.now());
  const [lastId, setLastId] = useState<string | null>(null);
  const guard = useRef(false);
  const swaps = useSwaps().filter((s) => s.owner === owner);

  const toChain = swapChains.find((c) => c.chainId === toChainId) ?? chain;
  const presets = swapPresets(toChainId);
  const savedTo = allTokens[String(toChainId)] ?? [];

  useEffect(() => {
    const usdc = swapPresets(toChainId).find((p) => p.symbol === "USDC");
    setToKey(usdc?.address ?? "native");
  }, [toChainId]);

  useEffect(() => {
    if (!review) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [review]);

  const expectSymbol = (key: string) => presets.find((p) => p.address === key)?.symbol;

  async function build(): Promise<Review> {
    const fromToken = await resolve(chain, fromKey);
    const addr = toKey === "custom" ? customTo.trim() : toKey;
    if (!addr) throw new Error("Pilih atau isi token tujuan.");
    const toToken = await resolve(toChain, addr, toKey === "custom" ? undefined : expectSymbol(toKey));
    if (toChain.chainId === chain.chainId && toToken.address.toLowerCase() === fromToken.address.toLowerCase()) {
      throw new Error("Token asal dan tujuan sama.");
    }
    const amt = parseAmount(amount, fromToken.decimals);
    if ((await balanceOf(chain, fromToken, owner)) < amt) throw new Error(`Saldo ${fromToken.symbol} tidak cukup.`);
    return fetchReview({ account, fromChain: chain, toChain, fromToken, toToken, amount: amt, slippage });
  }

  async function requestQuote(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setModalErr("");
    setApprovals([]);
    setBusy("quote");
    try {
      setReview(await build());
      setNow(Date.now());
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setModalErr("");
    setBusy("quote");
    try {
      setReview(await build());
      setNow(Date.now());
    } catch (ex) {
      setModalErr(errMsg(ex));
    } finally {
      setBusy(null);
    }
  }

  async function doApprove() {
    if (!review || guard.current) return;
    guard.current = true;
    setModalErr("");
    setBusy("approve");
    try {
      const hashes = await runApproval(review, setStep);
      setApprovals((a) => [...a, ...hashes]);
      setStep("Approval selesai. Mengambil quote baru…");
      const fresh = await build(); // quote lama kedaluwarsa: ambil ulang dan tinjau lagi
      setReview(fresh);
      setNow(Date.now());
      if (fresh.needsApproval) setModalErr("Allowance belum terbaca cukup. Coba lagi sebentar lagi.");
    } catch (ex) {
      setModalErr(errMsg(ex));
    } finally {
      guard.current = false;
      setStep("");
      setBusy(null);
    }
  }

  async function doSwap() {
    if (!review || guard.current) return;
    guard.current = true;
    setModalErr("");
    setBusy("swap");
    try {
      const exec = await executeSwap(review, approvals);
      setLastId(exec.id);
      setReview(null);
      setAmount("");
      setApprovals([]);
      onChanged();
    } catch (ex) {
      setModalErr(errMsg(ex));
    } finally {
      guard.current = false;
      setBusy(null);
    }
  }

  async function fillMax() {
    setErr("");
    try {
      const t = await resolve(chain, fromKey);
      const v = t.native ? await maxNativeForSwap(chain, owner) : await balanceOf(chain, t, owner);
      setAmount(formatUnits(v, t.decimals));
    } catch (ex) {
      setErr(errMsg(ex));
    }
  }

  const q = review?.quote;
  const left = q ? Math.max(0, Math.ceil((q.expiresAt - now) / 1000)) : 0;
  const expired = !!q && left === 0;
  const bd = q ? breakdown(q) : null;
  const gap = q ? valueGapPct(q) : null;
  const rate =
    review && q && q.fromAmount > 0n
      ? fmt((q.toAmount * 10n ** BigInt(review.input.fromToken.decimals)) / q.fromAmount, review.input.toToken.decimals, 6)
      : null;
  const lastExec = lastId ? swaps.find((s) => s.id === lastId) : undefined;

  return (
    <div className="grid gap-8">
      {lock.active && <GoalLockNotice info={lock} chain={chain} />}
      <form onSubmit={requestQuote} className="grid gap-5">
        <Field label={`Bayar (${chain.name})`}>
          <select value={fromKey} onChange={(e) => { setFromKey(e.target.value); setAmount(""); }} className={inputCls}>
            <option value="native">{chain.symbol} (koin native)</option>
            {tokens.map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol} · {t.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Jumlah" error={err}>
          <div className="flex gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.0"
              autoComplete="off"
              className={`${inputCls} font-mono`}
            />
            <Button type="button" variant="ghost" onClick={fillMax}>
              Maks
            </Button>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Jaringan tujuan">
            <select value={toChainId} onChange={(e) => setToChainId(Number(e.target.value))} className={inputCls}>
              {swapChains.map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Token tujuan">
            <select value={toKey} onChange={(e) => setToKey(e.target.value)} className={inputCls}>
              <option value="native">{toChain.symbol} (native)</option>
              {presets.map((p) => (
                <option key={p.address} value={p.address}>
                  {p.symbol}
                </option>
              ))}
              {savedTo.map((t) => (
                <option key={t.address} value={t.address}>
                  {t.symbol} · {t.name}
                </option>
              ))}
              <option value="custom">Alamat kustom…</option>
            </select>
          </Field>
        </div>
        {toKey === "custom" && (
          <Field label="Alamat contract token tujuan" hint="Dicek on-chain di jaringan tujuan sebelum quote diminta.">
            <input
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
          </Field>
        )}

        <div className="grid gap-2">
          <span className="text-xs font-medium tracking-wide text-zinc-400">Slippage maksimum</span>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Slippage maksimum">
            {SLIPPAGE_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={slippage === s}
                onClick={() => setSlippage(s)}
                className={`rounded-xl border px-3 py-2.5 text-sm transition-colors duration-300 ${
                  slippage === s ? "border-accent/50 bg-white/[0.04] text-zinc-100" : "border-white/10 text-zinc-400 hover:bg-white/[0.03]"
                }`}
              >
                {(s * 100).toFixed(1).replace(/\.0$/, "")}%
              </button>
            ))}
          </div>
        </div>

        <Button type="submit" disabled={!amount || (toKey === "custom" && !customTo.trim()) || lock.blocked} busy={busy === "quote" && !review}>
          {busy === "quote" && !review ? "Mencari rute terbaik…" : "Dapatkan quote"}
        </Button>
        <p className="text-xs leading-relaxed text-zinc-600">
          Gas normal: Anda membayar gas dengan {chain.symbol}. Sponsorship/gasless belum tersedia. Rute disediakan LI.FI;
          transaksi tetap ditandatangani lokal di browser ini.
        </p>
      </form>

      {lastExec && (
        <Notice tone="info">
          Swap dikirim. Pantau statusnya di bawah. Transaksi sumber terkonfirmasi belum berarti swap lintas chain selesai.
        </Notice>
      )}

      <section>
        <h3 className="text-sm font-medium text-zinc-300">Aktivitas swap</h3>
        {swaps.length === 0 ? (
          <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-zinc-500">
            Belum ada swap dari dompet ini. Status tersimpan di browser dan tetap dipantau setelah halaman dimuat ulang.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.06] border-y border-white/[0.06]">
            {swaps.slice(0, 8).map((s) => (
              <SwapRow key={s.id} s={s} chains={chains} />
            ))}
          </ul>
        )}
      </section>

      <Modal open={!!review} onClose={() => setReview(null)} title="Tinjau swap" dismissible={busy === null}>
        {review && q && bd && (
          <div className="grid gap-4">
            <dl className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
              <DetailRow k="Bayar">
                <span className="font-mono">
                  {fmt(q.fromAmount, review.input.fromToken.decimals, 8)} {review.input.fromToken.symbol}
                </span>
                <span className="block text-xs text-zinc-500">
                  {chain.name} · {review.input.fromToken.native ? "native" : `token ${shortAddr(review.input.fromToken.address)}`}
                </span>
              </DetailRow>
              <DetailRow k="Terima (perkiraan)">
                <span className="font-mono">
                  ≈ {fmt(q.toAmount, review.input.toToken.decimals, 8)} {review.input.toToken.symbol}
                </span>
                <span className="block text-xs text-zinc-500">
                  {toChain.name} · {review.input.toToken.native ? "native" : `token ${shortAddr(review.input.toToken.address)}`}
                </span>
              </DetailRow>
              <DetailRow k="Minimum diterima">
                <span className="font-mono">
                  {fmt(q.toAmountMin, review.input.toToken.decimals, 8)} {review.input.toToken.symbol}
                </span>
                <span className="block text-xs text-zinc-500">Slippage maksimum {(q.slippage * 100).toFixed(1)}%</span>
              </DetailRow>
              {rate && (
                <DetailRow k="Kurs">
                  <span className="font-mono text-xs">
                    1 {review.input.fromToken.symbol} ≈ {rate} {review.input.toToken.symbol}
                  </span>
                  {gap !== null && <span className="block text-xs text-zinc-500">Selisih nilai (perkiraan): {gap.toFixed(2)}%</span>}
                </DetailRow>
              )}
              <DetailRow k="Gas jaringan asal">
                {bd.gas.length === 0 ? (
                  <span className="text-zinc-400">Tidak dirinci penyedia; dihitung saat menandatangani</span>
                ) : (
                  bd.gas.map((g, i) => (
                    <span key={i} className="block font-mono text-xs">
                      {fmt(g.amount, g.decimals, 8)} {g.symbol}
                      {g.usd !== null ? ` (~$${g.usd.toFixed(2)})` : ""}
                    </span>
                  ))
                )}
                {bd.nativeExtra > 0n && (
                  <span className="block text-xs text-zinc-500">
                    + {fmt(bd.nativeExtra, 18, 8)} {chain.symbol} dikirim ke protokol sebagai biaya lintas chain
                  </span>
                )}
              </DetailRow>
              <DetailRow k="Biaya provider">
                {bd.provider.length === 0 ? (
                  <span className="text-zinc-400">Tidak dirinci penyedia</span>
                ) : (
                  bd.provider.map((f, i) => (
                    <span key={i} className="block text-xs">
                      <span className="text-zinc-300">{f.label}</span>{" "}
                      <span className="font-mono text-zinc-400">
                        {fmt(f.amount, f.decimals, 8)} {f.symbol}
                        {f.usd !== null ? ` (~$${f.usd.toFixed(2)})` : ""}
                      </span>
                      {f.included && <span className="text-zinc-600"> · sudah termasuk di output</span>}
                    </span>
                  ))
                )}
              </DetailRow>
              <DetailRow k="Rute">
                {q.toolName}
                {q.executionSeconds != null && <span className="block text-xs text-zinc-500">Estimasi ±{q.executionSeconds} detik</span>}
              </DetailRow>
              <DetailRow k="Approval">
                {review.input.fromToken.native ? (
                  <span className="text-zinc-400">Tidak diperlukan</span>
                ) : review.needsApproval ? (
                  <>
                    Perlu approval sejumlah persis {fmt(q.fromAmount, review.input.fromToken.decimals, 8)} {review.input.fromToken.symbol}
                    <span className="block break-all font-mono text-xs text-zinc-500">ke {q.approvalAddress}</span>
                  </>
                ) : (
                  <span className="text-zinc-400">Allowance sudah cukup</span>
                )}
              </DetailRow>
              <DetailRow k="Kontrak tujuan">
                <span className="break-all font-mono text-xs">{q.tx.to}</span>
                <span className="block text-xs text-zinc-500">Ada di daftar kontrak yang diizinkan</span>
              </DetailRow>
              <DetailRow k="Berlaku">
                {expired ? <span className="text-rose-400">Kedaluwarsa</span> : <span className="font-mono">{left} detik</span>}
              </DetailRow>
            </dl>

            {review.warnings.map((w) => (
              <Notice key={w}>{w}</Notice>
            ))}
            {review.input.fromChain.chainId !== review.input.toChain.chainId && (
              <Notice tone="info">
                Swap lintas chain: transaksi sumber terkonfirmasi belum berarti selesai. Status tujuan dipantau otomatis.
                Refund tidak dijamin otomatis.
              </Notice>
            )}
            {step && <p className="text-xs text-zinc-400">{step}</p>}
            {modalErr && (
              <p role="alert" className="text-xs text-rose-400">
                {modalErr}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Button variant="ghost" onClick={() => setReview(null)} disabled={busy !== null}>
                Batal
              </Button>
              {expired ? (
                <Button onClick={refresh} busy={busy === "quote"}>
                  {busy === "quote" ? "Memperbarui…" : "Perbarui quote"}
                </Button>
              ) : review.needsApproval ? (
                <Button onClick={doApprove} busy={busy === "approve"}>
                  {busy === "approve" ? "Memproses approval…" : `Setujui ${review.input.fromToken.symbol}`}
                </Button>
              ) : (
                <Button onClick={doSwap} busy={busy === "swap"}>
                  {busy === "swap" ? "Mengirim…" : "Tanda tangani & swap"}
                </Button>
              )}
            </div>
            <p className="text-center text-xs text-zinc-600">
              Calldata dari penyedia divalidasi sebagian (kontrak tujuan, jumlah, penerima, chain). Itu mengurangi, bukan
              menghilangkan, risikonya. Mulai dengan nominal kecil.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function SwapRow({ s, chains }: { s: SwapExecution; chains: ChainConfig[] }) {
  const src = chains.find((c) => c.chainId === s.from.chainId);
  const dst = chains.find((c) => c.chainId === s.to.chainId);
  const guide = recoveryGuide(s);
  const srcLink = src ? explorerTx(src, s.srcHash) : null;
  const dstLink = dst && s.dstHash ? explorerTx(dst, s.dstHash) : null;
  const active = !TERMINAL_STATES.includes(s.state);

  return (
    <li className="grid gap-2 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-zinc-100">
            <span className="font-mono">
              {fmt(BigInt(s.from.amount), s.from.decimals)} {s.from.symbol}
            </span>{" "}
            <span className="text-zinc-500">→</span>{" "}
            <span className="font-mono">
              {s.received
                ? `${fmt(BigInt(s.received), s.to.decimals)} ${s.receivedSymbol ?? s.to.symbol}`
                : `≈ ${fmt(BigInt(s.to.expected), s.to.decimals)} ${s.to.symbol}`}
            </span>
          </p>
          <p className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
            <StatusDot tone={tone(s.state)} still={!active} />
            {STATE_LABEL[s.state]} · {src?.name} → {dst?.name} · {s.tool} · {timeAgo(s.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 gap-3 text-xs">
          {srcLink && (
            <a href={srcLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              Sumber <ArrowSquareOut />
            </a>
          )}
          {dstLink && (
            <a href={dstLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              Tujuan <ArrowSquareOut />
            </a>
          )}
        </div>
      </div>
      {s.message && <p className="text-xs text-zinc-500">{s.message}</p>}
      {guide && <Notice tone={s.state === "bridging" ? "info" : "warn"}>{guide}</Notice>}
      <details className="text-xs text-zinc-500">
        <summary className="cursor-pointer select-none hover:text-zinc-300">Linimasa</summary>
        <ul className="mt-2 grid gap-1">
          {s.history.map((h, i) => (
            <li key={i}>
              {new Date(h.ts).toLocaleTimeString("id-ID")} · {STATE_LABEL[h.state]}
              {h.note ? ` — ${h.note}` : ""}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}
