import { Suspense, lazy, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { ArrowSquareOut, ArrowsClockwise, Key, Lock, ShieldCheck } from "@phosphor-icons/react";
import { useWallet, AUTO_LOCK_MS } from "../context/WalletContext";
import { useSettings } from "../context/SettingsContext";
import { explorerAddress, kindOf } from "../lib/chains";
import { useChainData } from "../lib/chainData";
import { checkTx } from "../lib/chainOps";
import { useVisibleInterval } from "../lib/visibility";
import { trimAmount } from "../lib/format";
import { fmtIdr, fmtUsd, usePortfolio } from "../lib/portfolio";
import { clearWallets, loadWallets } from "../lib/vaultStore";
import { SOL_PATH, btcAccountPath, btcNet } from "../core/derive";
import { useSwapTracker } from "../swap/tracker";
import type { Account } from "../lib/vault";
import ChainPulse from "./ChainPulse";
import NetworkSwitcher from "./NetworkSwitcher";
import WalletSwitcher from "./WalletSwitcher";
import PortfolioPanel from "./PortfolioPanel";
import CoinIcon from "./CoinIcon";
import { Button, CopyButton, Notice, Skeleton, Tabs, spring } from "./ui";

const SendPanel = lazy(() => import("./SendPanel"));
const SwapPanel = lazy(() => import("./SwapPanel"));
const BtcSendPanel = lazy(() => import("./BtcSendPanel"));
const SolSendPanel = lazy(() => import("./SolSendPanel"));
const ReceivePanel = lazy(() => import("./ReceivePanel"));
const TokensPanel = lazy(() => import("./TokensPanel"));
const HistoryPanel = lazy(() => import("./HistoryPanel"));

type Tab = "portofolio" | "kirim" | "swap" | "terima" | "token" | "riwayat";
const TABS: { key: Tab; label: string }[] = [
  { key: "portofolio", label: "Aset" },
  { key: "kirim", label: "Kirim" },
  { key: "swap", label: "Swap" },
  { key: "terima", label: "Terima" },
  { key: "token", label: "Token" },
  { key: "riwayat", label: "Riwayat" },
];

const KIND_LABEL = { evm: "EVM", btc: "Bitcoin (UTXO)", sol: "Solana" } as const;

const SECURITY = [
  "Kunci privat hanya ada di memori tab ini.",
  `Terkunci otomatis setelah ${AUTO_LOCK_MS / 60000} menit tanpa aktivitas.`,
  "Transaksi ditandatangani di browser. Penyedia data hanya menerima transaksi bertanda tangan.",
  "Identitas jaringan (chain ID / cluster) diverifikasi sebelum setiap pengiriman.",
];

export default function Dashboard({ account }: { account: Account }) {
  const { lock, name: walletName } = useWallet();
  const { chain, chains, testMode, allTokens, history, setHistoryStatus } = useSettings();
  const kind = kindOf(chain);
  const tabs = kind === "evm" ? TABS : TABS.filter((t) => t.key !== "token" && t.key !== "swap");
  const [tab, setTab] = useState<Tab>("portofolio");
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "portofolio";

  const data = useChainData(chain, account);
  const pf = usePortfolio(account, testMode, allTokens, chains);
  const { address, owner } = data;

  // Pantau swap yang sedang berjalan (tahan restart: status tersimpan di browser).
  useSwapTracker(chains, () => {
    data.refresh();
    pf.refresh();
  });

  // Pantau transaksi pending di semua jaringan (berhenti saat tab tersembunyi).
  useVisibleInterval(async () => {
    for (const h of history.filter((x) => x.status === "pending")) {
      const c = chains.find((x) => x.chainId === h.chainId);
      if (!c) continue;
      try {
        const st = await checkTx(c, h.hash);
        if (st !== "pending") {
          setHistoryStatus(h.hash, st);
          if (c.chainId === chain.chainId) data.refresh();
          pf.refresh();
        }
      } catch {
        /* coba lagi pada putaran berikutnya */
      }
    }
  }, 8000);

  const empty = data.balance !== null && Number(data.balance) === 0;
  const explorerLink = address ? explorerAddress(chain, address) : null;
  const afterSend = () => {
    data.refresh();
    pf.refresh();
  };

  return (
    <div className="min-h-[100dvh]">
      {!chain.testnet && (
        <div className="border-b border-amber-400/20 bg-amber-400/[0.06] px-6 py-2 text-center text-xs text-amber-200/90">
          Mainnet aktif. Setiap transaksi memakai dana sungguhan.
        </div>
      )}

      <header className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-4 px-6 py-5 sm:flex sm:px-10">
        <div className="flex items-center gap-3 text-zinc-50">
          <span className="grid size-9 place-items-center rounded-xl border border-white/10 bg-zinc-900 text-accent">
            <Key />
          </span>
          <span className="text-lg font-medium tracking-tight">Kunci</span>
        </div>
        <Button variant="ghost" onClick={lock} className="size-11 !p-0 sm:order-3" aria-label="Kunci semua wallet">
          <Lock />
        </Button>
        <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:order-2 sm:ml-auto sm:flex sm:items-center sm:gap-3">
          <ChainPulse chain={chain} />
          <WalletSwitcher />
          <NetworkSwitcher />
        </div>
      </header>

      <main className="mx-auto grid max-w-[1400px] gap-x-20 gap-y-14 px-6 pb-24 pt-8 sm:px-10 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:pt-14">
        <section className="min-w-0">
          <div className="mb-12">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">
              Total aset · {testMode ? "semua testnet" : "semua mainnet"}
            </p>
            {pf.loading ? (
              <Skeleton className="mt-3 h-9 w-52" />
            ) : testMode ? (
              <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-zinc-500">
                Testnet tidak punya nilai uang. Lihat jumlah koin tiap jaringan di tab Portofolio.
              </p>
            ) : pf.priceError && pf.totalUsd === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">Harga tidak bisa dimuat. Jumlah koin tetap ada di tab Portofolio.</p>
            ) : (
              <>
                <p className="mt-3 font-mono text-3xl tracking-tight text-zinc-50">{fmtUsd(pf.totalUsd)}</p>
                <p className="mt-1 font-mono text-sm text-zinc-500">
                  {fmtIdr(pf.totalIdr)}
                  {pf.unpriced > 0 ? ` · ${pf.unpriced} aset belum berharga` : ""}
                </p>
              </>
            )}
          </div>

          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Saldo · {chain.name}</p>
          <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-2">
            {data.unsupported ? null : data.loading && data.balance === null ? (
              <Skeleton className="h-14 w-64" />
            ) : data.balance !== null ? (
              <m.p
                key={data.balance}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring}
                className="font-mono text-4xl tracking-tight text-zinc-50 sm:text-5xl md:text-6xl"
              >
                {trimAmount(data.balance, 8)}
              </m.p>
            ) : (
              <p className="text-sm text-rose-400" role="alert">
                {data.error}
              </p>
            )}
            <span className="flex items-center gap-2 pb-2 font-mono text-lg text-zinc-500">
              <CoinIcon symbol={chain.symbol} size={24} />
              {chain.symbol}
            </span>
            <button
              type="button"
              onClick={data.refresh}
              aria-label="Segarkan saldo"
              className="mb-2 ml-1 grid size-8 place-items-center rounded-lg text-zinc-500 transition-colors duration-300 hover:bg-white/5 hover:text-zinc-200 active:scale-95"
            >
              <ArrowsClockwise />
            </button>
          </div>
          {data.unsupported && <div className="mt-4 max-w-[60ch]"><Notice>{data.unsupported}</Notice></div>}
          {data.pending && (
            <p className="mt-3 font-mono text-sm text-zinc-500">
              + {trimAmount(data.pending, 8)} {chain.symbol} menunggu konfirmasi
            </p>
          )}
          {empty && (
            <p className="mt-4 max-w-[60ch] text-sm leading-relaxed text-zinc-500">
              Saldo masih nol.{" "}
              {chain.testnet
                ? "Minta koin testnet dari faucet resmi jaringan ini"
                : "Kirim sedikit koin native ke alamat Anda"}
              , lalu tekan segarkan.
            </p>
          )}

          <div className="mt-12">
            <Tabs items={tabs} value={activeTab} onChange={setTab} id="dash" />
            <AnimatePresence mode="wait">
              <m.div
                key={`${activeTab}-${chain.chainId}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={spring}
                className="pt-8"
              >
                <Suspense fallback={<PanelSkeleton />}>
                  {activeTab === "portofolio" && <PortfolioPanel pf={pf} testMode={testMode} />}
                  {activeTab === "kirim" &&
                    (data.unsupported ? (
                      <Notice>{data.unsupported}</Notice>
                    ) : !address ? (
                      <PanelSkeleton />
                    ) : kind === "btc" ? (
                      <BtcSendPanel account={account} chain={chain} owner={owner} onSent={afterSend} />
                    ) : kind === "sol" ? (
                      <SolSendPanel account={account} chain={chain} owner={owner} onSent={afterSend} />
                    ) : (
                      <SendPanel account={account} chain={chain} address={address} onSent={afterSend} />
                    ))}
                  {activeTab === "swap" && <SwapPanel account={account} chain={chain} onChanged={afterSend} />}
                  {activeTab === "terima" &&
                    (data.unsupported ? (
                      <Notice>{data.unsupported}</Notice>
                    ) : !address ? (
                      <PanelSkeleton />
                    ) : (
                      <ReceivePanel address={address} chain={chain} />
                    ))}
                  {activeTab === "token" && <TokensPanel chain={chain} owner={account.address} />}
                  {activeTab === "riwayat" && (owner ? <HistoryPanel chain={chain} address={owner} /> : <PanelSkeleton />)}
                </Suspense>
              </m.div>
            </AnimatePresence>
          </div>
        </section>

        <aside className="min-w-0 divide-y divide-white/[0.06] border-t border-white/[0.06] lg:border-l lg:border-t-0 lg:pl-12">
          <div className="pb-8 lg:pt-1">
            <p className="truncate text-xs uppercase tracking-[0.14em] text-zinc-500">Akun · {walletName}</p>
            {address ? (
              <>
                <div className="mt-3 flex items-start gap-1">
                  <p className="break-all font-mono text-sm leading-relaxed text-zinc-100">{address}</p>
                  <CopyButton text={address} label="Salin alamat" />
                </div>
                {explorerLink && (
                  <a
                    href={explorerLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
                  >
                    Lihat di explorer <ArrowSquareOut />
                  </a>
                )}
              </>
            ) : (
              <Skeleton className="mt-3 h-5 w-full" />
            )}
          </div>

          <div className="py-8">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Jaringan</p>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              <dt className="text-zinc-500">Jenis</dt>
              <dd className="text-zinc-200">{KIND_LABEL[kind]}</dd>
              {kind === "evm" && (
                <>
                  <dt className="text-zinc-500">Chain ID</dt>
                  <dd className="font-mono text-zinc-200">{chain.chainId}</dd>
                </>
              )}
              {kind === "btc" && (
                <>
                  <dt className="text-zinc-500">Derivasi</dt>
                  <dd className="break-all font-mono text-zinc-200">{btcAccountPath(btcNet(chain.testnet))} (BIP-84)</dd>
                </>
              )}
              {kind === "sol" && (
                <>
                  <dt className="text-zinc-500">Derivasi</dt>
                  <dd className="break-all font-mono text-zinc-200">{SOL_PATH}</dd>
                </>
              )}
              <dt className="text-zinc-500">Mode</dt>
              <dd className="text-zinc-200">{chain.testnet ? "Testnet" : "Mainnet"}</dd>
              {chain.custom && (
                <>
                  <dt className="text-zinc-500">Sumber</dt>
                  <dd className="text-zinc-200">Kustom</dd>
                </>
              )}
              <dt className="text-zinc-500">Cadangan data</dt>
              <dd className="font-mono text-zinc-200">{chain.rpcUrls.length} endpoint</dd>
            </dl>
          </div>

          <div className="pt-8">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Keamanan</p>
            <ul className="mt-3 grid gap-3">
              {SECURITY.map((s) => (
                <li key={s} className="flex gap-3 text-sm leading-relaxed text-zinc-400">
                  <ShieldCheck className="mt-0.5 shrink-0 text-accent" />
                  {s}
                </li>
              ))}
            </ul>
            <VaultMemory />
          </div>
        </aside>
      </main>
    </div>
  );
}

function VaultMemory() {
  const [count, setCount] = useState(() => loadWallets().length);
  return (
    <div className="mt-6 flex items-center justify-between gap-4 border-t border-white/[0.06] pt-5 text-sm">
      <p className="leading-relaxed text-zinc-500">
        {count > 0
          ? `${count} keystore terenkripsi tersimpan di browser ini.`
          : "Keystore tidak disimpan di browser ini."}
      </p>
      {count > 0 && (
        <button
          type="button"
          onClick={() => {
            clearWallets();
            setCount(0);
          }}
          className="shrink-0 text-xs text-zinc-400 transition-colors duration-300 hover:text-rose-300"
        >
          Lupakan semua
        </button>
      )}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden="true">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-2/3" />
    </div>
  );
}
