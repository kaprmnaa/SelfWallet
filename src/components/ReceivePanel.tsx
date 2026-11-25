import { useEffect, useState } from "react";
import { kindOf, type ChainConfig } from "../lib/chains";
import { CopyButton, Notice, Skeleton } from "./ui";

export default function ReceivePanel({ address, chain }: { address: string; chain: ChainConfig }) {
  const kind = kindOf(chain);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    import("qrcode")
      .then((mod) => {
        const QR = (mod as unknown as { default?: typeof mod }).default ?? mod;
        return QR.toDataURL(address, {
          margin: 1,
          width: 240,
          errorCorrectionLevel: "M",
          color: { dark: "#070D1A", light: "#EAF3FF" },
        });
      })
      .then((u) => alive && setQr(u))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [address]);

  return (
    <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
      <div className="size-[240px] overflow-hidden rounded-2xl">
        {qr ? <img src={qr} alt={`Kode QR alamat ${address}`} className="size-full" /> : <Skeleton className="size-full rounded-2xl" />}
      </div>
      <div className="grid gap-4">
        <div>
          <p className="text-xs text-zinc-500">Alamat Anda</p>
          <div className="mt-2 flex items-start gap-1">
            <p className="break-all font-mono text-sm text-zinc-100">{address}</p>
            <CopyButton text={address} label="Salin alamat" />
          </div>
        </div>
        <Notice tone="info">
          {kind === "btc" ? (
            <>
              Format Native SegWit ({chain.testnet ? "tb1q…" : "bc1q…"}). Alamat berganti setelah menerima dana demi
              privasi: selalu pakai alamat yang tampil sekarang. Alamat lama tetap valid dan dananya tetap terhitung.
              Hanya kirim <span className="text-zinc-200">{chain.symbol}</span> di jaringan{" "}
              <span className="text-zinc-200">{chain.name}</span>.
            </>
          ) : kind === "zec" ? (
            <>
              Hanya alamat <span className="text-zinc-200">transparent</span> (t1…). Saldo dan transaksinya <span className="text-zinc-200">publik</span> di
              blockchain. Alamat shielded (z/u) belum didukung: jangan kirim dari wallet lain ke alamat shielded dengan memakai alamat ini.
            </>
          ) : kind === "sol" ? (
            <>
              Terima hanya SOL native di jaringan <span className="text-zinc-200">{chain.name}</span>. Token SPL belum
              didukung di versi ini: tidak akan tampil di sini, tetapi tetap bisa diakses dengan recovery phrase yang
              sama di wallet lain.
            </>
          ) : (
            <>
              Alamat yang sama berlaku di semua jaringan EVM, tetapi aset tidak berpindah antar jaringan. Terima hanya
              aset dari <span className="text-zinc-200">{chain.name}</span> saat jaringan ini aktif.
            </>
          )}
        </Notice>
      </div>
    </div>
  );
}
