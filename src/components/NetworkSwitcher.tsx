import { Suspense, lazy, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, m } from "framer-motion";
import { CaretDown, Check, Plus } from "@phosphor-icons/react";
import { useSettings } from "../context/SettingsContext";
import CoinIcon from "./CoinIcon";
import { Button, Modal, PopoverScrim, popoverCls, spring } from "./ui";

const CustomChainModal = lazy(() => import("./CustomChainModal"));

export default function NetworkSwitcher() {
  const { chain, chains, testMode, setTestMode, setChainId } = useSettings();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [manage, setManage] = useState(false);
  const [manageMounted, setManageMounted] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = chains.filter((c) => c.testnet === testMode);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pickMode(toTestnet: boolean) {
    if (toTestnet === testMode) return;
    if (toTestnet) setTestMode(true);
    else {
      setOpen(false);
      setConfirm(true);
    }
  }

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button[role='option']"));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <>
      <div ref={root} className="relative w-full sm:w-auto">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-zinc-900/60 py-2 pl-2.5 pr-3 text-left transition-[transform,background-color,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-white/20 hover:bg-zinc-900 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
        >
          <CoinIcon symbol={chain.symbol} size={24} />
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-sm text-zinc-100 sm:max-w-[9.5rem]">{chain.name}</span>
            <span
              className={`text-[10px] uppercase tracking-[0.14em] ${chain.testnet ? "text-zinc-500" : "text-amber-300/80"}`}
            >
              {chain.testnet ? "Testnet" : "Mainnet"}
            </span>
          </span>
          <CaretDown
            size={14}
            className={`shrink-0 text-zinc-500 transition-transform duration-300 group-hover:text-zinc-300 ${open ? "rotate-180" : ""}`}
          />
        </button>

        <AnimatePresence>
          {open && <PopoverScrim key="scrim" onClick={() => setOpen(false)} />}
          {open && (
            <m.div
              key="pop"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={spring}
              style={{ transformOrigin: "top right" }}
              className={popoverCls}
            >
              <div
                role="group"
                aria-label="Mode jaringan"
                className="relative grid grid-cols-2 rounded-xl bg-zinc-950/70 p-1 text-xs"
              >
                {[true, false].map((isTest) => (
                  <button
                    key={String(isTest)}
                    type="button"
                    aria-pressed={testMode === isTest}
                    onClick={() => pickMode(isTest)}
                    className={`relative rounded-[10px] px-3 py-2 transition-colors duration-300 ${
                      testMode === isTest ? "text-zinc-50" : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {testMode === isTest && (
                      <m.span
                        layoutId="mode-pill"
                        transition={spring}
                        className="absolute inset-0 rounded-[10px] bg-white/10"
                      />
                    )}
                    <span className="relative">{isTest ? "Testnet" : "Mainnet"}</span>
                  </button>
                ))}
              </div>

              <m.ul
                key={String(testMode)}
                role="listbox"
                aria-label="Pilih jaringan"
                onKeyDown={onListKey}
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035 } } }}
                className="mt-2 grid gap-0.5"
              >
                {list.map((c) => {
                  const active = c.chainId === chain.chainId;
                  return (
                    <m.li
                      key={c.chainId}
                      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: spring } }}
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          setChainId(c.chainId);
                          setOpen(false);
                        }}
                        className="relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-300 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                      >
                        {active && (
                          <m.span
                            layoutId="chain-active"
                            transition={spring}
                            className="absolute inset-0 rounded-xl bg-white/[0.06] ring-1 ring-inset ring-accent/30"
                          />
                        )}
                        <span className="relative">
                          <CoinIcon symbol={c.symbol} size={30} />
                        </span>
                        <span className="relative grid min-w-0 flex-1 leading-tight">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm text-zinc-100">{c.name}</span>
                            {c.custom && (
                              <span className="shrink-0 rounded-md border border-white/10 px-1.5 py-px text-[10px] uppercase tracking-wider text-zinc-500">
                                kustom
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-xs text-zinc-600">
                            chain {c.chainId} · {c.symbol}
                          </span>
                        </span>
                        {active && <Check className="relative shrink-0 text-accent" />}
                      </button>
                    </m.li>
                  );
                })}
              </m.ul>

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setManageMounted(true);
                  setManage(true);
                }}
                className="mt-2 flex w-full items-center gap-3 rounded-xl border border-dashed border-white/10 px-3 py-2.5 text-sm text-zinc-400 transition-colors duration-300 hover:border-accent/40 hover:text-zinc-100 active:scale-[0.99]"
              >
                <span className="grid size-[30px] place-items-center rounded-full border border-white/10">
                  <Plus size={14} />
                </span>
                Tambah atau kelola jaringan kustom
              </button>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      {manageMounted && (
        <Suspense fallback={null}>
          <CustomChainModal open={manage} onClose={() => setManage(false)} />
        </Suspense>
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Beralih ke mainnet">
        <p className="text-sm leading-relaxed text-zinc-400">
          Di mainnet, setiap transaksi memakai dana sungguhan dan tidak bisa dibatalkan. Pastikan alur kirim,
          backup keystore, dan pemulihan sudah Anda uji di testnet.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Tetap di testnet
          </Button>
          <Button
            onClick={() => {
              setTestMode(false);
              setConfirm(false);
            }}
          >
            Lanjut ke mainnet
          </Button>
        </div>
      </Modal>
    </>
  );
}
