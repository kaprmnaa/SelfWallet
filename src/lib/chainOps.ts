import { kindOf, type ChainConfig } from "./chains";
import { checkReceipt } from "./tx";
import { withProvider } from "./rpc";
import { btcTip, btcTxStatus } from "../chains/bitcoin/esplora";
import { solSlot, solTxStatus } from "../chains/solana/rpc";

/** Status transaksi untuk semua jenis jaringan. */
export async function checkTx(chain: ChainConfig, hash: string): Promise<"pending" | "success" | "failed"> {
  switch (kindOf(chain)) {
    case "btc":
      return btcTxStatus(chain, hash);
    case "sol":
      return solTxStatus(chain, hash);
    default:
      return checkReceipt(chain, hash);
  }
}

/** Tinggi blok (EVM/Bitcoin) atau slot (Solana) terbaru. */
export async function getTip(chain: ChainConfig): Promise<number> {
  switch (kindOf(chain)) {
    case "btc":
      return btcTip(chain);
    case "sol":
      return solSlot(chain);
    default:
      return withProvider(chain, (p) => p.getBlockNumber());
  }
}
