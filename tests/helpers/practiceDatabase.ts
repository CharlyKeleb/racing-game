import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { resultPlayers } from './resultRecord'

/** Real embedded Postgres, with a minimal Supabase Auth/role bootstrap.
 * This tests SQL/ACL/RLS, not the hosted Auth/PostgREST gateway or multi-connection locking.
 */
export async function practiceDatabase() {
  const db = await PGlite.create()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
  `)
  for (const file of ['0001_player_saves.sql', '0002_racer_profiles.sql', '0003_online_practice_history.sql', '0004_online_practice_retirements.sql', '0005_racer_identity_audit.sql', '0006_leaderboards.sql']) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  }
  for (let i = 0; i < resultPlayers.length; i++) {
    await db.query('insert into auth.users(id) values ($1)', [resultPlayers[i]])
    await db.query('insert into public.profiles(id,handle,display_name) values ($1,$2,$3)', [resultPlayers[i], `racer_${i}`, `Racer ${i}`])
  }
  return db
}
