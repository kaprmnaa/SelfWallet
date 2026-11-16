# Kunci · Dompet self-custody multi-chain

React + TypeScript + Vite + ethers v6 + Tailwind v3 + Framer Motion + Phosphor Icons.
Jaringan: Ethereum, BNB Smart Chain, Polygon PoS, Base (plus testnet: Sepolia, BNB Testnet, Amoy, Base Sepolia).

## Jalankan lokal

```bash
npm install
npm run dev
```

Perintah instalasi paket yang dipakai (sudah ada di package.json):

```bash
npm install ethers framer-motion @phosphor-icons/react qrcode @fontsource-variable/geist @fontsource-variable/geist-mono
npm install -D tailwindcss@3 postcss autoprefixer @types/qrcode
```

Cek tipe (opsional, tidak dijalankan saat build): `npm run typecheck`

## Deploy ke Netlify

Opsi A, lewat Git:
1. Push folder ini ke repo GitHub/GitLab.
2. Netlify > Add new site > Import from Git.
3. Build command `npm run build`, publish directory `dist` (sudah di netlify.toml).

Opsi B, lewat CLI:

```bash
npm install
npm run build
npx netlify-cli deploy --prod --dir=dist
```

netlify.toml sudah memasang header keamanan: CSP ketat, X-Frame-Options DENY, HSTS, Referrer-Policy no-referrer.

### CSP dan RPC
`connect-src` dibuka untuk `https:` (dan `http://localhost`) supaya jaringan kustom bisa memakai RPC apa pun.
Artinya CSP tidak lagi membatasi tujuan permintaan jaringan; pertahanan utama terhadap XSS tetap `script-src 'self'`.
Jika Anda tidak memakai jaringan kustom, ketatkan dengan mengganti `https:` memakai daftar host RPC di `src/lib/chains.ts`
(ditambah `https://api.coingecko.com` untuk harga). Jangan menaruh API key rahasia di source publik.

## Swap (blueprint v2.0)
Tab **Swap** (jaringan EVM mainnet: Ethereum, BNB Smart Chain, Polygon, Base). Same-chain dan cross-chain EVM lewat **LI.FI**.

Alur: pilih aset, jaringan, dan token tujuan, lalu slippage (0,5% / 1% / 3%) -> quote -> layar tinjau -> (approval jika perlu) -> tanda tangan lokal -> pemantauan status.

- **Layar tinjau** menampilkan: bayar/terima (jaringan, penanda native vs token), minimum diterima, kurs, selisih nilai, gas jaringan asal,
  biaya provider (dipisah dari gas; yang sudah termasuk output diberi keterangan), rute, estimasi waktu, approval, kontrak tujuan, dan hitung mundur quote.
- **Validasi lokal sebelum menandatangani** (`src/swap/quote/validate.ts`): jaringan, token, jumlah, pengirim, penerima (harus alamat Anda), slippage,
  chain ID transaksi, kontrak tujuan dan spender approval (harus ada di daftar kontrak yang diizinkan), nilai native, calldata memuat alamat Anda,
  quote belum kedaluwarsa, penolakan jika kehilangan nilai >50%. Approval selalu **jumlah persis**, bukan unlimited.
- **Status** (`src/swap/state-machine/`): source_submitted -> source_confirmed -> bridging -> completed / refunded / failed / recovery_required.
  Source terkonfirmasi bukan "selesai" untuk lintas chain. Disimpan di browser (non-rahasia), dipantau idempoten, tahan muat ulang.
- **Provider** diabstraksi (`src/swap/providers/provider.ts`); baru LI.FI yang diimplementasikan.

