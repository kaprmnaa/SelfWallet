import { useState, type FormEvent } from "react";
import { useSettings } from "../context/SettingsContext";
import type { ChainConfig } from "../lib/chains";
import { hostOf, explainError } from "../lib/explain";
import { normalizeEndpoint, testEndpoint } from "../lib/endpoints";
import { Button, Field, Modal, Notice, StatusDot, inputCls } from "./ui";

type Result = { ok: boolean; ms?: number; error?: string };

/** Diagnosa koneksi + endpoint kustom. Menjawab "kenapa RPC offline?" dengan alasan yang nyata. */
export default function EndpointModal({ open, onClose, chain }: { open: boolean; onClose: () => void; chain: ChainConfig }) {
  const { endpoints, setEndpoint } = useSettings();
  const custom = endpoints[String(chain.chainId)];
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setRunning(true);
    setResults({});
    for (const u of chain.rpcUrls) {
      try {
        const ms = await testEndpoint(chain, u);
        setResults((r) => ({ ...r, [u]: { ok: true, ms } }));
      } catch (e) {
        setResults((r) => ({ ...r, [u]: { ok: false, error: explainError(e) } }));
      }
    }
    setRunning(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const norm = normalizeEndpoint(chain, url);
      await testEndpoint(chain, norm); // hanya disimpan jika lolos uji
      setEndpoint(chain.chainId, norm);
      setUrl("");
      setResults({});
    } catch (ex) {
      setErr(explainError(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Koneksi · ${chain.name}`} dismissible={!busy}>
      <div className="grid gap-5">
        <ul className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
          {chain.rpcUrls.map((u) => {
            const r = results[u];
            return (
              <li key={u} className="grid gap-1 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-200">
                    <StatusDot tone={!r ? "warn" : r.ok ? "ok" : "bad"} still={!r} />
                    <span className="truncate font-mono text-xs">{hostOf(u)}</span>
                    {u === custom && (
                      <span className="shrink-0 rounded-md border border-white/10 px-1.5 py-px text-[10px] uppercase tracking-wider text-zinc-500">
                        kustom
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-zinc-500">{r?.ok ? `${r.ms} ms` : r ? "gagal" : "belum diuji"}</span>
                </div>
                {r && !r.ok && <p className="break-words text-xs leading-relaxed text-rose-400">{r.error}</p>}
              </li>
            );
          })}
        </ul>
        <Button variant="ghost" onClick={run} busy={running}>
          {running ? "Menguji…" : "Cek koneksi"}
        </Button>

        <form onSubmit={save} className="grid gap-3 border-t border-white/[0.06] pt-5">
          <Field
            label="Endpoint kustom"
            hint={
              chain.kind === "btc"
                ? "Base URL Esplora, mis. server Esplora/mempool milik Anda."
                : chain.kind === "sol"
                  ? "URL RPC Solana (mis. dari Helius, QuickNode, Alchemy)."
                  : chain.kind === "zec"
                    ? "Node Zebra JSON-RPC (mis. …gateway.tatum.io, tambah ?key=API_KEY), Blockchair (…/zcash), atau Blockbook Zcash. gRPC lightwalletd tidak didukung."
                    : "URL JSON-RPC jaringan ini."
            }
            error={err}
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Button type="submit" busy={busy} disabled={!url.trim()}>
              {busy ? "Menguji…" : "Uji & simpan"}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={!custom || busy}
              onClick={() => {
                setEndpoint(chain.chainId, null);
                setResults({});
              }}
            >
              Hapus kustom
            </Button>
          </div>
        </form>

        <Notice tone="info">
          URL disimpan apa adanya di browser ini; jika memuat API key, siapa pun yang bisa membuka browser ini bisa melihatnya.
          Endpoint kustom bisa melihat alamat dan IP Anda. Endpoint hanya disimpan setelah lolos uji (chain ID / cluster harus cocok).
        </Notice>
      </div>
    </Modal>
  );
}
