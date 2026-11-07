-- Aggregate popularity only; never exposes private saved bets or user identifiers.
begin;
create table if not exists public.oddsscout_likes (
 selection_hash text not null check (selection_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid not null references auth.users(id) on delete cascade,
 event_id text not null check (length(event_id) between 1 and 150),
 title text not null check (length(title) between 1 and 1000),
 created_at timestamptz not null default now(),
 primary key(selection_hash,user_id)
);
alter table public.oddsscout_likes enable row level security;
alter table public.oddsscout_likes force row level security;
revoke all on public.oddsscout_likes from public,anon,authenticated;
grant select,insert,delete on public.oddsscout_likes to authenticated;
create policy likes_owner_read on public.oddsscout_likes for select to authenticated using ((select auth.uid())=user_id);
create policy likes_owner_insert on public.oddsscout_likes for insert to authenticated with check ((select auth.uid())=user_id);
create policy likes_owner_delete on public.oddsscout_likes for delete to authenticated using ((select auth.uid())=user_id);
create or replace function public.oddsscout_trending() returns table(selection_hash text,title text,likes bigint,latest_like timestamptz)
language sql stable security definer set search_path='' as $$
 select l.selection_hash,min(l.title),count(*),max(l.created_at)
 from public.oddsscout_likes l where l.created_at > now()-interval '7 days'
 group by l.selection_hash order by count(*) desc,max(l.created_at) desc limit 30;
$$;
revoke all on function public.oddsscout_trending() from public;
grant execute on function public.oddsscout_trending() to anon,authenticated;
commit;
