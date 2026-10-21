#!/usr/bin/env node
/**
 * SEMENTARA — diagnostik read-only terhadap database development (dipakai sekali
 * untuk aktivasi backend Milestone 4; dihapus sebelum merge ke main).
 *
 * Tidak menulis apa pun: hanya membaca katalog skema dan riwayat migration.
 * Nilai connection string tidak pernah dicetak (hanya user@host:port/database).
 */
import pg from 'pg';
import process from 'node:process';

const raw = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
if (!raw) {
  console.error('[inspect] DATABASE_URL belum diatur.');
  process.exit(1);
}

function describeTarget(urlText) {
  try {
    const url = new URL(urlText);
    return `${url.username}@${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    return '(target tidak dapat dibaca)';
  }
}

const url = new URL(raw);
url.searchParams.delete('sslmode');
const client = new pg.Client({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'rodakawan-m4-inspect',
  connectionTimeoutMillis: 15000,
  statement_timeout: 60000,
});

const q = async (label, sql) => {
  try {
    const { rows } = await client.query(sql);
    console.log(`--- ${label}`);
    console.log(JSON.stringify(rows));
  } catch (error) {
    console.log(`--- ${label} ERROR: ${error.message}`);
  }
};

console.log(`[inspect] Target : ${describeTarget(raw)} (kredensial tidak ditampilkan)`);
await client.connect();

await q('migrations_tercatat', 'select version, name from supabase_migrations.schema_migrations order by version');
await q('tabel_public', "select table_name from information_schema.tables where table_schema='public' order by 1");
await q('kolom_chat_messages', "select column_name from information_schema.columns where table_schema='public' and table_name='chat_messages' order by ordinal_position");
await q('kolom_hazard_reports', "select column_name from information_schema.columns where table_schema='public' and table_name='hazard_reports' order by ordinal_position");
await q('kolom_content_reports', "select column_name from information_schema.columns where table_schema='public' and table_name='content_reports' order by ordinal_position");
await q('tabel_user_blocks', "select to_regclass('public.user_blocks') is not null as ada");
await q('fungsi_m4', "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('create_hazard','update_hazard','remove_hazard','confirm_hazard','expire_hazard_reports','send_chat_message','edit_chat_message','delete_chat_message','report_content','is_blocked_by_me','can_moderate_ride','can_moderate_hazard','can_moderate_chat_message','can_moderate_content_report','moderate_hazard','moderate_chat_message','review_content_report','list_moderation_actions','get_moderation_subject') order by 1");
await q('policy_per_tabel', "select tablename, count(*)::int as jumlah from pg_policies where schemaname='public' group by 1 order by 1");
await q('publication_realtime', "select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' order by 1");
await q('policy_chat_messages', "select policyname, cmd from pg_policies where schemaname='public' and tablename='chat_messages' order by 1");
await q('policy_hazard_reports', "select policyname, cmd from pg_policies where schemaname='public' and tablename='hazard_reports' order by 1");
await q('grants_tulis_chat', "select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='chat_messages' and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE')");
await q('grants_tulis_hazard', "select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='hazard_reports' and grantee in ('authenticated','anon') and privilege_type in ('INSERT','UPDATE','DELETE')");

await client.end();
console.log('[inspect] Selesai (read-only).');
