import type { SwapExecution } from "../domain/types";

/** Instruksi pemulihan. Tidak menjanjikan refund otomatis: itu tergantung protokol dan status transaksi. */
export function recoveryGuide(e: SwapExecution): string | null {
  const cross = e.from.chainId !== e.to.chainId;
  switch (e.state) {
    case "failed":
      return "Transaksi sumber gagal di chain (revert). Dana swap tidak berpindah; hanya biaya gas yang terpakai. Anda bisa mencoba lagi dengan quote baru.";
    case "refunded":
      return "Penyedia melaporkan dana dikembalikan. Periksa saldo aset asal pada jaringan sumber.";
    case "recovery_required":
      return `Transaksi sumber sudah terkirim, tetapi proses ${cross ? "lintas chain" : "swap"} belum bisa dipastikan selesai. Jangan kirim ulang transaksi. Simpan hash transaksi sumber, buka explorer jaringan sumber, lalu hubungi dukungan penyedia (${e.provider.toUpperCase()}) dengan hash tersebut. Refund tidak dijamin otomatis.`;
    case "bridging":
      return "Transaksi sumber sudah terkonfirmasi dan sedang diproses lintas chain. Ini bisa memakan waktu. Jangan kirim ulang; status diperbarui otomatis.";
    default:
      return null;
  }
}