### Batasan yang disengaja (baca sebelum memakai)
- **Tidak ada testnet.** LI.FI tidak mendukung testnet. Menguji swap berarti memakai dana sungguhan: mulai dengan nominal kecil di Base/Polygon.
- **Calldata tidak di-decode penuh.** Validasi memeriksa kontrak tujuan, nilai, chain, dan keberadaan alamat Anda di calldata. Itu mengurangi, bukan menghilangkan, risiko.
- **Daftar kontrak yang diizinkan** hanya berisi LI.FI Diamond (`0x1231DEB6…4EaE`, dari dokumentasi LI.FI). Rute yang memakai kontrak lain ditolak (gagal aman).
- **Belum ada:** swap native BTC (THORChain), swap dari/ke Solana, 1inch (butuh API key + proxy backend), gas sponsorship/intent/gasless.
- Tanpa API key LI.FI, permintaan dibatasi laju oleh penyedia.

## Tes
`npm test` menjalankan uji logika murni (pemilihan UTXO Bitcoin, validasi quote swap, mesin status) tanpa jaringan.

## Koneksi, endpoint, dan diagnosa
Jika saldo atau status jaringan gagal dimuat, aplikasi menampilkan **penyebab sebenarnya** (host, status HTTP, CORS/diblokir) dan tombol
**Cek koneksi dan ubah endpoint**: menguji setiap endpoint jaringan aktif (latensi, status), dan memungkinkan memasang endpoint kustom
(Helius/QuickNode/Alchemy untuk Solana, server Esplora milik sendiri untuk Bitcoin, RPC pribadi untuk EVM). Endpoint kustom hanya disimpan jika lolos uji
(chain ID / genesis hash cocok), dan diprioritaskan di atas endpoint bawaan.

- Solana mainnet: `solana-rpc.publicnode.com` -> `api.mainnet.solana.com` -> `api.mainnet-beta.solana.com`. RPC publik resmi Solana sering menjawab 403
  untuk lalu lintas dari browser dan tidak ditujukan untuk produksi; untuk pemakaian rutin gunakan endpoint berkunci milik Anda.
- Bitcoin: semua permintaan Esplora dibatasi laju (maks. 2 serentak, jeda 200 ms) dan dilindungi pemutus sirkuit: respons 429 dari
  mempool.space tidak membawa header CORS sehingga tampil sebagai galat CORS di browser, jadi setiap kegagalan fetch memicu jeda 15/30/60/120 dtk
  (menghormati Retry-After bila ada) agar tidak memperpanjang pembatasan. Pemindaian dihemat
  (gap 3, petunjuk indeks tersimpan, cabang kembalian dilewati untuk wallet kosong; sekitar 8 permintaan per pemindaian), hasil di-cache 2 menit, dan data terakhir ditampilkan (diberi catatan) saat penyedia gagal.
  Testnet4 hanya tersedia di mempool.space; Blockstream tidak menyediakannya.

## Bitcoin dan Solana
Satu recovery phrase menurunkan akun untuk semua jaringan (tanpa passphrase BIP-39 opsional):

| Jaringan | Standar | Path akun pertama | Alamat |
|---|---|---|---|
| EVM | BIP-44, secp256k1 | m/44'/60'/0'/0/0 | 0x… |
| Bitcoin | BIP-84 Native SegWit | m/84'/0'/0' (testnet: m/84'/1'/0') | bc1q… / tb1q… |
| Solana | SLIP-0010, Ed25519 | m/44'/501'/0'/0' | Base58 |

- Wallet yang diimpor lewat **private key** tidak punya recovery phrase, jadi Bitcoin dan Solana tidak tersedia untuk wallet itu.
- Bitcoin: data lewat REST Esplora (mempool.space, blockstream.info). Pemindaian alamat terima + kembalian: gap 3 untuk pemindaian biasa dan gap 20 untuk "Pindai mendalam"
  (`src/chains/bitcoin/account.ts`), dengan petunjuk indeks tersimpan agar pemindaian berikutnya hemat, hanya UTXO terkonfirmasi yang dibelanjakan, kembalian di bawah dust (546 sat) dilebur ke fee,
  RBF aktif. Testnet = **testnet4** (`https://mempool.space/testnet4/api`).
