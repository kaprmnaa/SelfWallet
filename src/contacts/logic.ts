import { getAddress } from "ethers";
import { base58 } from "@scure/base";

/** Logika murni buku alamat (tanpa React/jaringan) agar mudah diuji. */
export type ContactKind = "evm" | "btc" | "sol";

export type Contact = {
  id: string;
  name: string;
  /** Alamat ternormalisasi (EVM: checksum EIP-55). */
  address: string;
  kind: ContactKind;
  note?: string;
  createdAt: number;
  updatedAt: number;
};

export const MAX_CONTACTS = 200;
export const KIND_NAME: Record<ContactKind, string> = { evm: "EVM", btc: "Bitcoin", sol: "Solana" };

const BECH32 = /^(bc1|tb1|bcrt1)[0-9a-z]{8,87}$/;
const BASE58_BTC = /^[13mn2][1-9A-HJ-NP-Za-km-z]{25,39}$/;

/** Validasi + normalisasi alamat per jenis jaringan. Melempar galat berbahasa Indonesia jika tidak valid. */
export function normalizeAddress(kind: ContactKind, raw: string): string {
  const a = raw.trim();
  if (!a) throw new Error("Alamat tidak boleh kosong.");
  if (kind === "evm") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error("Alamat EVM harus berformat 0x + 40 karakter heksadesimal.");
    try {
      return getAddress(a); // alamat huruf campuran divalidasi checksum-nya
    } catch {
      throw new Error("Checksum alamat EVM salah. Periksa kembali alamatnya.");
    }
  }
  if (kind === "sol") {
    let b: Uint8Array;
    try {
      b = base58.decode(a);
    } catch {
      throw new Error("Alamat Solana tidak valid.");
    }
    if (b.length !== 32) throw new Error("Alamat Solana tidak valid (panjang harus 32 byte).");
    return a;
  }
  // Bitcoin: bech32 tidak boleh huruf campuran; validasi penuh terhadap jaringan dilakukan saat transaksi disusun.
  if (/^(bc1|tb1|bcrt1)/i.test(a)) {
    if (a !== a.toLowerCase() && a !== a.toUpperCase()) throw new Error("Alamat Bitcoin bech32 tidak boleh huruf campuran.");
    const l = a.toLowerCase();
    if (!BECH32.test(l)) throw new Error("Alamat Bitcoin tidak valid.");
    return l;
  }
  if (!BASE58_BTC.test(a)) throw new Error("Alamat Bitcoin tidak valid.");
  return a;
}

/** Dua alamat sama? EVM dan bech32 tidak membedakan huruf besar/kecil; base58 membedakan. */
export function sameAddress(kind: ContactKind, a: string, b: string): boolean {
  if (kind === "evm") return a.toLowerCase() === b.toLowerCase();
  if (kind === "btc" && /^(bc1|tb1|bcrt1)/i.test(a)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export const findContact = (contacts: Contact[], kind: ContactKind, address: string): Contact | undefined =>
  contacts.find((c) => c.kind === kind && sameAddress(kind, c.address, address));

export const cleanName = (raw: string) => raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Validasi input kontak baru/ubah. `editingId` dikecualikan dari pengecekan duplikat.
 * Nama unik (tanpa membedakan huruf besar/kecil) agar pemilihan tidak ambigu; satu alamat satu kontak per jenis jaringan.
 */
export function validateContact(
  existing: Contact[],
  input: { name: string; address: string; kind: ContactKind; note?: string },
  editingId?: string,
): { name: string; address: string; kind: ContactKind; note?: string } {
  const name = cleanName(input.name);
  if (name.length < 1 || name.length > 24) throw new Error("Nama 1 sampai 24 karakter.");
  const note = input.note ? cleanName(input.note) : "";
  if (note.length > 60) throw new Error("Catatan maksimal 60 karakter.");
  const address = normalizeAddress(input.kind, input.address);
  const others = existing.filter((c) => c.id !== editingId);
  if (!editingId && others.length >= MAX_CONTACTS) throw new Error(`Maksimal ${MAX_CONTACTS} kontak.`);
  if (others.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error(`Nama "${name}" sudah dipakai kontak lain.`);
  const dup = findContact(others, input.kind, address);
  if (dup) throw new Error(`Alamat ini sudah tersimpan sebagai "${dup.name}".`);
  return { name, address, kind: input.kind, note: note || undefined };
}

/** Bentuk data tersimpan dipercaya setengah: validasi saat dibaca dari penyimpanan. */
export function isContact(x: unknown): x is Contact {
  const o = x as Contact;
  if (!o || typeof o !== "object") return false;
  if (typeof o.id !== "string" || typeof o.name !== "string" || typeof o.address !== "string") return false;
  if (o.kind !== "evm" && o.kind !== "btc" && o.kind !== "sol") return false;
  if (o.note !== undefined && typeof o.note !== "string") return false;
  return Number.isFinite(o.createdAt) && Number.isFinite(o.updatedAt) && o.name.length <= 24 && o.address.length <= 100;
}

/** Aturan whitelist: aktif -> hanya alamat di kontak (atau alamat wallet sendiri) yang boleh menerima. */
export function isRecipientAllowed(
  strict: boolean,
  contacts: Contact[],
  kind: ContactKind,
  recipient: string,
  self?: string | null,
): boolean {
  if (!strict) return true;
  let norm: string;
  try {
    norm = normalizeAddress(kind, recipient);
  } catch {
    return false;
  }
  if (self && sameAddress(kind, norm, self)) return true;
  return !!findContact(contacts, kind, norm);
}
