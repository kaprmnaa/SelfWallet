import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { explorerTx, type ChainConfig } from "../lib/chains";
import type { Account } from "../lib/vault";
import { useSettings } from "../context/SettingsContext";
import { feeQuote, TIER_LABEL, type FeeQuote, type FeeTier } from "../chains/bitcoin/fees";
import { btcAmount, prepareBtc, signAndSendBtc, type BtcPrepared } from "../chains/bitcoin/transaction";
import { errMsg, trimAmount } from "../lib/format";
import { useLockInfo } from "../goals/useLock";
import GoalLockNotice from "./GoalLockNotice";
import { useRecipient } from "../contacts/useRecipient";
import RecipientField from "./RecipientField";
import { requireTxAuth, useTxSettings, walletIdOf } from "../txauth/store";
import SendModeBar from "./SendModeBar";
import { Button, DetailRow, Field, Modal, Notice, StatusDot, inputCls } from "./ui";

const STALE_MS = 90_000;
const TIERS: FeeTier[] = ["fast", "normal", "slow"];

export default function BtcSendPanel({
  account,
  chain,
  owner,
  onSent,
}: {
  account: Account;
  chain: ChainConfig;
  owner: string;
  onSent: () => void;
}) {
  const { history, addHistory } = useSettings();
  const lock = useLockInfo(chain, account);
  const [to, setTo] = useState("");
  const rcp = useRecipient("btc", to);
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [tier, setTier] = useState<FeeTier>("normal");
  const [quote, setQuote] = useState<FeeQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState("");
  const [err, setErr] = useState("");
  const [preparing, setPreparing] = useState(false);
  const ts = useTxSettings(walletIdOf(account));
  const fast = ts.mode === "fast";
  const [prepared, setPrepared] = useState<BtcPrepared | null>(null);
  const rc = useRecipient("btc", prepared?.to ?? "");
  const [sending, setSending] = useState(false);
  const [modalErr, setModalErr] = useState("");
  const [lastTx, setLastTx] = useState<string | null>(null);
  const guard = useRef(false);

  useEffect(() => {
    let alive = true;
    feeQuote(chain)
      .then((q) => alive && setQuote(q))
      .catch((e) => alive && setQuoteErr(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [chain]);

  const last = lastTx ? history.find((h) => h.hash === lastTx) : undefined;
  const link = lastTx ? explorerTx(chain, lastTx) : null;

  async function review(e: FormEvent) {
    e.preventDefault();
    if (guard.current) return;
    setErr("");
    setModalErr("");
    guard.current = true;
    try {
      // Mode cepat + Face ID: konfirmasi DULU (harus dalam gestur sentuhan), lalu siapkan dan kirim.
      if (fast && ts.auth) await requireTxAuth(account, { kind: "btc", chainId: chain.chainId, to });
      setPreparing(true);
      const p = await prepareBtc(chain, account, { to, amount, max, tier });
      // Cepat hanya jika fee wajar (<= 10% dari jumlah); selain itu tampilkan modal tinjau.
      const pct = p.amount > 0n ? Number((p.fee * 10000n) / p.amount) / 100 : 0;
      if (fast && pct <= 10) await send(p);
      else setPrepared(p);
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      guard.current = false;
      setPreparing(false);
    }
  }

  async function send(p: BtcPrepared) {
    const txid = await signAndSendBtc(account, p);
    addHistory({
      hash: txid,
      chainId: chain.chainId,
      from: owner,
      to: p.to,
      amount: btcAmount(p.amount),
      symbol: chain.symbol,
      ts: Date.now(),
      status: "pending",
    });
    setLastTx(txid);
    setPrepared(null);
    setTo("");
    setAmount("");
    setMax(false);
    onSent();
  }

  async function confirm() {
    if (!prepared || guard.current) return;
    if (Date.now() - prepared.createdAt > STALE_MS) {
      setModalErr("Data UTXO dan fee sudah kedaluwarsa. Tutup, lalu tinjau ulang.");
      return;
    }
    guard.current = true;
    setSending(true);
    setModalErr("");
    try {
      await requireTxAuth(account, { kind: "btc", chainId: chain.chainId, to: prepared.to });
      if (Date.now() - prepared.createdAt > STALE_MS) throw new Error("Data UTXO dan fee sudah kedaluwarsa. Tutup, lalu tinjau ulang.");
      await send(prepared);
    } catch (ex) {
      setModalErr(errMsg(ex));
    } finally {
      guard.current = false;
      setSending(false);
    }
  }

  const feePct = prepared && prepared.amount > 0n ? Number((prepared.fee * 10000n) / prepared.amount) / 100 : 0;

  return (
    <div className="grid gap-6">
      {lock.active && <GoalLockNotice info={lock} chain={chain} />}
      <SendModeBar account={account} />
      <form onSubmit={review} className="grid gap-5">
        <RecipientField
          kind="btc"
          value={to}
          onChange={setTo}
          placeholder={chain.testnet ? "tb1q…" : "bc1q…"}
          hint={`Format ${chain.testnet ? "tb1…" : "bc1…, 1…, atau 3…"} sesuai jaringan.`}
        />
        <Field label={`Jumlah (${chain.symbol})`} error={err}>
          <div className="flex gap-2">
            <input
              value={max ? "" : amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={max}
              inputMode="decimal"
              placeholder={max ? "Semua saldo terkonfirmasi, dikurangi fee" : "0.0"}
              autoComplete="off"
              className={`${inputCls} font-mono`}
            />
            <Button type="button" variant={max ? "primary" : "ghost"} onClick={() => setMax((m) => !m)}>
              Maks
            </Button>
          </div>
        </Field>

        <div className="grid gap-2">
          <span className="text-xs font-medium tracking-wide text-zinc-400">Kecepatan konfirmasi</span>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Kecepatan konfirmasi">
            {TIERS.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tier === t}
                disabled={!quote}
                onClick={() => setTier(t)}
                className={`grid gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors duration-300 disabled:opacity-40 ${
                  tier === t ? "border-accent/50 bg-white/[0.04]" : "border-white/10 hover:bg-white/[0.03]"
                }`}
              >
                <span className="text-sm text-zinc-100">{TIER_LABEL[t]}</span>
                <span className="font-mono text-xs text-zinc-500">{quote ? `${quote[t]} sat/vB` : "…"}</span>
              </button>
            ))}
          </div>
          {quoteErr && (
            <span role="alert" className="text-xs text-rose-400">
              {quoteErr}
            </span>
          )}
        </div>

        <Button type="submit" disabled={!to || (!max && !amount) || !quote || lock.blocked || rcp.blocked} busy={preparing}>
          {preparing ? (fast ? "Mengirim…" : "Memindai UTXO…") : fast ? "Kirim" : "Tinjau transaksi"}
        </Button>
      </form>

      {last && lastTx && (
        <div className="flex items-center justify-between gap-4 border-t border-white/[0.06] pt-5 text-sm">
          <div className="flex min-w-0 items-center gap-3">
            <StatusDot tone={last.status === "pending" ? "warn" : last.status === "success" ? "ok" : "bad"} />
            <div className="min-w-0">
              <p className="text-zinc-200">
                {last.status === "pending" ? "Menunggu konfirmasi blok" : "Transaksi terkonfirmasi"}
              </p>
              <p className="truncate font-mono text-xs text-zinc-500">{lastTx}</p>
            </div>
          </div>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center gap-1.5 text-xs text-accent hover:underline">
              Explorer <ArrowSquareOut />
            </a>
          )}
        </div>
      )}

      <Modal open={!!prepared} onClose={() => setPrepared(null)} title="Tinjau sebelum menandatangani" dismissible={!sending}>
        {prepared && (
          <div className="grid gap-4">
            <dl className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
              <DetailRow k="Jaringan">{chain.name}</DetailRow>
              <DetailRow k="Ke">
                {rc.contact && <span className="mb-1 block text-zinc-100">{rc.contact.name}</span>}
                <span className="break-all font-mono text-xs">{prepared.to}</span>
              </DetailRow>
              <DetailRow k="Jumlah">
                <span className="font-mono">
                  {btcAmount(prepared.amount)} {chain.symbol}
                </span>
              </DetailRow>
              <DetailRow k="Fee">
                <span className="font-mono">
                  {btcAmount(prepared.fee)} {chain.symbol}
                </span>
                <span className="block text-xs text-zinc-500">
                  {prepared.fee.toString()} sat · {prepared.feeRate} sat/vB · ±{prepared.vsize} vB
                </span>
              </DetailRow>
              <DetailRow k="Kembalian">
                {prepared.change > 0n ? (
                  <>
                    <span className="font-mono">
                      {btcAmount(prepared.change)} {chain.symbol}
                    </span>
                    <span className="block break-all font-mono text-xs text-zinc-500">ke {prepared.changeAddress}</span>
                  </>
                ) : (
                  <span className="text-zinc-400">Tanpa kembalian (sisa kecil dilebur ke fee)</span>
                )}
              </DetailRow>
              <DetailRow k="Input">{prepared.inputs.length} UTXO terkonfirmasi</DetailRow>
              <DetailRow k="Total keluar">
                <span className="font-mono">
                  {trimAmount(btcAmount(prepared.amount + prepared.fee), 8)} {chain.symbol}
                </span>
              </DetailRow>
            </dl>

            {!chain.testnet && <Notice>Mainnet: transaksi Bitcoin tidak bisa dibatalkan setelah dikonfirmasi.</Notice>}
            {feePct > 10 && <Notice>Fee setara {feePct.toFixed(1)}% dari jumlah kirim. Periksa lagi sebelum melanjutkan.</Notice>}
            {prepared.unconfirmed > 0n && (
              <Notice tone="info">
                {btcAmount(prepared.unconfirmed)} {chain.symbol} yang belum terkonfirmasi tidak ikut dipakai.
              </Notice>
            )}
            {modalErr && (
              <p role="alert" className="text-xs text-rose-400">
                {modalErr}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="ghost" onClick={() => setPrepared(null)} disabled={sending}>
                Batal
              </Button>
              <Button onClick={confirm} busy={sending}>
                {sending ? "Mengirim…" : "Tanda tangani & kirim"}
              </Button>
            </div>
            <p className="text-center text-xs text-zinc-600">
              Ditandatangani lokal di browser. Hanya transaksi bertanda tangan yang dikirim ke penyedia data.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
