import {
  memo,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, m, useMotionValue, useSpring } from "framer-motion";
import { Check, Copy, IconContext } from "@phosphor-icons/react";
import { copyText } from "../lib/format";
import { passwordStrength } from "../lib/vault";

export const spring = { type: "spring", stiffness: 100, damping: 20 } as const;

export const inputCls =
  "w-full rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors duration-300 focus:border-accent/60 disabled:opacity-50";

/** Satu standar ikon untuk seluruh aplikasi (Phosphor, weight regular). */
export function IconProvider({ children }: { children: ReactNode }) {
  return <IconContext.Provider value={{ weight: "regular", size: 18 }}>{children}</IconContext.Provider>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  busy?: boolean;
};

export function Button({ variant = "primary", busy, className = "", disabled, children, ...rest }: BtnProps) {
  const variants = {
    primary: "bg-accent text-zinc-950 hover:bg-accent-hi",
    ghost: "border border-white/10 text-zinc-200 hover:bg-white/5",
    danger: "border border-rose-400/30 text-rose-300 hover:bg-rose-400/10",
  } as const;
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-[transform,background-color,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:-translate-y-[1px] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Label di atas input, helper opsional, error di bawah. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-2">
      <span className="text-xs font-medium tracking-wide text-zinc-400">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="text-xs text-rose-400">
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs text-zinc-600">{hint}</span>
      ) : null}
    </label>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-md bg-white/[0.06] ${className}`} aria-hidden="true">
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(value * 100)}>
      <m.div className="h-full origin-left bg-accent" animate={{ scaleX: value }} initial={{ scaleX: 0 }} transition={spring} />
    </div>
  );
}

export function PasswordMeter({ value }: { value: string }) {
  if (!value) return null;
  const s = passwordStrength(value);
  return (
    <div className="grid gap-1.5" aria-live="polite">
      <div className="grid grid-cols-4 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-1 rounded-full transition-colors duration-300 ${i < s.score ? "bg-accent" : "bg-white/10"}`} />
        ))}
      </div>
      <span className="text-xs text-zinc-500">
        {s.label}
        {value.length < 12 ? " · minimal 12 karakter" : ""}
      </span>
    </div>
  );
}

export function CopyButton({ text, label = "Salin" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => setDone(await copyText(text))}
      className="grid size-8 place-items-center rounded-lg text-zinc-500 transition-colors duration-300 hover:bg-white/5 hover:text-zinc-200 active:scale-95"
    >
      {done ? <Check className="text-accent" /> : <Copy />}
    </button>
  );
}

/** Titik status "bernapas". Terisolasi + memo agar tidak memicu render induk. */
export const StatusDot = memo(function StatusDot({
  tone = "ok",
  still = false,
}: {
  tone?: "ok" | "warn" | "bad";
  /** true = tanpa animasi napas (hemat baterai untuk daftar panjang). */
  still?: boolean;
}) {
  const color = tone === "ok" ? "bg-accent" : tone === "warn" ? "bg-amber-400" : "bg-rose-400";
  return (
    <span className="relative grid size-2 place-items-center" aria-hidden="true">
      {!still && (
        <m.span
          className={`absolute inline-flex size-2 rounded-full ${color} opacity-60`}
          animate={{ scale: [1, 2.2, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }}
        />
      )}
      <span className={`relative size-2 rounded-full ${color}`} />
    </span>
  );
});

/** Tombol magnetik: memakai motion value, bukan useState, supaya tidak re-render. */
export function Magnetic({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 150, damping: 15, mass: 0.1 });
  const sy = useSpring(y, { stiffness: 150, damping: 15, mass: 0.1 });
  function move(e: RPointerEvent<HTMLDivElement>) {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    x.set((e.clientX - (r.left + r.width / 2)) * 0.18);
    y.set((e.clientY - (r.top + r.height / 2)) * 0.28);
  }
  function leave() {
    x.set(0);
    y.set(0);
  }
  return (
    <m.div ref={ref} onPointerMove={move} onPointerLeave={leave} style={{ x: sx, y: sy }}>
      {children}
    </m.div>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  id,
}: {
  items: { key: T; label: string }[];
  value: T;
  onChange: (k: T) => void;
  id: string;
}) {
  return (
    <div role="tablist" className="flex border-b border-white/[0.06] sm:gap-7">
      {items.map((it) => (
        <button
          key={it.key}
          role="tab"
          type="button"
          aria-selected={value === it.key}
          onClick={() => onChange(it.key)}
          className={`relative flex-1 whitespace-nowrap pb-3 text-center text-[12px] transition-colors duration-300 min-[400px]:text-[13px] sm:flex-none sm:text-sm ${
            value === it.key ? "text-zinc-50" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {it.label}
          {value === it.key && (
            <m.span layoutId={`${id}-underline`} transition={spring} className="absolute inset-x-0 -bottom-px h-px bg-accent" />
          )}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  dismissible = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  dismissible?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open || !dismissible) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, dismissible, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <m.div
          className="fixed inset-0 z-40 grid place-items-end bg-zinc-950/70 p-4 sm:place-items-center sm:backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => dismissible && onClose()}
        >
          <m.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 28, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.98 }}
            transition={spring}
            className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[2rem] border border-white/10 bg-zinc-900 p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_30px_60px_-20px_rgba(0,0,0,0.6)]"
          >
            <h2 className="text-lg font-medium tracking-tight text-zinc-50">{title}</h2>
            <div className="mt-5">{children}</div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "info"; children: ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-amber-400/25 bg-amber-400/[0.06] text-amber-200/90"
      : "border-white/10 bg-white/[0.03] text-zinc-400";
  return <div className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${cls}`}>{children}</div>;
}

/** Menu pop-up: bottom sheet di HP (tidak pernah terpotong), dropdown di layar lebar. */
export const popoverCls =
  "fixed inset-x-3 bottom-3 z-30 max-h-[75dvh] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_48px_-16px_rgba(0,0,0,0.7)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[min(70dvh,34rem)] sm:w-80";

export function PopoverScrim({ onClick }: { onClick: () => void }) {
  return (
    <m.div
      className="fixed inset-0 z-20 bg-zinc-950/60 sm:hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClick}
      aria-hidden="true"
    />
  );
}

/** Baris label/nilai untuk jendela tinjau transaksi. Kolom nilai boleh menyusut (alamat panjang). */
export function DetailRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3 text-sm">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="min-w-0 break-words text-zinc-100">{children}</dd>
    </div>
  );
}
