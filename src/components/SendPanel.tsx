import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { formatEther, formatUnits } from "ethers";
import { ArrowSquareOut } from "@phosphor-icons/react";
import type { ChainConfig } from "../lib/chains";
import type { Account } from "../lib/vault";
import { useSettings } from "../context/SettingsContext";
import { feeWei, maxNativeSend, prepare, signAndSend, type Prepared } from "../lib/tx";
import { tokenBalance } from "../lib/tokens";
import { errMsg, shortAddr, trimAmount } from "../lib/format";
import { Button, Field, Modal, Notice, StatusDot, inputCls } from "./ui";

const STALE_MS = 90_000;

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-3 text-sm">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="min-w-0 break-words text-zinc-100">{children}</dd>
    </div>
  );
}

export default function SendPanel({
  account,
  chain,
  address,
  onSent,
}: {
  account: Account;
  chain: ChainConfig;
  address: string;
  onSent: () => void;
}) {
  const { tokens, history, addHistory } = useSettings();
  const [asset, setAsset] = useState("native");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [sending, setSending] = useState(false);
  const [modalErr, setModalErr] = useState("");
  const [lastHash, setLastHash] = useState<string | null>(null);
  const guard = useRef(false); // proteksi double-submit

  const token = tokens.find((t) => t.address === asset);
  const symbol = token?.symbol ?? chain.symbol;
  const last = lastHash ? history.find((h) => h.hash === lastHash) : undefined;

  async function fillMax() {
    setErr("");
    try {
      if (token) setAmount(formatUnits(await tokenBalance(chain, token, address), token.decimals));
      else setAmount(await maxNativeSend(chain, address));
    } catch (ex) {
      setErr(errMsg(ex));
    }
  }

  async function review(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setPreparing(true);
    try {
      setModalErr("");
      setPrepared(await prepare({ chain, from: address, to, amount, token }));
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setPreparing(false);
    }
  }

  async function confirm() {
    if (!prepared || guard.current) return;
    if (Date.now() - prepared.createdAt > STALE_MS) {
      setModalErr("Estimasi biaya sudah kedaluwarsa. Tutup, lalu tinjau ulang.");
      return;
    }
    guard.current = true;
    setSending(true);
    setModalErr("");
    try {
      const hash = await signAndSend(account, prepared);
      addHistory({
        hash,
        chainId: chain.chainId,
        from: address,
        to: prepared.recipient,
        amount: prepared.draft.amount,
        symbol,
        ts: Date.now(),
        status: "pending",
      });
      setLastHash(hash);
      setPrepared(null);
      setTo("");
      setAmount("");
      onSent();
    } catch (ex) {
      setModalErr(errMsg(ex));
    } finally {
      guard.current = false;
      setSending(false);
    }
  }

  return (
    <div className="grid gap-6">
      <form onSubmit={review} className="grid gap-5">
        <Field label="Aset">
          <select value={asset} onChange={(e) => { setAsset(e.target.value); setAmount(""); }} className={inputCls}>
            <option value="native">{chain.symbol} (koin native)</option>
            {tokens.map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol} · {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Alamat penerima" hint="Alamat huruf campuran divalidasi checksum-nya.">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            className={`${inputCls} font-mono`}
          />
        </Field>
        <Field label={`Jumlah (${symbol})`} error={err}>
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
        <Button type="submit" disabled={!to || !amount} busy={preparing}>
          {preparing ? "Menghitung biaya…" : "Tinjau transaksi"}
        </Button>
      </form>

      {last && lastHash && (
        <div className="flex items-center justify-between gap-4 border-t border-white/[0.06] pt-5 text-sm">
          <div className="flex min-w-0 items-center gap-3">
            <StatusDot tone={last.status === "pending" ? "warn" : last.status === "success" ? "ok" : "bad"} />
            <div className="min-w-0">
              <p className="text-zinc-200">
                {last.status === "pending" ? "Menunggu konfirmasi blok" : last.status === "success" ? "Transaksi terkonfirmasi" : "Transaksi gagal di chain"}
              </p>
              <p className="truncate font-mono text-xs text-zinc-500">{lastHash}</p>
            </div>
          </div>
          {chain.explorer && (
<a
            href={`${chain.explorer}/tx/${lastHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1.5 text-xs text-accent hover:underline"
          >
            Explorer <ArrowSquareOut />
          </a>
)}
        </div>
      )}

      <Modal open={!!prepared} onClose={() => setPrepared(null)} title="Tinjau sebelum menandatangani" dismissible={!sending}>
        {prepared && (
          <div className="grid gap-4">
            <dl className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
              <Row k="Jaringan">
                {chain.name} <span className="font-mono text-xs text-zinc-500">(chain {chain.chainId})</span>
              </Row>
              <Row k="Dari">
                <span className="font-mono text-xs">{address}</span>
              </Row>
              <Row k="Ke">
                <span className="break-all font-mono text-xs">{prepared.recipient}</span>
              </Row>
              <Row k="Jumlah">
                <span className="font-mono">
                  {prepared.draft.amount} {symbol}
                </span>
              </Row>
              <Row k="Estimasi biaya">
                <span className="font-mono">
                  {trimAmount(formatEther(feeWei(prepared)), 8)} {chain.symbol}
                </span>
                <span className="block text-xs text-zinc-500">batas atas · gas {prepared.gasLimit.toString()} · nonce {prepared.nonce}</span>
              </Row>
              {token && (
                <Row k="Contract token">
                  <span className="break-all font-mono text-xs">{token.address}</span>
                </Row>
              )}
            </dl>

            {!chain.testnet && <Notice>Mainnet: transaksi ini memakai dana sungguhan dan tidak bisa dibatalkan.</Notice>}
            {prepared.toSelf && <Notice>Penerima adalah alamat Anda sendiri.</Notice>}
            {prepared.recipientIsContract && !token && (
              <Notice>Penerima adalah smart contract. Pastikan contract itu memang bisa menerima koin native.</Notice>
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
              Ditandatangani lokal di browser. Hanya transaksi bertanda tangan yang dikirim ke RPC.
              {` Penerima ${shortAddr(prepared.recipient)}.`}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
