import { Suspense, lazy, useState, type ReactNode } from "react";
import { AnimatePresence, m } from "framer-motion";
import {
  AddressBook,
  ArrowsLeftRight,
  ClockCounterClockwise,
  Coins,
  PaperPlaneTilt,
  QrCode,
  ShieldCheck,
  Target,
  Wallet,
} from "@phosphor-icons/react";
import { useWallet, AUTO_LOCK_MS } from "../context/WalletContext";
import { useSettings } from "../context/SettingsContext";
import { explorerAddress, kindOf } from "../lib/chains";
import { useChainData } from "../lib/chainData";
import { checkTx } from "../lib/chainOps";
import { useVisibleInterval } from "../lib/visibility";
import { trimAmount } from "../lib/format";
import { fmtIdr, fmtUsd, usePortfolio } from "../lib/portfolio";
import { clearWallets, loadWallets } from "../lib/vaultStore";
import { SOL_PATH, ZEC_PATH, btcAccountPath, btcNet } from "../core/derive";
import { useSwapTracker } from "../swap/tracker";
import { useGoalEngine } from "../goals/engine";
import { useSync } from "../goals/useSync";
import type { Account } from "../lib/vault";
import { useHistorySync } from "../history/useHistorySync";
import ChainPulse from "./ChainPulse";
import NetworkSwitcher from "./NetworkSwitcher";
import WalletSwitcher from "./WalletSwitcher";
import HomePanel from "./HomePanel";
import AccountPanel from "./shell/AccountPanel";
import AppShell from "./shell/AppShell";
import type { NavItem } from "./shell/nav";
import ContactsPanel from "./ContactsPanel";
import ZecSendPanel from "./ZecSendPanel";
import { Notice, Skeleton, spring } from "./ui";

const SendPanel = lazy(() => import("./SendPanel"));
const SwapPanel = lazy(() => import("./SwapPanel"));
const GoalsPanel = lazy(() => import("./GoalsPanel"));
const EndpointModal = lazy(() => import("./EndpointModal"));
const BtcSendPanel = lazy(() => import("./BtcSendPanel"));
const SolSendPanel = lazy(() => import("./SolSendPanel"));
const ReceivePanel = lazy(() => import("./ReceivePanel"));
const TokensPanel = lazy(() => import("./TokensPanel"));
const HistoryPanel = lazy(() => import("./HistoryPanel"));

type Tab = "portofolio" | "kirim" | "terima" | "swap" | "riwayat" | "kontak" | "goal" | "token" | "akun";
type NavDef = NavItem & { key: Tab; evmOnly?: boolean };
const NAV: NavDef[] = [
  { key: "portofolio", label: "Aset", icon: Wallet, primary: true, group: 0 },
  { key: "kirim", label: "Kirim", icon: PaperPlaneTilt, primary: true, group: 0 },
  { key: "terima", label: "Terima", icon: QrCode, primary: true, group: 0 },
  { key: "swap", label: "Swap", icon: ArrowsLeftRight, group: 0, evmOnly: true },
  { key: "riwayat", label: "Riwayat", icon: ClockCounterClockwise, primary: true, group: 1 },
  { key: "kontak", label: "Kontak", icon: AddressBook, group: 1 },
  { key: "goal", label: "Goal", icon: Target, group: 1 },
  { key: "token", label: "Token", icon: Coins, group: 1, evmOnly: true },
  { key: "akun", label: "Akun", icon: ShieldCheck, group: 2 },
];

