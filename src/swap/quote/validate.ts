import { ZERO_ADDRESS, type NormalizedQuote } from "../domain/types";

export class QuoteRejected extends Error {}

export type Expectation = {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: bigint;
  owner: string;
  slippage: number;
  allowedTargets: string[];
  now?: number;
};

const lc = (s: string) => s.toLowerCase();
const reject = (why: string): never => {
  throw new QuoteRejected(why);
};

/** Selisih nilai USD antara bayar dan terima, dalam persen (null jika data harga tidak ada). */
export function valueGapPct(q: NormalizedQuote): number | null {
  if (q.fromUsd == null || q.toUsd == null || q.fromUsd <= 0) return null;
  return ((q.fromUsd - q.toUsd) / q.fromUsd) * 100;
}

/**
 * Validasi lokal atas quote dan calldata dari provider (blueprint 3 "Trust boundaries", 7.3).
 * Mengembalikan daftar peringatan; melempar QuoteRejected jika quote harus ditolak.
 *
 * BATASAN: calldata tidak di-decode penuh. Penerima divalidasi dengan memastikan alamat Anda ada di
 * dalam calldata dan tujuan transaksi berada di daftar kontrak yang diizinkan. Itu mengurangi, bukan
 * menghilangkan, risiko calldata berbahaya.
 */
export function validateQuote(q: NormalizedQuote, e: Expectation): string[] {
  const warnings = [...q.parseWarnings];
  const now = e.now ?? Date.now();
  const nativeSource = lc(e.fromToken) === ZERO_ADDRESS;

  if (now >= q.expiresAt) reject("Quote sudah kedaluwarsa.");
  if (q.fromChainId !== e.fromChain || q.toChainId !== e.toChain) reject("Jaringan pada quote tidak sesuai permintaan.");
  if (lc(q.fromToken.address) !== lc(e.fromToken) || lc(q.toToken.address) !== lc(e.toToken)) {
    reject("Token pada quote tidak sesuai permintaan.");
  }
  if (q.fromToken.chainId !== e.fromChain || q.toToken.chainId !== e.toChain) reject("Jaringan token pada quote tidak sesuai.");
  if (q.fromAmount !== e.fromAmount) reject("Jumlah pada quote tidak sesuai permintaan.");
  if (lc(q.fromAddress) !== lc(e.owner)) reject("Alamat pengirim pada quote bukan alamat Anda.");
  if (lc(q.toAddress) !== lc(e.owner)) reject("Alamat penerima pada quote bukan alamat Anda.");
  if (Math.abs(q.slippage - e.slippage) > 1e-9) reject("Slippage pada quote berbeda dari yang Anda pilih.");

  if (q.toAmount <= 0n || q.toAmountMin <= 0n || q.toAmountMin > q.toAmount) reject("Jumlah output pada quote tidak wajar.");
  // toAmountMin tidak boleh jauh lebih rendah daripada yang diizinkan slippage (rute bertahap boleh sedikit lebih longgar).
  const floorPpm = BigInt(Math.max(0, Math.round((1 - (2 * e.slippage + 0.01)) * 1e6)));
  if (q.toAmountMin * 1_000_000n < q.toAmount * floorPpm) reject("Jumlah minimum diterima jauh di bawah batas slippage Anda.");
  if (q.toAmountMin * 1_000_000n < (q.toAmount * BigInt(Math.round((1 - e.slippage) * 1e6)))) {
    warnings.push("Jumlah minimum diterima lebih rendah dari batas slippage yang dipilih (rute bertahap).");
  }

  const gap = valueGapPct(q);
  if (gap !== null && gap > 50) reject(`Anda akan kehilangan sekitar ${gap.toFixed(0)}% nilai. Quote ditolak.`);
  if (gap !== null && gap > 3) warnings.push(`Selisih nilai bayar vs terima sekitar ${gap.toFixed(1)}% (termasuk biaya dan price impact).`);

  const tx = q.tx;
  if (tx.chainId !== e.fromChain) reject("Chain ID transaksi tidak sesuai jaringan asal.");
  const allowed = e.allowedTargets.map(lc);
  if (!allowed.includes(lc(tx.to))) reject("Kontrak tujuan transaksi tidak ada di daftar yang diizinkan. Quote ditolak demi keamanan.");
  if (tx.from && lc(tx.from) !== lc(e.owner)) reject("Pengirim pada transaksi bukan alamat Anda.");
  if (!/^0x([0-9a-fA-F]{2})+$/.test(tx.data) || tx.data.length > 2 + 2 * 65_536) reject("Calldata transaksi tidak valid.");
  if (!lc(tx.data).includes(lc(e.owner).slice(2))) reject("Alamat penerima Anda tidak ditemukan di dalam calldata. Quote ditolak.");

  // Nilai native yang dikirim bersama transaksi.
  const nativeFees = q.feeCosts.filter((f) => lc(f.token.address) === ZERO_ADDRESS).reduce((a, f) => a + f.amount, 0n);
  const allowance = (nativeFees * 110n) / 100n; // toleransi pembulatan 10%
  if (nativeSource) {
    if (tx.value < e.fromAmount) reject("Nilai transaksi lebih kecil dari jumlah yang Anda bayar.");
    if (tx.value - e.fromAmount > allowance) reject("Transaksi meminta native tambahan yang tidak dijelaskan di rincian biaya. Ditolak.");
  } else if (tx.value > allowance) {
    reject("Transaksi mengirim native yang tidak dijelaskan di rincian biaya. Ditolak.");
  }

  // Spender approval harus kontrak yang diizinkan.
  if (!nativeSource) {
    if (!q.approvalAddress) reject("Quote tidak menyertakan alamat approval.");
    else if (!allowed.includes(lc(q.approvalAddress))) reject("Alamat approval tidak ada di daftar kontrak yang diizinkan. Ditolak.");
  }

  if (e.slippage > 0.01) warnings.push("Slippage di atas 1% meningkatkan risiko output lebih rendah dari perkiraan.");
  return warnings;
}
