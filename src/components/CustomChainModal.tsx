import { useState, type FormEvent } from "react";
import { Trash } from "@phosphor-icons/react";
import { useSettings } from "../context/SettingsContext";
import { buildCustomChain, parseRpcUrl } from "../lib/customChains";
import { probeRpc } from "../lib/rpc";
import { errMsg } from "../lib/format";
import CoinIcon from "./CoinIcon";
import { Button, Field, Modal, Notice, inputCls } from "./ui";

export default function CustomChainModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { chains, addCustomChain, removeCustomChain } = useSettings();
  const customs = chains.filter((c) => c.custom);

  const [rpc, setRpc] = useState("");
  const [chainId, setChainId] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [explorer, setExplorer] = useState("");
  const [testnet, setTestnet] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);

  function reset() {
    setRpc("");
    setChainId("");
    setName("");
    setSymbol("");
    setExplorer("");
    setTestnet(true);
    setErr("");
  }

  async function detect() {
    setErr("");
    setDetecting(true);
    try {
      setChainId(String(await probeRpc(parseRpcUrl(rpc))));
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setDetecting(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const c = buildCustomChain({ name, symbol, rpc, chainId, explorer, testnet }, chains);
      const detected = await probeRpc(c.rpcUrls[0]);
      if (detected !== c.chainId) {
        throw new Error(`RPC ini melaporkan chain ID ${detected}, bukan ${c.chainId}. Penambahan dibatalkan.`);
      }
      addCustomChain(c);
      reset();
      onClose();
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Jaringan kustom" dismissible={!busy}>
      <div className="grid gap-6">
        {customs.length > 0 && (
          <ul className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
            {customs.map((c) => (
              <li key={c.chainId} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <CoinIcon symbol={c.symbol} size={28} />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-100">{c.name}</p>
                    <p className="font-mono text-xs text-zinc-600">
                      chain {c.chainId} · {c.testnet ? "testnet" : "mainnet"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Hapus ${c.name}`}
                  onClick={() => removeCustomChain(c.chainId)}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-600 transition-colors duration-300 hover:bg-white/5 hover:text-rose-300"
                >
                  <Trash />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Notice>
          Server RPC melihat alamat dan IP Anda, dan bisa memberi data palsu (saldo, biaya gas). Ia tidak bisa
          mengambil kunci Anda. Tambahkan hanya RPC yang Anda percaya, dan bandingkan chain ID dengan sumber resmi
          jaringan itu. URL RPC disimpan apa adanya di browser ini, jadi hindari yang memuat API key rahasia.
        </Notice>

        <form onSubmit={submit} className="grid gap-4">
          <Field label="URL RPC" hint="https saja (http hanya untuk localhost)">
            <div className="flex gap-2">
              <input
                value={rpc}
                onChange={(e) => setRpc(e.target.value)}
                placeholder="https://…"
                autoComplete="off"
                spellCheck={false}
                className={`${inputCls} font-mono`}
              />
              <Button type="button" variant="ghost" onClick={detect} busy={detecting} disabled={!rpc.trim()}>
                {detecting ? "…" : "Deteksi"}
              </Button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Chain ID">
              <input
                value={chainId}
                onChange={(e) => setChainId(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                className={`${inputCls} font-mono`}
              />
            </Field>
            <Field label="Simbol koin native">
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} autoComplete="off" className={inputCls} />
            </Field>
          </div>
          <Field label="Nama jaringan">
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className={inputCls} />
          </Field>
          <Field label="URL block explorer (opsional)" hint="Contoh: https://explorer.contoh.xyz">
            <input
              value={explorer}
              onChange={(e) => setExplorer(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
          </Field>
          <label className="flex items-start gap-3 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={testnet}
              onChange={(e) => setTestnet(e.target.checked)}
              className="mt-1 size-4 accent-[#5fb396]"
            />
            Ini jaringan testnet. Hilangkan centang untuk mainnet (dana sungguhan).
          </label>
          {err && (
            <p role="alert" className="text-xs text-rose-400">
              {err}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Tutup
            </Button>
            <Button type="submit" busy={busy} disabled={!rpc || !chainId || !name || !symbol}>
              {busy ? "Memverifikasi RPC…" : "Tambahkan jaringan"}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
