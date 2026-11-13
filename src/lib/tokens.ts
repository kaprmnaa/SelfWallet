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

/**
 * Pintasan token populer (mainnet saja). Alamat TIDAK dipercaya begitu saja:
 * saat dipakai, contract dicek on-chain dan simbolnya harus cocok.
 * Verifikasi tetap ke sumber resmi penerbit sebelum mengirim dana besar.
 */
export const PRESETS: Record<number, { symbol: string; address: string }[]> = {
  1: [
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  ],
  56: [
    { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955" },
    { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
  ],
  137: [
    { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
    { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
  ],
  8453: [
    { symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2" },
    { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  ],
};
