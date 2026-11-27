import { useState, type ReactNode } from "react";
import { DotsThree, Key, Lock } from "@phosphor-icons/react";
import { Modal } from "../ui";
import type { NavItem } from "./nav";

type Props = {
  items: NavItem[];
  active: string;
  onNavigate: (key: string) => void;
  title: string;
  /** WalletSwitcher: di sidebar (desktop) dan bar atas (HP). Dipanggil dua kali, hanya satu yang tampil. */
  wallet: (where: "sidebar" | "top") => ReactNode;
  /** NetworkSwitcher: bar atas (HP) dan header (desktop). Dipanggil dua kali, hanya satu yang tampil. */
  network: (where: "top" | "header") => ReactNode;
  /** Status jaringan (ChainPulse) di kaki sidebar. */
  status?: ReactNode;
  onLock: () => void;
  banner?: ReactNode;
  children: ReactNode;
};

const navBtn =
  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * Cangkang aplikasi: sidebar kaca di layar lebar, tab bar kaca mengambang di HP.
 * Catatan teknis: wadah yang menampung popover/modal (position: fixed) TIDAK boleh memakai backdrop-filter,
 * karena itu menjadikannya containing block dan menggeser anak fixed. Sidebar dan bar atas memakai glass-surface (tanpa blur);
 * hanya tab bar bawah (daun, tanpa anak fixed) yang memakai blur.
 */
export default function AppShell({ items, active, onNavigate, title, wallet, network, status, onLock, banner, children }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const groups = [...new Set(items.map((i) => i.group))].sort((a, b) => a - b);
  const primary = items.filter((i) => i.primary);
  const more = items.filter((i) => !i.primary);
  const moreActive = more.some((i) => i.key === active);

  return (
    <div className="min-h-[100dvh]">
      <div className="mx-auto max-w-[1440px] lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:gap-6 lg:px-6 lg:py-6">
        {/* ---------- Sidebar (desktop) ---------- */}
        <aside className="glass-surface glass-rim sticky top-6 hidden h-[calc(100dvh-3rem)] flex-col rounded-[2rem] p-4 lg:flex">
          <div className="flex items-center gap-3 px-2 pb-5 pt-1 text-zinc-50">
            <span className="glass grid size-9 place-items-center rounded-xl border border-white/10 text-accent">
              <Key />
            </span>
            <span className="text-lg font-medium tracking-tight">Kunci</span>
          </div>

          {wallet("sidebar")}

          <nav aria-label="Navigasi utama" className="-mx-1 mt-5 flex-1 overflow-y-auto px-1">
            {groups.map((g, gi) => (
              <ul key={g} className={`grid gap-1 ${gi > 0 ? "mt-3 border-t border-white/[0.06] pt-3" : ""}`}>
                {items
                  .filter((i) => i.group === g)
                  .map((it) => {
                    const on = it.key === active;
                    const Icon = it.icon;
                    return (
                      <li key={it.key}>
                        <button
                          type="button"
                          aria-current={on ? "page" : undefined}
                          onClick={() => onNavigate(it.key)}
                          className={`${navBtn} w-full ${on ? "glass-lens text-zinc-50" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"}`}
                        >
                          <Icon size={20} weight={on ? "fill" : "regular"} />
                          {it.label}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            ))}
          </nav>

          <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4">
            {status}
            <button
              type="button"
              onClick={onLock}
              className={`${navBtn} w-full justify-center border border-white/10 text-zinc-300 hover:bg-white/5 hover:text-zinc-50`}
            >
              <Lock size={18} />
              Kunci wallet
            </button>
          </div>
        </aside>

        {/* ---------- Konten ---------- */}
        <div className="min-w-0">
          {banner && <div className="px-4 pt-3 lg:hidden">{banner}</div>}

          {/* Bar atas (HP): wallet + jaringan. Kunci ada di baris judul. */}
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-2 px-4 pt-3 lg:hidden">
            {wallet("top")}
            {network("top")}
          </div>

          <main className="mx-auto max-w-4xl px-4 pb-32 pt-5 lg:pb-10 lg:pt-0">
            {banner && <div className="mb-4 hidden lg:block">{banner}</div>}
            <div className="mb-5 flex items-center justify-between gap-4 lg:mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 lg:text-[1.65rem]">{title}</h1>
              <div className="hidden lg:block">{network("header")}</div>
              <button
                type="button"
                onClick={onLock}
                aria-label="Kunci semua wallet"
                className="glass grid size-10 place-items-center rounded-xl border border-white/10 text-zinc-300 transition-transform duration-300 active:scale-95 lg:hidden"
              >
                <Lock />
              </button>
            </div>
            {children}
          </main>
        </div>
      </div>

      {/* ---------- Tab bar mengambang (HP) ---------- */}
      <nav
        aria-label="Navigasi utama"
        className="fixed inset-x-3 z-10 lg:hidden"
        style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <ul className="glass glass-rim mx-auto flex max-w-md items-stretch gap-1 rounded-full border border-white/10 p-1.5">
          {primary.map((it) => (
            <TabButton key={it.key} item={it} on={it.key === active} onClick={() => onNavigate(it.key)} />
          ))}
          <TabButton
            item={{ key: "menu", label: "Menu", icon: DotsThree, group: 9 }}
            on={moreActive}
            onClick={() => setMenuOpen(true)}
          />
        </ul>
      </nav>

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <ul className="grid grid-cols-2 gap-2">
          {more.map((it) => {
            const Icon = it.icon;
            const on = it.key === active;
            return (
              <li key={it.key}>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onNavigate(it.key);
                  }}
                  className={`glass flex w-full flex-col items-start gap-3 rounded-2xl border border-white/10 p-4 text-left text-sm transition-transform duration-300 active:scale-[0.98] ${on ? "text-zinc-50" : "text-zinc-300"}`}
                >
                  <Icon size={24} weight={on ? "fill" : "regular"} className={on ? "text-accent" : ""} />
                  {it.label}
                </button>
              </li>
            );
          })}
        </ul>
      </Modal>
    </div>
  );
}

function TabButton({ item, on, onClick }: { item: NavItem; on: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <li className="min-w-0 flex-1">
      <button
        type="button"
        aria-current={on ? "page" : undefined}
        onClick={onClick}
        className={`flex w-full flex-col items-center gap-0.5 rounded-full px-1 py-2 text-[11px] leading-tight transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? "glass-lens text-zinc-50" : "text-zinc-500"}`}
      >
        <Icon size={22} weight={on ? "fill" : "regular"} />
        <span className="max-w-full truncate">{item.label}</span>
      </button>
    </li>
  );
}
