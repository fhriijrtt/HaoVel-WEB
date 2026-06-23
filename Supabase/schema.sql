-- Haovels Supabase schema
-- Jalankan di Supabase SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  manga_id text not null,
  title text not null,
  cover text,
  last_chapter text,
  created_at timestamptz not null default now(),
  unique (user_id, manga_id)
);

create table if not exists public.reading_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  manga_id text not null,
  chapter_id text not null,
  title text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, manga_id)
);

alter table public.profiles enable row level security;
alter table public.bookmarks enable row level security;
alter table public.reading_history enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Users can read own bookmarks" on public.bookmarks;
create policy "Users can read own bookmarks"
on public.bookmarks
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own bookmarks" on public.bookmarks;
create policy "Users can insert own bookmarks"
on public.bookmarks
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own bookmarks" on public.bookmarks;
create policy "Users can update own bookmarks"
on public.bookmarks
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own bookmarks" on public.bookmarks;
create policy "Users can delete own bookmarks"
on public.bookmarks
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own reading history" on public.reading_history;
create policy "Users can read own reading history"
on public.reading_history
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own reading history" on public.reading_history;
create policy "Users can insert own reading history"
on public.reading_history
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own reading history" on public.reading_history;
create policy "Users can update own reading history"
on public.reading_history
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own reading history" on public.reading_history;
create policy "Users can delete own reading history"
on public.reading_history
for delete
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists bookmarks_user_id_idx on public.bookmarks using btree (user_id);
create index if not exists reading_history_user_id_idx on public.reading_history using btree (user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do update
  set username = excluded.username,
      avatar_url = excluded.avatar_url;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