- Solana: JSON-RPC langsung (tanpa SDK besar), transfer SOL native lewat System Program; identitas cluster diverifikasi lewat
  genesis hash sebelum mengirim. Token SPL belum didukung.
- Privasi: setiap alamat yang dipindai dikirim ke penyedia data (mempool.space / RPC Solana), yang dapat mengaitkannya dengan IP Anda.
- RPC publik Solana dibatasi laju dan tidak menjamin ketersediaan: ganti `rpcUrls` di `src/lib/chains.ts` dengan provider Anda.

## Fitur
- Multi wallet: banyak wallet bernama ("Main A", "Main B", dst, bisa diubah). Setiap wallet punya keystore dan password sendiri;
  wallet yang sudah dibuka di sesi ini bisa berpindah instan lewat pemilih wallet di header. Kunci semua sekaligus dengan tombol gembok.
- Jaringan kustom: tombol + di header; RPC diverifikasi (chain ID harus cocok), bisa dihapus kapan saja
- Buat wallet (12 kata), tampilkan phrase dengan blur, verifikasi 3 kata, lalu keystore terenkripsi scrypt diunduh
- Impor lewat recovery phrase atau private key, selalu dibungkus keystore baru
- Buka keystore (.json) dengan password
- Default testnet; peralihan ke mainnet butuh konfirmasi
- Saldo native, token ERC-20 (impor contract dengan validasi), kirim native dan token
- Layar tinjau transaksi: chain, alamat lengkap, jumlah, estimasi gas, nonce, peringatan
- Verifikasi chainId RPC sebelum estimasi dan siar, fallback RPC berurutan
- Penandatanganan lokal, cek integritas tx sebelum siar, proteksi double-submit
- Riwayat dan pemantauan status pending, QR alamat penerima
- Auto-lock 5 menit tidak aktif dan saat halaman ditutup

## Ikon koin
Memakai `@cryptofonts/react` (repo Cryptofonts/cryptoicons) lewat `<CryptoIcon name="btc" fallback={...} />`
di `src/components/CoinIcon.tsx`. Jika simbol tidak ada di pustaka, tampil ikon cadangan buatan sendiri.
Cek lisensi repo ikon sebelum dipakai untuk produk komersial. Jika ikon tidak tampil di Netlify padahal tampil
di localhost, lihat Console: bila ada pelanggaran CSP `img-src`, tambahkan host gambar itu ke `img-src` di netlify.toml.

## Model keamanan
- Private key, phrase, dan password hanya di memori React; tidak pernah ke storage atau server.
- localStorage menyimpan: jaringan terpilih, daftar token, riwayat (hash dan alamat publik), dan, jika Anda mencentang "Ingat", KEYSTORE TERENKRIPSI. Password, phrase, dan private key tidak pernah disimpan. Tombol "Lupakan" menghapus keystore tersimpan.
- Harga memakai API publik CoinGecko (hanya id koin dan alamat contract token yang dikirim, bukan alamat dompet). Hostnya ada di connect-src.
- JavaScript tidak bisa menghapus memori secara pasti; menutup tab adalah cara kunci paling bersih.
- Ini belum diaudit. Uji penuh di testnet (buat, backup, buka, kirim, pulihkan dari phrase) sebelum menaruh dana nyata.
- Tambahan yang disarankan: hardware wallet, audit independen, `npm audit` dan penguncian versi dependency.

## Struktur
```
src/
  main.tsx, App.tsx, index.css
  context/   WalletContext (sesi + auto-lock), SettingsContext (jaringan, token, riwayat)
  lib/       chains, rpc, vault, tx, tokens, hooks, format, storage
  components/ Onboarding, Dashboard, SendPanel, ReceivePanel, TokensPanel,
              HistoryPanel, NetworkSwitcher, ChainPulse, ChainTicker, ui
```
