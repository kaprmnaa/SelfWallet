/**
 * Logika pemindaian alamat (murni, tanpa jaringan, bisa diuji).
 *
 * Aturan gap limit: semua indeks dalam (lastUsed, lastUsed + gap] harus sudah diperiksa dan terbukti belum
 * dipakai. Fungsi ini menghitung indeks mana yang BELUM diperiksa.
 */
export function missingWindow(known: Set<number>, lastUsed: number, gap: number): number[] {
  const need: number[] = [];
  for (let i = lastUsed + 1; i <= lastUsed + gap; i++) if (!known.has(i)) need.push(i);
  return need;
}

export type Hint = { last: number; funded: number[] };

/**
 * Pindai ulang secara hemat memakai petunjuk dari pemindaian sebelumnya: periksa lagi alamat yang pernah
 * berisi dana dan beberapa alamat terakhir yang dipakai (faucet/pengirim sering memakai ulang alamat lama).
 */
export function hintCandidates(hint: Hint | undefined, recent = 4): number[] {
  if (!hint || hint.last < 0) return [];
  const set = new Set<number>(hint.funded);
  for (let i = Math.max(0, hint.last - recent); i <= hint.last; i++) set.add(i);
  return [...set].sort((a, b) => a - b);
}
