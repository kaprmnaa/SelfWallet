import { Contract, Interface, getAddress, type JsonRpcProvider } from "ethers";
import type { ChainConfig } from "./chains";
import { assertChain, withProvider } from "./rpc";

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];
const iface = new Interface(ERC20_ABI);

export type TokenInfo = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
};

export function encodeTransfer(to: string, amount: bigint): string {
  return iface.encodeFunctionData("transfer", [to, amount]);
}

export async function tokenBalanceOn(p: JsonRpcProvider, token: TokenInfo, owner: string): Promise<bigint> {
  const c = new Contract(token.address, ERC20_ABI, p);
  return (await c.balanceOf(owner)) as bigint;
}

export function tokenBalance(chain: ChainConfig, token: TokenInfo, owner: string): Promise<bigint> {
  return withProvider(chain, (p) => tokenBalanceOn(p, token, owner));
}

/** Validasi contract: harus ada kode di alamat itu dan menjawab name/symbol/decimals. */
export async function fetchTokenInfo(chain: ChainConfig, raw: string): Promise<TokenInfo> {
  let address: string;
  try {
    address = getAddress(raw.trim());
  } catch {
    throw new Error("Alamat contract tidak valid atau checksum salah.");
  }
  return withProvider(chain, async (p) => {
    await assertChain(p, chain);
    const code = await p.getCode(address);
    if (code === "0x") throw new Error("Tidak ada contract di alamat ini pada jaringan terpilih.");
    const c = new Contract(address, ERC20_ABI, p);
    try {
      const [name, symbol, decimals] = await Promise.all([
        c.name() as Promise<string>,
        c.symbol() as Promise<string>,
        c.decimals() as Promise<bigint>,
      ]);
      const dec = Number(decimals);
      if (!Number.isInteger(dec) || dec < 0 || dec > 36) throw new Error("decimals tidak wajar");
      return { address, name: String(name).slice(0, 48), symbol: String(symbol).slice(0, 16), decimals: dec };
    } catch {
      throw new Error("Contract ini tidak mengikuti standar ERC-20 (name/symbol/decimals).");
    }
  });
}

// Pintasan token populer dipindah ke ./presets (berkas murni, tanpa dependensi) agar bisa diuji.
export { PRESETS } from "./presets";
