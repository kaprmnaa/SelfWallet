export type ChainKind = "evm" | "btc" | "sol" | "zec";

export type ChainConfig = {
  /** Kosong = "evm" (semua jaringan lama dan jaringan kustom). */
  kind?: ChainKind;
  /** Untuk non-EVM ini id internal aplikasi (bukan chain ID di jaringan). */
  chainId: number;
  name: string;
  symbol: string;
  testnet: boolean;
  /** Urutan = prioritas. EVM/Solana: URL JSON-RPC. Bitcoin: base URL Esplora (mempool.space / blockstream). */
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
  // ---- Bitcoin (UTXO, Native SegWit BIP-84) ----
  {
    kind: "btc",
    chainId: 900_000_002,
    name: "Bitcoin Testnet4",
    symbol: "tBTC",
    testnet: true,
    rpcUrls: ["https://mempool.space/testnet4/api"],
    explorer: "https://mempool.space/testnet4",
  },
  {
    kind: "btc",
    chainId: 900_000_001,
    name: "Bitcoin",
    symbol: "BTC",
    testnet: false,
    rpcUrls: ["https://mempool.space/api", "https://blockstream.info/api"],
    explorer: "https://mempool.space",
  },
  // ---- Solana (Ed25519, akun pertama m/44'/501'/0'/0') ----
  {
    kind: "sol",
    chainId: 900_000_102,
    name: "Solana Devnet",
    symbol: "SOL",
    testnet: true,
    rpcUrls: ["https://api.devnet.solana.com"],
    explorer: "https://explorer.solana.com",
  },
  {
    kind: "sol",
    chainId: 900_000_101,
    name: "Solana",
    symbol: "SOL",
    testnet: false,
    // api.mainnet-beta.solana.com sering menjawab 403 untuk lalu lintas dari browser, jadi dipasang terakhir.
    rpcUrls: ["https://solana-rpc.publicnode.com", "https://api.mainnet.solana.com", "https://api.mainnet-beta.solana.com"],
    explorer: "https://explorer.solana.com",
  },
  {
    // Zcash TRANSPARENT saja (t1…): alamat shielded (z/u) butuh bukti zk-SNARK dan tidak didukung.
    // Endpoint utama: JSON-RPC Zebra (Tatum), cadangan: Blockchair. Bisa diganti lewat "Cek koneksi dan endpoint"
    // (mis. tambahkan ?key=API_KEY). lightwalletd (gRPC) tidak bisa dipakai langsung dari browser.
    kind: "zec",
    chainId: 900_000_201,
    name: "Zcash (transparent)",
    symbol: "ZEC",
    testnet: false,
    rpcUrls: ["https://zcash-mainnet-zebrad.gateway.tatum.io", "https://api.blockchair.com/zcash"],
    explorer: "https://blockexplorer.one/zcash/mainnet",
  },
];

export const getChain = (id: number) => CHAINS.find((c) => c.chainId === id);

export const kindOf = (c: ChainConfig): ChainKind => c.kind ?? "evm";

/** Label singkat di daftar jaringan: "chain 1" untuk EVM, "UTXO" untuk Bitcoin, "Ed25519" untuk Solana. */
export function chainTag(c: ChainConfig): string {
  const k = kindOf(c);
  return k === "evm" ? `chain ${c.chainId}` : k === "btc" || k === "zec" ? "UTXO" : "Ed25519";
}

/** Tautan explorer; null jika jaringan kustom tidak punya explorer. Solana devnet butuh ?cluster=devnet. */
export function explorerTx(c: ChainConfig, hash: string): string | null {
  if (!c.explorer) return null;
  const q = kindOf(c) === "sol" && c.testnet ? "?cluster=devnet" : "";
  return `${c.explorer}/tx/${hash}${q}`;
}
export function explorerAddress(c: ChainConfig, address: string): string | null {
  if (!c.explorer) return null;
  const q = kindOf(c) === "sol" && c.testnet ? "?cluster=devnet" : "";
  return `${c.explorer}/address/${address}${q}`;
}
