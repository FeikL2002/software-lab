-- Run once in YOUR Supabase SQL editor. No sportsbook credentials are stored.
-- Each record is self-reported, private, and denominated in USD cash.
begin;
create table if not exists public.oddsscout_bets (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 record jsonb not null,
 version integer not null default 1 check (version > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint valid_record check (
  jsonb_typeof(record) = 'object'
  and record ?& array['id','mode','schema','status','legs','savedAt','sourceKey','quotedDecimal']
  and record->>'id' = id::text
  and record->>'mode' = 'real'
  and record->>'schema' = '1'
  and record->>'status' in ('saved','open','won','lost','push','void','cashout')
  and jsonb_typeof(record->'legs') = 'array'
  and jsonb_array_length(record->'legs') between 1 and 4
  and octet_length(record::text) <= 24000
 )
);
create index if not exists oddsscout_bets_owner_date on public.oddsscout_bets(user_id,created_at desc,id desc);
alter table public.oddsscout_bets enable row level security;
alter table public.oddsscout_bets force row level security;
revoke all on table public.oddsscout_bets from anon, authenticated, public;
grant select,insert,update,delete on table public.oddsscout_bets to authenticated;
drop policy if exists "owner_read" on public.oddsscout_bets;
drop policy if exists "owner_insert" on public.oddsscout_bets;
drop policy if exists "owner_update" on public.oddsscout_bets;
drop policy if exists "owner_delete" on public.oddsscout_bets;
create policy "owner_read" on public.oddsscout_bets for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner_insert" on public.oddsscout_bets for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "owner_update" on public.oddsscout_bets for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner_delete" on public.oddsscout_bets for delete to authenticated using ((select auth.uid()) = user_id);
create or replace function public.oddsscout_bet_version() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id <> old.id or new.user_id <> old.user_id or new.created_at <> old.created_at then
  raise exception 'Record identity cannot be changed';
 end if;
 if new.record->'legs' is distinct from old.record->'legs'
  or new.record->'mode' is distinct from old.record->'mode'
  or new.record->'savedAt' is distinct from old.record->'savedAt'
  or new.record->'sourceKey' is distinct from old.record->'sourceKey'
  or new.record->'quotedDecimal' is distinct from old.record->'quotedDecimal' then
  raise exception 'Original snapshot cannot be changed';
 end if;
 new.version := old.version + 1;
 new.updated_at := now();
 return new;
end;
$$;
revoke all on function public.oddsscout_bet_version() from public,anon,authenticated;
drop trigger if exists oddsscout_bet_version on public.oddsscout_bets;
create trigger oddsscout_bet_version before update on public.oddsscout_bets for each row execute function public.oddsscout_bet_version();
commit;
