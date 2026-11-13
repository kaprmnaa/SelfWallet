import { HDNodeWallet, Mnemonic, Wallet, isHexString } from "ethers";

export type Account = Wallet | HDNodeWallet;

export function createAccount(): HDNodeWallet {
  // CSPRNG milik browser (crypto.getRandomValues) lewat ethers.
  return Wallet.createRandom() as HDNodeWallet;
}

export function accountFromPhrase(phrase: string): HDNodeWallet {
  const clean = phrase.trim().toLowerCase().split(/\s+/).join(" ");
  if (!Mnemonic.isValidMnemonic(clean)) {
    throw new Error("Recovery phrase tidak valid. Periksa jumlah kata (12/15/18/21/24) dan ejaannya.");
  }
  return HDNodeWallet.fromPhrase(clean); // m/44'/60'/0'/0/0
}

export function accountFromPrivateKey(key: string): Wallet {
  const k = key.trim();
  const hex = k.startsWith("0x") ? k : `0x${k}`;
  if (!isHexString(hex, 32)) throw new Error("Private key harus 64 karakter heksadesimal.");
  return new Wallet(hex);
}

export function passwordStrength(pw: string) {
  let s = 0;
  if (pw.length >= 12) s++;
  if (pw.length >= 16) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.trim().split(/\s+/).length >= 4 && pw.length >= 20) s += 2; // passphrase panjang
  if (/(.)\1{3,}/.test(pw)) s--;
  if (new Set(pw).size < 6) s = Math.min(s, 1);
  const score = Math.max(0, Math.min(4, s));
  return {
    score,
    ok: pw.length >= 12 && score >= 3,
    label: ["Sangat lemah", "Lemah", "Cukup", "Kuat", "Sangat kuat"][score],
  };
}

export async function encryptAccount(
  account: Account,
  password: string,
  onProgress?: (p: number) => void,
): Promise<string> {
  if (!passwordStrength(password).ok) throw new Error("Password terlalu lemah.");
  // Keystore V3 (scrypt). Pada HDNodeWallet, mnemonic ikut terenkripsi di dalamnya.
  return account.encrypt(password, onProgress);
}

export async function unlockKeystore(
  json: string,
  password: string,
  onProgress?: (p: number) => void,
): Promise<Account> {
  return Wallet.fromEncryptedJson(json, password, onProgress);
}
