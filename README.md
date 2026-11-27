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

## Goal (journey) dan penguncian penarikan
Tab **Goal**: buat goal bernama, mis. `target 100$` atau `10 to 100` (mulai 10, target 100), pilih **jaringan** dan satuan (USD untuk mainnet bawaan,
atau koin native, termasuk testnet untuk uji coba). Progres, grafik perjalanan, dan status diperbarui otomatis.

- **Pengukuran:** koin native + token tersimpan (EVM) di jaringan terpilih. Polling tiap 30 detik saat tab terlihat; harga CoinGecko di-cache 5 menit,
  jadi ini *hampir realtime*, bukan streaming. Sinkron lintas perangkat memakai Supabase Realtime (jika diaktifkan).
- **Tercapai** setelah target terbaca dua kali berturut-turut (menahan lonjakan sesaat). Status tercapai bersifat tetap.
- **Mode Lock / Unlock per goal:**
  - **Lock**: dana goal terkunci sampai target tercapai. **Unlock**: hanya pelacak progres, dananya tetap bebas ditarik.
  - Tiap goal punya **dana** (alokasi dari saldo jaringan). Contoh: saldo 728$, goal "invest" Lock target 1000$ berdana 701$, goal "10 to 100" Unlock berdana 27$
    -> terkunci 701$, **yang bisa ditarik hanya 27$** (728 - 701). Progres tiap goal = dananya, bukan total saldo.
  - Dana kosong: goal Lock mengunci **seluruh** saldo jaringan (perilaku lama, dipakai goal yang dibuat sebelum fitur ini); goal Unlock memakai sisa saldo yang tidak terkunci.
  - Dana goal Lock **hanya bisa ditambah**, tidak bisa dikurangi (itu akan jadi celah membuka kunci). Untuk membukanya lebih awal pakai pembatalan 24 jam.
    Dana goal Unlock bebas naik/turun. Dana yang dialokasikan harus ada di saldo nyata, di luar dana yang sudah dikunci goal lain.
  - Dicek di semua fungsi penandatangan (`src/goals/guard.ts`): kirim native/token (jumlah + biaya gas), swap, dan approval (jumlahnya).
    Saldo dihitung dalam USD (native + token berharga) bila ada goal USD di jaringan itu, selain itu dalam koin native. Jika saldo/harga tidak bisa
    diverifikasi saat ada dana terkunci, penarikan **ditolak** (gagal-aman). Token tanpa harga tidak bisa dikirim selama ada dana terkunci di pool USD.
- **Kunci semua jaringan (waktu):** di tab Goal, isi angka + satuan (menit/jam/hari). Selama waktunya belum habis, SEMUA kirim, swap, dan approval di
  SEMUA jaringan untuk wallet itu ditolak. Min 1 menit, maks 365 hari. Tidak bisa dibatalkan atau dipersingkat, hanya diperpanjang (setelah konfirmasi).
  Memakai jam perangkat (mengubah jam perangkat bisa mengakalinya, seperti semua komitmen di dalam aplikasi ini).
- **Face ID / Touch ID (opt-in):** di form Buka, centang "Aktifkan Face ID" saat membuka wallet (atau di langkah "Masuk" setelah Buat/Impor). Berikutnya cukup
  tombol "Buka dengan Face ID", tanpa password. Web tidak punya API biometrik selain passkey (WebAuthn), jadi Face ID di sini selalu lewat passkey. Butuh HTTPS atau localhost.
  - **iOS/Safari 18+ (mode penuh):** ekstensi PRF membuat Secure Enclave menghasilkan rahasia hanya setelah verifikasi biometrik; rahasia itu jadi kunci AES-GCM yang
    mengenkripsi password vault. Yang tersimpan hanya password terenkripsi; kuncinya tidak pernah disimpan.
  - **iOS 16-17 (mode dasar, otomatis):** tanpa PRF passkey hanya memberi bukti kehadiran, bukan kunci. Kunci AES dibuat tak-dapat-diekspor dan disimpan di IndexedDB; Face ID
    menjadi gerbang di aplikasi. Lebih lemah: melindungi dari penyalinan data penyimpanan, TIDAK dari kode yang berjalan di origin ini (XSS / ekstensi browser jahat).
  - Siapa pun yang lolos verifikasi perangkat (termasuk passcode perangkat) bisa membuka wallet ini. Menghapus passkey membuat mode penuh tidak bisa dibuka lagi (pakai password).
    Data Face ID dihapus saat "Lupakan". Wallet bernilai besar sebaiknya tanpa Face ID.
- **Kontak (address book) + whitelist:** tab Kontak menyimpan alamat dengan nama (EVM, Bitcoin, Solana), data hanya di browser ini. Di tab Kirim ada tombol pemilih kontak,
  nama kontak muncul saat alamat cocok, dan "Simpan ke kontak" untuk alamat baru. Nama kontak juga tampil di modal tinjau dan riwayat. Saklar **Whitelist** membuat aplikasi hanya
  mau mengirim ke alamat yang ada di Kontak (atau alamat wallet sendiri); dicek di UI dan di fungsi penandatangan. Alamat divalidasi per jenis (checksum EVM, panjang Solana, format Bitcoin).
  Komitmen di dalam aplikasi: kontak bisa ditambah dan whitelist dimatikan kapan saja.
