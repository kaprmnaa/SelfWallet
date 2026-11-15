import { PRESETS } from "../lib/presets";

/** Jaringan swap yang didukung (EVM mainnet bawaan). LI.FI tidak punya testnet. */
export const SWAP_CHAIN_IDS = [1, 56, 137, 8453];

/**
 * Kontrak yang boleh menerima calldata dan approval. Dokumentasi LI.FI: "LI.FI Diamond, kontrak
 * ter-audit yang di-deploy di semua chain yang didukung", alamat 0x1231DEB6…4EaE. Jika sebuah
 * rute memakai kontrak lain, swap DITOLAK (gagal aman). Tambahkan alamat hanya setelah
 * memverifikasinya ke sumber resmi LI.FI.
 */
export const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
export const allowedTargets = (chainId: number): string[] => (SWAP_CHAIN_IDS.includes(chainId) ? [LIFI_DIAMOND] : []);

/** Pintasan token tujuan (alamat dari lib/tokens.ts; selalu diverifikasi on-chain: simbol harus cocok). */
export const swapPresets = (chainId: number) => PRESETS[chainId] ?? [];

export const MAX_SLIPPAGE = 0.03; // batas keras 3%
export const SLIPPAGE_OPTIONS = [0.005, 0.01, 0.03];
