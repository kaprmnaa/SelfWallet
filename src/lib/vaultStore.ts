import { getAddress } from "ethers";
import { load, remove, save } from "./storage";

/**
 * Menyimpan KEYSTORE TERENKRIPSI (bukan password, bukan phrase, bukan private key).
 * Tanpa password masing-masing wallet, file ini tidak bisa dipakai.
 * Pengguna memilih sendiri (opt-in) dan bisa menghapusnya kapan saja.
 */
export type SavedWallet = { id: string; name: string; address: string; json: string };

const KEY = "wallets";

export function cleanName(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 24);
}

/** "Main A", "Main B", ... lalu "Main 27", dst. Mengambil nama pertama yang belum dipakai. */
export function nextWalletName(taken: string[]): string {
  const set = new Set(taken.map((n) => n.toLowerCase()));
  for (let i = 0; i < 500; i++) {
    const label = i < 26 ? `Main ${String.fromCharCode(65 + i)}` : `Main ${i + 1}`;
    if (!set.has(label.toLowerCase())) return label;
  }
  return `Main ${taken.length + 1}`;
}

function addressFromJson(json: string): string | null {
  try {
    const raw = String(JSON.parse(json).address ?? "");
    return raw ? getAddress(raw.startsWith("0x") ? raw : `0x${raw}`) : null;
  } catch {
    return null;
  }
}

export function loadWallets(): SavedWallet[] {
  const raw = load<unknown>(KEY, []);
  let list: SavedWallet[] = Array.isArray(raw)
    ? raw.filter(
        (w): w is SavedWallet =>
          !!w &&
          typeof (w as SavedWallet).id === "string" &&
          typeof (w as SavedWallet).name === "string" &&
          typeof (w as SavedWallet).address === "string" &&
          typeof (w as SavedWallet).json === "string",
      )
    : [];

  // Migrasi dari versi sebelumnya (hanya satu keystore tersimpan).
  const legacy = load<{ json?: string; address?: string } | null>("vault", null);
  if (legacy && typeof legacy.json === "string") {
    const addr = addressFromJson(legacy.json) ?? String(legacy.address ?? "wallet-lama");
    const id = addr.toLowerCase();
    if (!list.some((w) => w.id === id)) {
      list = [...list, { id, name: nextWalletName(list.map((w) => w.name)), address: addr, json: legacy.json }];
    }
    save(KEY, list);
    remove("vault");
  }
  return list;
}

export function suggestName(sessionNames: string[] = []): string {
  return nextWalletName([...loadWallets().map((w) => w.name), ...sessionNames]);
}

/** Simpan atau perbarui (berdasarkan alamat). Nama lama dipertahankan jika wallet sudah tersimpan. */
export function saveWallet(address: string, json: string, name: string): SavedWallet {
  const list = loadWallets();
  const id = address.toLowerCase();
  const i = list.findIndex((w) => w.id === id);
  const rec: SavedWallet = {
    id,
    address,
    json,
    name: i >= 0 ? list[i].name : cleanName(name) || nextWalletName(list.map((w) => w.name)),
  };
  save(KEY, i >= 0 ? list.map((w, k) => (k === i ? rec : w)) : [...list, rec]);
  return rec;
}

export function renameSaved(id: string, name: string) {
  const list = loadWallets();
  if (!list.some((w) => w.id === id)) return;
  save(KEY, list.map((w) => (w.id === id ? { ...w, name: cleanName(name) } : w)));
}

export function removeSaved(id: string) {
  save(KEY, loadWallets().filter((w) => w.id !== id));
}

export function clearWallets() {
  remove(KEY);
  remove("vault");
}