const KIND_LABEL = { evm: "EVM", btc: "Bitcoin (UTXO)", sol: "Solana", zec: "Zcash (transparent)" } as const;

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
  const tabs = kind === "evm" ? NAV : NAV.filter((t) => !t.evmOnly);
  const [tab, setTab] = useState<Tab>("portofolio");
  const [endpointOpen, setEndpointOpen] = useState(false);
  const [endpointMounted, setEndpointMounted] = useState(false);
  const openEndpoints = () => {
    setEndpointMounted(true);
    setEndpointOpen(true);
  };
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "portofolio";

  const data = useChainData(chain, account);
  const pf = usePortfolio(account, testMode, allTokens, chains);
  const { address, owner } = data;

  // Goal: pantau progres (polling 30 dtk saat tab terlihat) dan sinkron Supabase opsional.
  const engine = useGoalEngine(account, chains, allTokens);
  const sync = useSync();
  const hsync = useHistorySync(account, owner, sync.state.status === "online");

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

  const nativeRow = pf.rows.find((r) => r.chain.chainId === chain.chainId && !r.address);
  const derivation =
    kind === "btc" ? `${btcAccountPath(btcNet(chain.testnet))} (BIP-84)` : kind === "zec" ? `${ZEC_PATH} (transparent)` : kind === "sol" ? SOL_PATH : null;

  const actions = [
    { key: "kirim", label: "Kirim", icon: PaperPlaneTilt, primary: true, onClick: () => setTab("kirim") },
    { key: "terima", label: "Terima", icon: QrCode, onClick: () => setTab("terima") },
    ...(kind === "evm" ? [{ key: "swap", label: "Swap", icon: ArrowsLeftRight, onClick: () => setTab("swap") }] : []),
  ];

  // Panel selain Aset dan Akun tampil di dalam satu kartu kaca.
  // Form (Kirim, Terima, Swap, Kontak) dibatasi lebarnya agar kolom isian tidak melar di layar lebar.
  const inCard = (node: ReactNode, narrow = false) => (
    <section className={`glass-surface glass-rim relative rounded-[2rem] p-6 sm:p-8 ${narrow ? "max-w-2xl" : ""}`}>{node}</section>
  );

  return (
    <>
      <AppShell
        items={tabs}
        active={activeTab}
        onNavigate={(k) => setTab(k as Tab)}
        title={tabs.find((t) => t.key === activeTab)?.label ?? "Aset"}
        wallet={(where) => <WalletSwitcher block align={where === "sidebar" ? "left" : "right"} />}
        network={(where) => <NetworkSwitcher block={where === "top"} align="right" />}
        status={<ChainPulse chain={chain} />}
        onLock={lock}
        banner={
          !chain.testnet ? (
            <div
              role="status"
              className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-2 text-xs text-amber-200/90 lg:justify-start"
            >
              <span className="size-1.5 rounded-full bg-amber-400" />
              Mainnet aktif: memakai dana sungguhan.
            </div>
          ) : undefined
        }
      >
        <AnimatePresence mode="wait">
          <m.div
            key={`${activeTab}-${chain.chainId}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={spring}
          >
            <Suspense fallback={<PanelSkeleton />}>
              {activeTab === "portofolio" && (
                <HomePanel
                  pf={pf}
                  testMode={testMode}
                  totalUsd={fmtUsd(pf.totalUsd)}
                  totalIdr={pf.totalIdr > 0 ? fmtIdr(pf.totalIdr) : null}
                  activeChainId={chain.chainId}
                  actions={actions}
                  card={{
                    name: chain.name,
                    symbol: chain.symbol,
                    testnet: chain.testnet,
                    balance: data.balance !== null ? trimAmount(data.balance, 8) : null,
                    loading: data.loading,
                    fiat: !testMode && nativeRow?.usd != null ? fmtUsd(nativeRow.usd) : null,
                    pending: data.pending ? trimAmount(data.pending, 8) : null,
                    note: data.note,
                    error: data.error,
                    unsupported: data.unsupported,
                    address,
                    explorerLink,
                    emptyHint: empty
                      ? `Saldo masih nol. ${chain.testnet ? "Minta koin testnet dari faucet resmi jaringan ini" : "Kirim sedikit koin native ke alamat Anda"}, lalu tekan segarkan.`
                      : null,
                    status: <ChainPulse chain={chain} />,
                    onRefresh: () => {
                      data.refresh();
                      pf.refresh();
                    },
                    onOpenEndpoints: openEndpoints,
                  }}
                />
              )}
              {activeTab === "kirim" &&
                inCard(
                  data.unsupported ? (
                    <Notice>{data.unsupported}</Notice>
                  ) : !address ? (
                    <PanelSkeleton />
                  ) : kind === "btc" ? (
                    <BtcSendPanel account={account} chain={chain} owner={owner} onSent={afterSend} />
                  ) : kind === "zec" ? (
                    <ZecSendPanel account={account} chain={chain} owner={owner} onSent={afterSend} />
                  ) : kind === "sol" ? (
                    <SolSendPanel account={account} chain={chain} owner={owner} onSent={afterSend} />
                  ) : (
                    <SendPanel account={account} chain={chain} address={address} onSent={afterSend} />
                  ),
                  true,
                )}
              {activeTab === "kontak" && inCard(<ContactsPanel kind={kind} />, true)}
              {activeTab === "goal" && inCard(<GoalsPanel account={account} chain={chain} engine={engine} sync={sync} />)}
              {activeTab === "swap" && inCard(<SwapPanel account={account} chain={chain} onChanged={afterSend} />, true)}
              {activeTab === "terima" &&
                inCard(
                  data.unsupported ? (
                    <Notice>{data.unsupported}</Notice>
                  ) : !address ? (
                    <PanelSkeleton />
                  ) : (
                    <ReceivePanel address={address} chain={chain} />
                  ),
                  true,
                )}
              {activeTab === "token" && inCard(<TokensPanel chain={chain} owner={account.address} />)}
              {activeTab === "riwayat" &&
                inCard(owner ? <HistoryPanel chain={chain} address={owner} syncStatus={sync.state.status} hsync={hsync} /> : <PanelSkeleton />)}
              {activeTab === "akun" && (
                <AccountPanel
                  walletName={walletName}
                  address={address}
                  explorerLink={explorerLink}
                  kindLabel={KIND_LABEL[kind]}
                  chainId={kind === "evm" ? chain.chainId : null}
                  derivation={derivation}
                  testnet={chain.testnet}
                  custom={!!chain.custom}
                  endpointCount={chain.rpcUrls.length}
                  security={SECURITY}
                  onOpenEndpoints={openEndpoints}
                  onDeepScan={kind === "btc" ? data.deepScan : undefined}
                  vault={<VaultMemory />}
                />
              )}
            </Suspense>
          </m.div>
        </AnimatePresence>
      </AppShell>
      {endpointMounted && (
        <Suspense fallback={null}>
          <EndpointModal open={endpointOpen} onClose={() => setEndpointOpen(false)} chain={chain} />
        </Suspense>
      )}
    </>
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
