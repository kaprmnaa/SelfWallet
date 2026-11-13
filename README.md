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