- **Mode kirim + 2FA Face ID:** di atas form Kirim (EVM, Bitcoin, Solana) pilih **Tinjau** (modal tinjau, seperti biasa) atau **Cepat** (satu klik langsung terkirim; otomatis kembali ke modal
  jika ada peringatan: kirim ke diri sendiri, ke smart contract, sisa saldo di bawah rent Solana, atau fee Bitcoin > 10%). Saklar **Face ID** mewajibkan konfirmasi passkey sebelum kirim,
  di kedua mode. Hasil passkey diverifikasi lokal (tanda tangan P-256, flag verifikasi biometrik, challenge, rpId, origin). Ditegakkan di fungsi penandatangan lewat bukti sekali pakai
  (2 menit, untuk wallet + jaringan + penerima yang sama), jadi jalur kode lain tidak bisa mengirim tanpa konfirmasi. Mematikan Face ID juga meminta konfirmasi. Butuh HTTPS atau localhost,
  iCloud Keychain aktif, dan tidak butuh iOS 18 (hanya passkey biasa). Swap tidak termasuk. Passkey hilang/rusak: "Lupakan" wallet lalu impor ulang akan mengatur ulang mode dan 2FA.
  Seperti fitur lain, ini komitmen di dalam aplikasi, bukan perlindungan dari kode jahat yang berjalan di origin ini.
- **Zcash (transparent saja, BETA):** jaringan "Zcash (transparent)" memakai alamat `t1…` dari recovery phrase yang sama (BIP-44 `m/44'/133'/0'/0/0`, satu alamat, kembalian ke alamat yang sama).
  Kirim/terima/saldo/riwayat/Kontak/Goal/whitelist/2FA bekerja seperti Bitcoin dan Solana. Transaksi v5 ditandatangani lokal (secp256k1, SIGHASH_ALL ZIP-244), fee ZIP-317 (5000 zatoshi per aksi, min 2),
  UTXO terkonfirmasi saja, dan isi transaksi dibongkar ulang dan dicocokkan dengan ringkasan sebelum disiarkan. **Tidak didukung:** alamat shielded (`zs1…`) dan unified (`u1…`) (ditolak dengan pesan jelas), serta testnet.
  - Penyedia data (urutan bawaan, otomatis pindah jika gagal): (1) JSON-RPC Zebra `https://zcash-mainnet-zebrad.gateway.tatum.io`, (2) Blockchair `https://api.blockchair.com/zcash`.
    Jenis API dikenali dari URL: host `*.gateway.tatum.io` atau akhiran `#jsonrpc` = JSON-RPC (node Zebra, atau zcashd dengan `-addressindex`); `blockchair.com` = Blockchair; selain itu dianggap Blockbook.
    API key lewat `?key=KUNCI` pada URL endpoint (dikirim sebagai header `x-api-key`, tidak ikut di URL; tersimpan di browser ini). **lightwalletd (gRPC, mis. `:9067`) tidak bisa dipakai langsung dari browser.**
    Endpoint JSON-RPC hanya melihat UTXO terkonfirmasi (kembalian baru muncul setelah terkonfirmasi). Browser harus diizinkan CORS oleh penyedia (header `x-api-key` memicu preflight).
    Penyedia gratis membatasi laju (Blockchair: HTTP 430 memblokir IP sementara). Aplikasi memakai cache, pembatas laju, jeda otomatis, dan menampilkan saldo terakhir yang berhasil dimuat.
    Alamat Anda terlihat oleh penyedia data. Penjelajah blok bawaan: `https://blockexplorer.one/zcash/mainnet` (alternatif: `https://mainnet.zcashexplorer.app`).
  - Saldo dan transaksi transparent **publik** di blockchain (tidak privat seperti shielded).
  - **Perawatan:** branch ID konsensus ada di `src/chains/zcash/params.ts` dan HARUS diperbarui tiap Zcash network upgrade; transaksi dengan branch ID usang ditolak jaringan (dana aman, kirim gagal).
  - Belum diuji ke jaringan sungguhan: coba dengan nominal kecil dulu.
- **Tampilan:** sidebar kaca di layar lebar dan tab bar kaca mengambang di HP (Aset, Kirim, Terima, Riwayat, Menu). Halaman Aset menampilkan total semua jaringan (pendukung) dan kartu jaringan aktif
  (saldo, alamat, aksi Kirim/Terima/Swap) dengan cahaya lembut warna khas jaringan (`src/lib/chainTint.ts`). Detail akun, jaringan, dan keamanan ada di halaman Akun. Komponen cangkang ada di
  `src/components/shell/` dan bersifat presentasi murni (tanpa dependensi data). Catatan teknis: wadah yang berisi popover/modal `position: fixed` tidak boleh memakai `backdrop-filter`.
