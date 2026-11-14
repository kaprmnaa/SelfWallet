import type { BtcUtxo } from "./account";

/** Ambang dust konservatif (output di bawah ini ditolak node relay standar). */
export const DUST = 546n;

const OVERHEAD_VB = 10.5; // versi, locktime, jumlah in/out, marker + flag SegWit
const P2WPKH_INPUT_VB = 68;
export const P2WPKH_SCRIPT_LEN = 22;

export const vsize = (inputs: number, outputScriptLens: number[]) =>
  Math.ceil(OVERHEAD_VB + inputs * P2WPKH_INPUT_VB + outputScriptLens.reduce((a, l) => a + 9 + l, 0));

const feeFor = (inputs: number, lens: number[], rate: number) => BigInt(Math.ceil(vsize(inputs, lens) * rate));

export type Selection = { inputs: BtcUtxo[]; fee: bigint; change: bigint; vsize: number };

// Hanya UTXO TERKONFIRMASI yang dipakai (menghindari rantai transaksi yang bisa tergantikan).
const spendable = (utxos: BtcUtxo[]) =>
  utxos.filter((u) => u.confirmed).sort((a, b) => (a.value < b.value ? 1 : a.value > b.value ? -1 : 0));

/** Terbesar dulu agar jumlah input (dan fee) minimal. Kembalian di bawah dust dilebur ke fee. */
export function selectCoins(utxos: BtcUtxo[], amount: bigint, rate: number, recipientLen: number): Selection {
  const sel: BtcUtxo[] = [];
  let total = 0n;
  for (const u of spendable(utxos)) {
    sel.push(u);
    total += u.value;
    const feeC = feeFor(sel.length, [recipientLen, P2WPKH_SCRIPT_LEN], rate);
    if (total < amount + feeC) continue;
    const change = total - amount - feeC;
    if (change >= DUST) return { inputs: [...sel], fee: feeC, change, vsize: vsize(sel.length, [recipientLen, P2WPKH_SCRIPT_LEN]) };
    // kembalian terlalu kecil: tanpa output change, selisihnya menjadi fee
    return { inputs: [...sel], fee: total - amount, change: 0n, vsize: vsize(sel.length, [recipientLen]) };
  }
  throw new Error("Saldo terkonfirmasi tidak cukup untuk jumlah + fee.");
}

/** Kirim semua saldo terkonfirmasi: jumlah = total - fee, tanpa kembalian. */
export function selectMax(utxos: BtcUtxo[], rate: number, recipientLen: number): Selection & { amount: bigint } {
  const inputs = spendable(utxos);
  if (inputs.length === 0) throw new Error("Tidak ada saldo terkonfirmasi yang bisa dikirim.");
  const total = inputs.reduce((a, u) => a + u.value, 0n);
  const fee = feeFor(inputs.length, [recipientLen], rate);
  const amount = total - fee;
  if (amount < DUST) throw new Error("Saldo terlalu kecil setelah dikurangi fee.");
  return { inputs, fee, change: 0n, amount, vsize: vsize(inputs.length, [recipientLen]) };
}
