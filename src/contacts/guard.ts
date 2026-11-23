import { getContacts, getStrict } from "./store";
import { isRecipientAllowed, type ContactKind } from "./logic";

/**
 * Penegak whitelist di titik penandatanganan (selain di UI): jika whitelist aktif, penerima harus ada di Kontak
 * (atau alamat wallet sendiri). Komitmen di dalam aplikasi, bukan penguncian kriptografis.
 */
export function assertRecipientAllowed(kind: ContactKind, recipient: string, self?: string | null): void {
  if (!getStrict()) return;
  if (!isRecipientAllowed(true, getContacts(), kind, recipient, self)) {
    throw new Error("Whitelist aktif: alamat penerima tidak ada di Kontak. Tambahkan ke Kontak atau matikan whitelist di tab Kontak.");
  }
}
