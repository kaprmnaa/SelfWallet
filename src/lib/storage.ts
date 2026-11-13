// Hanya untuk data NON-rahasia (preferensi, daftar token, riwayat hash).
// Jangan pernah menyimpan password, recovery phrase, atau private key di sini.
const PREFIX = "kunci:v1:";

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* penyimpanan penuh atau diblokir: abaikan */
  }
}

export function remove(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* diblokir: abaikan */
  }
}
