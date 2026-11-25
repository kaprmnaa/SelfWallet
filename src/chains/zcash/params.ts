/**
 * Parameter konsensus Zcash mainnet yang dibutuhkan untuk menandatangani transaksi v5 (ZIP-225/244).
 *
 * PERHATIAN: branch ID berubah di setiap network upgrade, dan transaksi yang ditandatangani dengan branch ID lama
 * DITOLAK jaringan (aman: tidak ada dana yang hilang, kirim hanya gagal). Setiap Zcash network upgrade baru,
 * tabel ini wajib diperbarui. Sumber: ZIP-200, ZIP-250, ZIP-251, ZIP-255.
 */
export type Upgrade = { name: string; height: number; branchId: number };

export const UPGRADES: Upgrade[] = [
  { name: "NU5", height: 1_687_104, branchId: 0xc2d6d0b4 },
  { name: "NU6", height: 2_726_400, branchId: 0xc8e71055 },
  { name: "NU6.1", height: 3_146_400, branchId: 0x4dec4df0 },
];

/** Branch ID yang berlaku untuk blok pada `height` (blok berikutnya setelah tip). */
export function branchIdAt(height: number): number {
  let cur: Upgrade | null = null;
  for (const u of UPGRADES) if (height >= u.height) cur = u;
  if (!cur) throw new Error("Tinggi blok di bawah NU5: format transaksi v5 belum berlaku.");
  return cur.branchId;
}

/** Transaksi kedaluwarsa setelah sekian blok (ZIP-203). */
export const TX_EXPIRY_DELTA = 40;
