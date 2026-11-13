import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { CaretDown, Check, Lock, PencilSimple, Plus } from "@phosphor-icons/react";
import { useWallet } from "../context/WalletContext";
import { shortAddr } from "../lib/format";
import { cleanName, loadWallets, removeSaved, renameSaved, type SavedWallet } from "../lib/vaultStore";
import WalletAvatar from "./WalletAvatar";
import type { AddTab } from "./AddWalletModal";
import { Button, Field, Modal, PopoverScrim, inputCls, popoverCls, spring } from "./ui";

const AddWalletModal = lazy(() => import("./AddWalletModal"));

export default function WalletSwitcher() {
  const { sessions, activeId, name, account, switchTo, renameSession } = useWallet();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedWallet[]>(() => loadWallets());
  const [addOpen, setAddOpen] = useState(false);
  const [addMounted, setAddMounted] = useState(false);
  const [addTab, setAddTab] = useState<AddTab>("create");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [err, setErr] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setSaved(loadWallets());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const locked = saved.filter((w) => !sessions.some((s) => s.id === w.id));

  function openAdd(tab: AddTab) {
    setOpen(false);
    setAddTab(tab);
    setAddMounted(true);
    setAddOpen(true);
  }

  function doRename() {
    if (!renaming) return;
    const n = cleanName(renaming.name);
    if (!n) return setErr("Nama tidak boleh kosong.");
    const taken = [...sessions, ...saved];
    if (taken.some((t) => t.id !== renaming.id && t.name.toLowerCase() === n.toLowerCase())) {
      return setErr("Nama sudah dipakai wallet lain.");
    }
    renameSession(renaming.id, n);
    renameSaved(renaming.id, n);
    setSaved(loadWallets());
    setRenaming(null);
  }

  const renamingSaved = renaming ? saved.some((w) => w.id === renaming.id) : false;

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
          <WalletAvatar seed={activeId ?? "x"} label={name} size={24} />
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-sm text-zinc-100 sm:max-w-[9.5rem]">{name}</span>
            <span className="font-mono text-[10px] tracking-wide text-zinc-500">
              {account ? shortAddr(account.address) : ""}
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
              <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                Terbuka di sesi ini
              </p>
              <ul role="listbox" aria-label="Pilih wallet" className="grid gap-0.5">
                {sessions.map((s) => {
                  const active = s.id === activeId;
                  return (
                    <li key={s.id} className="relative flex items-center rounded-xl">
                      {active && (
                        <m.span
                          layoutId="wallet-active"
                          transition={spring}
                          className="absolute inset-0 rounded-xl bg-white/[0.06] ring-1 ring-inset ring-accent/30"
                        />
                      )}
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          switchTo(s.id);
                          setOpen(false);
                        }}
                        className="relative flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-300 hover:bg-white/[0.04]"
                      >
                        <WalletAvatar seed={s.id} label={s.name} size={30} />
                        <span className="grid min-w-0 flex-1 leading-tight">
                          <span className="truncate text-sm text-zinc-100">{s.name}</span>
                          <span className="font-mono text-xs text-zinc-600">{shortAddr(s.account.address)}</span>
                        </span>
                        {active && <Check className="shrink-0 text-accent" />}
                      </button>
                      <button
                        type="button"
                        aria-label={`Ubah nama ${s.name}`}
                        onClick={() => {
                          setRenaming({ id: s.id, name: s.name });
                          setErr("");
                          setOpen(false);
                        }}
                        className="relative mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-zinc-600 transition-colors duration-300 hover:bg-white/5 hover:text-zinc-200"
                      >
                        <PencilSimple />
                      </button>
                    </li>
                  );
                })}
              </ul>

              {locked.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-4 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                    Tersimpan, terkunci
                  </p>
                  <ul className="grid gap-0.5">
                    {locked.map((w) => (
                      <li key={w.id}>
                        <button
                          type="button"
                          onClick={() => openAdd("unlock")}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-300 hover:bg-white/[0.04]"
                        >
                          <WalletAvatar seed={w.id} label={w.name} size={30} />
                          <span className="grid min-w-0 flex-1 leading-tight">
                            <span className="truncate text-sm text-zinc-300">{w.name}</span>
                            <span className="font-mono text-xs text-zinc-600">{shortAddr(w.address)}</span>
                          </span>
                          <Lock className="shrink-0 text-zinc-600" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <button
                type="button"
                onClick={() => openAdd("create")}
                className="mt-3 flex w-full items-center gap-3 rounded-xl border border-dashed border-white/10 px-3 py-2.5 text-sm text-zinc-400 transition-colors duration-300 hover:border-accent/40 hover:text-zinc-100 active:scale-[0.99]"
              >
                <span className="grid size-[30px] place-items-center rounded-full border border-white/10">
                  <Plus size={14} />
                </span>
                Tambah wallet
              </button>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      {addMounted && (
        <Suspense fallback={null}>
          <AddWalletModal open={addOpen} onClose={() => setAddOpen(false)} initialTab={addTab} />
        </Suspense>
      )}

      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Ubah nama wallet">
        {renaming && (
          <div className="grid gap-5">
            <Field label="Nama wallet" error={err}>
              <input
                value={renaming.name}
                onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                maxLength={24}
                autoComplete="off"
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="ghost" onClick={() => setRenaming(null)}>
                Batal
              </Button>
              <Button onClick={doRename}>Simpan</Button>
            </div>
            {renamingSaved && (
              <Button
                variant="danger"
                onClick={() => {
                  removeSaved(renaming.id);
                  setSaved(loadWallets());
                  setRenaming(null);
                }}
              >
                Lupakan keystore di browser ini
              </Button>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