- **Riwayat tersinkron (terenkripsi):** setelah masuk (tab Goal), riwayat transaksi tersimpan di Supabase dan terlihat di perangkat mana pun yang membuka wallet
  yang sama. Dienkripsi di perangkat (AES-GCM, kunci diturunkan dari private key): server hanya melihat ciphertext, penanda wallet, chain id, dan waktu.
  Hash, alamat, jumlah, dan status tidak terbaca. Hanya pengiriman yang tercatat (swap belum). Jalankan ulang `supabase/schema.sql` untuk tabel `tx_history`.
- **Pembatalan:** ajukan, tunggu 24 jam, lalu konfirmasi (bisa ditarik kembali). Ini gesekan sengaja terhadap keputusan impulsif.

### Batasan penting
**Ini komitmen di dalam aplikasi, BUKAN penguncian kriptografis.** Dompet ini self-custody: siapa pun yang punya recovery phrase atau keystore dan
passwordnya bisa menarik dana lewat wallet lain, atau lewat salinan aplikasi ini yang datanya dihapus. Menghapus data browser juga menghapus kunci lokal
(kecuali sinkron Supabase aktif). Penguncian yang sungguhan butuh smart contract (vault/timelock) atau, untuk Bitcoin, skrip timelock, dan itu memerlukan
desain, audit, dan penyimpanan dana di kontrak, bukan di wallet biasa ini.

## Sinkron Supabase (opsional)
Tanpa Supabase, goal tersimpan lokal (localStorage) dan semuanya tetap berfungsi. Supabase menambah sinkron lintas perangkat dan cadangan.
1. Buat proyek di supabase.com. SQL Editor: jalankan `supabase/schema.sql` (tabel, Row Level Security, Realtime). **Sudah punya proyek dari versi lama? Jalankan ulang file ini**: ia menambah kolom `mode`/`funded_value` dan tabel `wallet_locks`. Tanpa itu sinkron goal akan error.
2. Authentication > Providers: aktifkan **Email**.
3. Authentication > **URL Configuration**: isi **Site URL** dengan alamat situs Anda (mis. `https://situs-anda.netlify.app`) dan tambahkan juga ke
   **Redirect URLs** (plus `http://localhost:5173` untuk uji lokal). Tanpa ini tautan di email bisa mengarah ke `localhost:3000` dan gagal.
4. Authentication > **Email Templates**: yang Anda terima (kode atau tautan) ditentukan SEPENUHNYA oleh template. Edit template **Magic Link** dan
   **Confirm signup** (akun baru bisa memakai yang kedua) agar memuat `{{ .Token }}`, mis.:
   ```html
   <h2>Kode masuk Kunci Wallet</h2>
   <p>Masukkan kode ini di aplikasi: <strong>{{ .Token }}</strong></p>
   <p>Atau klik: <a href="{{ .ConfirmationURL }}">masuk lewat tautan</a></p>
   ```
   Kode bisa 6 atau 8 digit. Aplikasi mendukung KEDUANYA: ketik kode, atau klik tautan (sesi terdeteksi otomatis).
   Catatan iOS: tautan di email terbuka di Safari, bukan di aplikasi layar-beranda (penyimpanan terpisah), jadi untuk aplikasi layar-beranda gunakan kode.
5. Salin Project URL dan anon/publishable key ke `.env` (lihat `.env.example`) atau Netlify > Environment variables, lalu deploy ulang.
6. Di tab Goal: masukkan email, lalu kode dari email (atau klik tautannya).

**Yang disimpan di Supabase:** nama goal, jaringan, satuan, mode (lock/unlock), dana, nilai awal/target, status, waktu berakhir kunci waktu (tabel `wallet_locks`), dan snapshot nilai (USD/koin) dari waktu ke waktu, terkait akun email Anda.
**Tidak disimpan:** alamat wallet, kunci, recovery phrase, password. Goal ditautkan ke wallet lewat `wallet_ref`, HMAC yang hanya bisa dihitung pemilik wallet.
Kunci anon aman berada di sisi klien karena akses dibatasi Row Level Security. Sesi login Supabase tersimpan di browser.

## iOS: Add to Home Screen (PWA)
Manifest (`public/manifest.webmanifest`), ikon (`apple-touch-icon.png`, 192/512/maskable), dan meta tag iOS sudah dipasang, sehingga saat ditambahkan ke
Layar Utama aplikasi terbuka layar penuh tanpa bilah Safari. Cara: buka situs di Safari > Bagikan > **Tambah ke Layar Utama**.
- **Penyimpanan terpisah:** di iOS, aplikasi layar-beranda punya penyimpanan lokal yang TERPISAH dari Safari. Keystore dan goal yang tersimpan di Safari
  tidak terlihat di aplikasi layar-beranda: buka/impor ulang keystore di sana (atau pakai sinkron Supabase untuk goal).
- Input memakai font 16px di layar sentuh agar iOS tidak memperbesar halaman saat fokus. Auto-lock memakai jam (bukan hanya pewaktu), karena iOS
  membekukan aplikasi di latar belakang.
- Tidak ada service worker: tidak diperlukan untuk tampilan layar penuh, dan menghindari risiko berkas lama tersimpan di cache dompet.

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
