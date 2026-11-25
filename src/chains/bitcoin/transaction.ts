import * as btc from "@scure/btc-signer";
import { formatUnits } from "ethers";
import type { ChainConfig } from "../../lib/chains";
import type { Account } from "../../lib/vault";
import { parseAmount } from "../../lib/tx";
import { assertCanSpend } from "../../goals/guard";
import { assertRecipientAllowed } from "../../contacts/guard";
import { assertTxAuthorized } from "../../txauth/store";
import {
  NEED_PHRASE,
  btcAccountNode,
  btcAddressAt,
  btcNet,
  btcNetwork,
  btcPrivateKeyAt,
  getSeed,
} from "../../core/derive";
import { invalidateBtc, scanBtc, type BtcUtxo } from "./account";
import { broadcastTx } from "./esplora";
import { feeQuote, type FeeTier } from "./fees";
import { DUST, selectCoins, selectMax } from "./coin-selection";

export type BtcPrepared = {
  chain: ChainConfig;
  ownerKey: string;
  to: string;
  amount: bigint;
  fee: bigint;
  feeRate: number;
  vsize: number;
  inputs: BtcUtxo[];
  change: bigint;
  changeAddress: string | null;
  unconfirmed: bigint;
  createdAt: number;
};

/** Validasi alamat tujuan terhadap jaringan; mengembalikan panjang scriptPubKey untuk estimasi ukuran. */
export function validateBtcAddress(chain: ChainConfig, raw: string): { address: string; scriptLen: number } {
  const network = btcNetwork(btcNet(chain.testnet));
  const address = raw.trim();
  try {
    const decoded = btc.Address(network).decode(address);
    return { address, scriptLen: btc.OutScript.encode(decoded).length };
  } catch {
    throw new Error(`Alamat Bitcoin tidak valid untuk jaringan ${chain.name}.`);
  }
}

/** Validasi + pilih UTXO + hitung fee. Tidak menandatangani apa pun. */
export async function prepareBtc(
  chain: ChainConfig,
  account: Account,
  input: { to: string; amount: string; max: boolean; tier: FeeTier },
): Promise<BtcPrepared> {
  const { address, scriptLen } = validateBtcAddress(chain, input.to);
  const scan = await scanBtc(chain, account, true); // data terbaru sebelum membelanjakan
  if (!scan) throw new Error(NEED_PHRASE);
  const rate = (await feeQuote(chain))[input.tier];

  let amount: bigint;
  let sel;
  if (input.max) {
    const m = selectMax(scan.utxos, rate, scriptLen);
    amount = m.amount;
    sel = m;
  } else {
    amount = parseAmount(input.amount, 8);
    if (amount < DUST) throw new Error(`Jumlah di bawah batas dust (${DUST} sat).`);
    sel = selectCoins(scan.utxos, amount, rate, scriptLen);
  }

  return {
    chain,
    ownerKey: scan.ownerKey,
    to: address,
    amount,
    fee: sel.fee,
    feeRate: rate,
    vsize: sel.vsize,
    inputs: sel.inputs,
    change: sel.change,
    changeAddress: sel.change > 0n ? scan.changeAddress : null,
    unconfirmed: scan.unconfirmed,
    createdAt: Date.now(),
  };
}

/** Tandatangani lokal, periksa kesesuaian dengan ringkasan, lalu siarkan. Mengembalikan txid. */
export async function signAndSendBtc(account: Account, p: BtcPrepared): Promise<string> {
  assertRecipientAllowed("btc", p.to);
  await assertCanSpend(account, p.chain, { native: Number(formatUnits(p.amount + p.fee, 8)) });
  assertTxAuthorized(account, { kind: "btc", chainId: p.chain.chainId, to: p.to });
  const seed = getSeed(account);
  if (!seed) throw new Error(NEED_PHRASE);
  const net = btcNet(p.chain.testnet);
  const network = btcNetwork(net);
  const node = btcAccountNode(seed, net);

  const tx = new btc.Transaction();
  for (const u of p.inputs) {
    const a = btcAddressAt(node, net, u.branch, u.index);
    tx.addInput({
      txid: u.txid,
      index: u.vout,
      sequence: 0xfffffffd, // opt-in RBF
      witnessUtxo: { script: a.script, amount: u.value },
    });
  }
  tx.addOutputAddress(p.to, p.amount, network);
  if (p.change > 0n) tx.addOutputAddress(p.changeAddress!, p.change, network);

  p.inputs.forEach((u, i) => tx.signIdx(btcPrivateKeyAt(node, u.branch, u.index), i));
  tx.finalize();

  // Cek integritas: yang ditandatangani harus sama dengan yang ditinjau pengguna.
  const sumIn = p.inputs.reduce((a, u) => a + u.value, 0n);
  const expectedOuts = p.change > 0n ? 2 : 1;
  if (
    tx.outputsLength !== expectedOuts ||
    tx.getOutput(0).amount !== p.amount ||
    sumIn - (p.amount + p.change) !== p.fee
  ) {
    throw new Error("Transaksi bertanda tangan tidak cocok dengan ringkasan. Dibatalkan.");
  }

  const txid = await broadcastTx(p.chain, tx.hex);
  invalidateBtc(p.chain, p.ownerKey);
  return txid || tx.id;
}

export const btcAmount = (sats: bigint) => formatUnits(sats, 8);
