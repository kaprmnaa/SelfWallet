export type GoalUnit = "usd" | "native";
export type GoalStatus = "active" | "achieved" | "cancelled";

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
  /** Lokal saja: berapa evaluasi berturut-turut yang sudah mencapai target. */
  hits?: number;
};

export type Snapshot = { goalId: string; ts: number; value: number };
