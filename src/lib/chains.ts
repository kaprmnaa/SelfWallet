export type ChainConfig = {
  chainId: number;
  name: string;
  symbol: string;
  testnet: boolean;
  /** Urutan = prioritas. RPC berikutnya dipakai jika yang sebelumnya gagal. */
  rpcUrls: string[];
  /** Kosong jika jaringan kustom tidak punya block explorer. */
  explorer: string;
  /** true untuk jaringan yang ditambahkan pengguna. */
  custom?: boolean;
};

// PENTING: setiap host RPC di sini harus ada juga di connect-src (netlify.toml).
// Endpoint publik bukan SLA produksi; ganti dengan provider tepercaya bila perlu.
export const CHAINS: ChainConfig[] = [
  {
    chainId: 11155111,
    name: "Ethereum Sepolia",
    symbol: "ETH",
    testnet: true,
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    explorer: "https://sepolia.etherscan.io",
  },
  {
    chainId: 97,
    name: "BNB Chain Testnet",
    symbol: "tBNB",
    testnet: true,
    rpcUrls: ["https://bsc-testnet-rpc.publicnode.com"],
    explorer: "https://testnet.bscscan.com",
  },
  {
    chainId: 80002,
    name: "Polygon Amoy",
    symbol: "POL",
    testnet: true,
    rpcUrls: ["https://rpc-amoy.polygon.technology", "https://polygon-amoy-bor-rpc.publicnode.com"],
    explorer: "https://amoy.polygonscan.com",
  },
  {
    chainId: 84532,
    name: "Base Sepolia",
    symbol: "ETH",
    testnet: true,
    rpcUrls: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
    explorer: "https://sepolia.basescan.org",
  },
  {
    chainId: 1,
    name: "Ethereum",
    symbol: "ETH",
    testnet: false,
    rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth"],
    explorer: "https://etherscan.io",
  },
  {
    chainId: 56,
    name: "BNB Smart Chain",
    symbol: "BNB",
    testnet: false,
    rpcUrls: ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com"],
    explorer: "https://bscscan.com",
  },
  {
    chainId: 137,
    name: "Polygon",
    symbol: "POL",
    testnet: false,
    rpcUrls: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"],
    explorer: "https://polygonscan.com",
  },
  {
    chainId: 8453,
    name: "Base",
    symbol: "ETH",
    testnet: false,
    rpcUrls: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    explorer: "https://basescan.org",
  },
];

export const getChain = (id: number) => CHAINS.find((c) => c.chainId === id);
