# Project Decision Log

Gunakan log ini untuk merekam keputusan yang mempengaruhi data, dependency native, biaya layanan, privasi, atau pengalaman inti.

| ID | Keputusan | Status | Alasan / catatan |
|---|---|---|---|
| ADR-001 | Nama kerja produk adalah RodaKawan | Sementara | Nama final belum dipilih; jangan mengunci identitas visual/domain. |
| ADR-002 | Mobile app memakai React Native + Expo + TypeScript | Disetujui awal | Sesuai rencana pengembangan tanpa Android Studio lokal. |
| ADR-003 | Android-first, desain tetap lintas platform | Usulan | Mengurangi kompleksitas rilis awal. Validasi kebutuhan iOS. |
| ADR-004 | Supabase menjadi backend awal | Usulan | Auth, Postgres, RLS, Realtime, Storage dan Edge Functions dalam satu ekosistem. |
| ADR-005 | Location-sharing hanya untuk ride aktif dan opt-in | Wajib | Meminimalkan kebocoran lokasi dan ambiguitas consent. |
| ADR-006 | Riwayat GPS permanen nonaktif secara default | Wajib | Privasi dan kontrol data. |
| ADR-007 | Voice PTT dan local music ditunda ke P2 | Usulan kuat | Native audio dan background complexity tidak boleh memblokir MVP. |
| ADR-008 | LiveKit dievaluasi untuk WebRTC PTT | Belum final | Butuh proof-of-concept, biaya, dan device/headset compatibility tests. |
| ADR-009 | Peta/tiles provider dipilih setelah uji biaya dan lisensi | Belum final | Hindari ketergantungan pada demo tiles atau quota yang tidak cocok untuk produksi. |

## Template keputusan baru

- **ID:** ADR-XXX
- **Tanggal:** YYYY-MM-DD
- **Status:** Proposed / Accepted / Rejected / Superseded
- **Konteks:** Masalah yang perlu diputuskan.
- **Pilihan:** Alternatif realistis.
- **Keputusan:** Pilihan yang diambil.
- **Konsekuensi:** Trade-off, biaya, risiko, migration plan.
- **Referensi:** Dokumentasi/hasil benchmark relevan.
