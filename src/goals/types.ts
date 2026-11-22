export type GoalUnit = "usd" | "native";
export type GoalStatus = "active" | "achieved" | "cancelled";
/**
 * "lock"   : dana goal terkunci sampai target tercapai (tidak bisa ditarik).
 * "unlock" : goal hanya pelacak progres; dananya tetap bebas ditarik.
 * Goal lama tanpa field ini diperlakukan "lock" (perilaku sebelumnya).
 */
export type GoalMode = "lock" | "unlock";

export type Goal = {
  id: string;
  /** Penanda wallet (HMAC dari alamat; alamat asli TIDAK pernah disimpan atau dikirim). */
  ref: string;
  name: string;
  chainId: number;
  unit: GoalUnit;
  start: number;
  target: number;
  status: GoalStatus;
  createdAt: number;
  achievedAt?: number;
  cancelRequestedAt?: number;
  updatedAt: number;
  /** Kosong = "lock" (goal lama). */
  mode?: GoalMode;
  /**
   * Dana yang dialokasikan ke goal ini (dalam satuan goal). Inilah "isi" goal dan, untuk mode lock, jumlah yang terkunci.
   * Kosong = seluruh saldo jaringan (goal lama): mode lock mengunci SEMUA saldo jaringan, mode unlock memakai sisa saldo.
   */
  funded?: number;
  /** Lokal saja: berapa evaluasi berturut-turut yang sudah mencapai target. */
  hits?: number;
};

export type Snapshot = { goalId: string; ts: number; value: number };

/** Kunci waktu untuk SEMUA jaringan satu wallet: tidak ada kirim/swap sampai `until`. Hanya bisa diperpanjang. */
export type TimeLock = {
  ref: string;
  /** epoch ms; kunci aktif selama until > sekarang. */
  until: number;
  createdAt: number;
  updatedAt: number;
};
