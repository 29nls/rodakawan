/**
 * Client `pg` palsu untuk menguji `scripts/db-test.mjs` tanpa database.
 *
 * Runner uji RLS aslinya bicara ke PostgreSQL sungguhan, jadi perilakunya
 * (berhenti di berkas pertama, koneksi yang putus di tengah jalan, transaksi
 * yang menggantung) mustahil dibuktikan tanpa server. Tiruan ini membuat
 * perilaku itu bisa diuji: setiap berkas uji dicocokkan lewat potongan teks di
 * dalam SQL-nya, lalu tiruan berperilaku sesuai skenario — melempar galat,
 * menerima notice, atau tidak melakukan apa pun.
 *
 * Skenario:
 *   { match: 'BERKAS_A', error: { code: 'P0001', message: 'asersi gagal' } }
 *   { match: 'BERKAS_B', notice: 'UJI B LULUS' }
 *
 * `match` dicocokkan sebagai potongan teks di SQL yang dikirim runner, jadi
 * penandanya cukup berupa komentar unik di dalam berkas uji.
 */
export function createFakePgClient(steps = []) {
  /** Semua SQL yang diterima tiruan, berurutan. */
  const queries = [];
  const noticeHandlers = new Set();
  let connected = false;

  const client = {
    queries,
    isConnected: () => connected,

    /** Mengganti `on` milik EventEmitter; hanya peristiwa `notice` yang dipakai. */
    on(event, handler) {
      if (event === 'notice') noticeHandlers.add(handler);
      return client;
    },

    async connect() {
      connected = true;
    },

    async end() {
      connected = false;
    },

    async query(sql) {
      queries.push(sql);

      const step = steps.find((candidate) => String(sql).includes(candidate.match));

      if (!step) return { rows: [], rowCount: 0 };

      if (step.error) {
        const error =
          step.error instanceof Error
            ? step.error
            : Object.assign(new Error(step.error.message), step.error);
        throw error;
      }

      if (step.notice) {
        for (const handler of noticeHandlers) {
          handler({ message: step.notice, severity: 'NOTICE' });
        }
      }

      return { rows: [], rowCount: 1 };
    },
  };

  return client;
}
