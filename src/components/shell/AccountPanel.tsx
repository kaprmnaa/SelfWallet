import type { ReactNode } from "react";
import { ArrowSquareOut, ShieldCheck } from "@phosphor-icons/react";
import { CopyButton, Skeleton } from "../ui";

type Props = {
  walletName: string;
  address: string | null;
  explorerLink: string | null;
  kindLabel: string;
  chainId: number | null;
  derivation: string | null;
  testnet: boolean;
  custom: boolean;
  endpointCount: number;
  security: string[];
  onOpenEndpoints: () => void;
  onDeepScan?: () => void;
  vault: ReactNode;
};

const card = "glass-surface glass-rim relative rounded-[1.75rem] p-6";

/** Halaman Akun: alamat, detail jaringan, dan keamanan (dulu kolom samping). */
export default function AccountPanel(p: Props) {
  return (
    <div className="grid gap-4">
      <section className={card}>
        <h2 className="text-base font-medium text-zinc-100">{p.walletName}</h2>
        {p.address ? (
          <>
            <div className="mt-3 flex items-start gap-1">
              <p className="break-all font-mono text-sm leading-relaxed text-zinc-300">{p.address}</p>
              <CopyButton text={p.address} label="Salin alamat" />
            </div>
            {p.explorerLink && (
              <a
                href={p.explorerLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
              >
                Lihat di explorer <ArrowSquareOut />
              </a>
            )}
          </>
        ) : (
          <Skeleton className="mt-3 h-5 w-full" />
        )}
      </section>

      <section className={card}>
        <h2 className="text-base font-medium text-zinc-100">Jaringan</h2>
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5 text-sm">
          <dt className="text-zinc-500">Jenis</dt>
          <dd className="text-zinc-200">{p.kindLabel}</dd>
          {p.chainId !== null && (
            <>
              <dt className="text-zinc-500">Chain ID</dt>
              <dd className="font-mono text-zinc-200">{p.chainId}</dd>
            </>
          )}
          {p.derivation && (
            <>
              <dt className="text-zinc-500">Derivasi</dt>
              <dd className="break-all font-mono text-zinc-200">{p.derivation}</dd>
            </>
          )}
          <dt className="text-zinc-500">Mode</dt>
          <dd className="text-zinc-200">{p.testnet ? "Testnet" : "Mainnet"}</dd>
          {p.custom && (
            <>
              <dt className="text-zinc-500">Sumber</dt>
              <dd className="text-zinc-200">Kustom</dd>
            </>
          )}
          <dt className="text-zinc-500">Cadangan data</dt>
          <dd className="font-mono text-zinc-200">{p.endpointCount} endpoint</dd>
        </dl>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          <button type="button" onClick={p.onOpenEndpoints} className="text-xs text-accent transition-colors duration-300 hover:underline">
            Cek koneksi dan endpoint
          </button>
          {p.onDeepScan && (
            <button type="button" onClick={p.onDeepScan} className="text-xs text-accent transition-colors duration-300 hover:underline">
              Pindai mendalam (gap 20)
            </button>
          )}
        </div>
        {p.onDeepScan && (
          <p className="mt-2 max-w-[48ch] text-xs leading-relaxed text-zinc-500">
            Pindai mendalam hanya jika dana dari aplikasi lain tidak muncul. Mengirim lebih banyak permintaan ke penyedia data.
          </p>
        )}
      </section>

      <section className={card}>
        <h2 className="text-base font-medium text-zinc-100">Keamanan</h2>
        <ul className="mt-4 grid gap-3">
          {p.security.map((s) => (
            <li key={s} className="flex gap-3 text-sm leading-relaxed text-zinc-400">
              <ShieldCheck className="mt-0.5 shrink-0 text-accent" />
              {s}
            </li>
          ))}
        </ul>
        {p.vault}
      </section>
    </div>
  );
}
