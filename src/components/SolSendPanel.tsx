import { useRef, useState, type FormEvent } from "react";
import { formatUnits } from "ethers";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { explorerTx, type ChainConfig } from "../lib/chains";
import type { Account } from "../lib/vault";
import { useSettings } from "../context/SettingsContext";
import { prepareSol, signAndSendSol, type SolPrepared } from "../chains/solana/transfer";
import { errMsg } from "../lib/format";
import { useLockInfo } from "../goals/useLock";
import GoalLockNotice from "./GoalLockNotice";
import { useRecipient } from "../contacts/useRecipient";
import RecipientField from "./RecipientField";
import { requireTxAuth, useTxSettings, walletIdOf } from "../txauth/store";
import SendModeBar from "./SendModeBar";
import { Button, DetailRow, Field, Modal, Notice, StatusDot, inputCls } from "./ui";

const STALE_MS = 45_000; // blockhash Solana kedaluwarsa dalam kurang dari ~90 detik

export default function SolSendPanel({
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
  const rcp = useRecipient("sol", to, owner);
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [err, setErr] = useState("");
  const [preparing, setPreparing] = useState(false);
  const ts = useTxSettings(walletIdOf(account));
  const fast = ts.mode === "fast";
  const [prepared, setPrepared] = useState<SolPrepared | null>(null);
  const rc = useRecipient("sol", prepared?.to ?? "", owner);
  const [sending, setSending] = useState(false);
  const [modalErr, setModalErr] = useState("");
  const [lastTx, setLastTx] = useState<string | null>(null);
  const guard = useRef(false);

  const last = lastTx ? history.find((h) => h.hash === lastTx) : undefined;
  const link = lastTx ? explorerTx(chain, lastTx) : null;
  const fmt = (v: bigint) => formatUnits(v, 9);

  async function review(e: FormEvent) {
    e.preventDefault();
    if (guard.current) return;
    setErr("");
    setModalErr("");
    guard.current = true;
    try {
      // Mode cepat + Face ID: konfirmasi DULU (harus dalam gestur sentuhan), lalu siapkan dan kirim.
      if (fast && ts.auth) await requireTxAuth(account, { kind: "sol", chainId: chain.chainId, to });
      setPreparing(true);
      const p = await prepareSol(chain, account, { to, amount, max });
      // Cepat hanya jika tidak ada peringatan (sisa saldo di bawah rent); selain itu tampilkan modal tinjau.
      if (fast && !(p.remaining > 0n && p.remaining < p.minRent)) await send(p);
      else setPrepared(p);
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      guard.current = false;
      setPreparing(false);
    }
  }

  async function send(p: SolPrepared) {
    const sig = await signAndSendSol(account, p);
    addHistory({
      hash: sig,
      chainId: chain.chainId,
      from: owner,
      to: p.to,
      amount: fmt(p.lamports),
      symbol: chain.symbol,
      ts: Date.now(),
      status: "pending",
    });
    setLastTx(sig);
    setPrepared(null);
    setTo("");
    setAmount("");
    setMax(false);
    onSent();
  }

  async function confirm() {
    if (!prepared || guard.current) return;
    if (Date.now() - prepared.createdAt > STALE_MS) {
      setModalErr("Blockhash sudah kedaluwarsa. Tutup, lalu tinjau ulang.");
      return;
    }
    guard.current = true;
    setSending(true);
    setModalErr("");
    try {
      await requireTxAuth(account, { kind: "sol", chainId: chain.chainId, to: prepared.to });
      if (Date.now() - prepared.createdAt > STALE_MS) throw new Error("Blockhash sudah kedaluwarsa. Tutup, lalu tinjau ulang.");
      await send(prepared);
    } catch (ex) {
      setModalErr(errMsg(ex));
    } finally {
      guard.current = false;
      setSending(false);
    }
  }

  return (
    <div className="grid gap-6">
      {lock.active && <GoalLockNotice info={lock} chain={chain} />}
      <SendModeBar account={account} />
      <form onSubmit={review} className="grid gap-5">
        <RecipientField kind="sol" value={to} onChange={setTo} placeholder="Alamat Solana…" hint="Alamat Solana (Base58, 32 byte)." self={owner} />
        <Field label={`Jumlah (${chain.symbol})`} error={err}>
          <div className="flex gap-2">
            <input
              value={max ? "" : amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={max}
              inputMode="decimal"
              placeholder={max ? "Semua saldo, dikurangi fee" : "0.0"}
              autoComplete="off"
              className={`${inputCls} font-mono`}
            />
            <Button type="button" variant={max ? "primary" : "ghost"} onClick={() => setMax((m) => !m)}>
              Maks
            </Button>
          </div>
        </Field>
        <Button type="submit" disabled={!to || (!max && !amount) || lock.blocked || rcp.blocked} busy={preparing}>
          {preparing ? (fast ? "Mengirim…" : "Menyiapkan transaksi…") : fast ? "Kirim" : "Tinjau transaksi"}
        </Button>
      </form>

      {last && lastTx && (
        <div className="flex items-center justify-between gap-4 border-t border-white/[0.06] pt-5 text-sm">
          <div className="flex min-w-0 items-center gap-3">
            <StatusDot tone={last.status === "pending" ? "warn" : last.status === "success" ? "ok" : "bad"} />
            <div className="min-w-0">
              <p className="text-zinc-200">
                {last.status === "pending" ? "Menunggu konfirmasi" : last.status === "success" ? "Transaksi terkonfirmasi" : "Transaksi gagal di chain"}
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
              <DetailRow k="Dari">
                <span className="break-all font-mono text-xs">{prepared.from}</span>
              </DetailRow>
              <DetailRow k="Ke">
                {rc.contact && <span className="mb-1 block text-zinc-100">{rc.contact.name}</span>}
                <span className="break-all font-mono text-xs">{prepared.to}</span>
              </DetailRow>
              <DetailRow k="Jumlah">
                <span className="font-mono">
                  {fmt(prepared.lamports)} {chain.symbol}
                </span>
              </DetailRow>
              <DetailRow k="Fee">
                <span className="font-mono">
                  {fmt(prepared.fee)} {chain.symbol}
                </span>
                <span className="block text-xs text-zinc-500">{prepared.fee.toString()} lamports</span>
              </DetailRow>
              <DetailRow k="Sisa saldo">
                <span className="font-mono">
                  {fmt(prepared.remaining)} {chain.symbol}
                </span>
              </DetailRow>
            </dl>
            {!chain.testnet && <Notice>Mainnet: transaksi Solana tidak bisa dibatalkan setelah dikonfirmasi.</Notice>}
            {prepared.remaining > 0n && prepared.remaining < prepared.minRent && (
              <Notice>
                Sisa saldo di bawah batas rent-exempt ({fmt(prepared.minRent)} {chain.symbol}). Jaringan bisa menolak
                transaksi ini. Kirim lebih sedikit, atau pakai Maks untuk mengosongkan akun.
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
              Ditandatangani lokal (Ed25519) di browser. RPC hanya menerima transaksi bertanda tangan.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
