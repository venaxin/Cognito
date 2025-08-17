-- Learning Coach schema

-- Required extensions (enable these in Supabase: Database → Extensions)
-- NOTE: Some editors (e.g., dbtools) flag CREATE EXTENSION syntax. Enable via UI, then run this schema.
-- create extension if not exists pgcrypto; -- for gen_random_uuid()
-- create extension if not exists vector;   -- for pgvector embeddings

-- Users are handled by Supabase Auth; we reference auth.users via UUID.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  display_name text,
  photo_url text
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  target_date date,
  created_at timestamptz default now()
);

create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  created_at timestamptz default now()
);

-- Cards contain prompt/answer and an embedding for retrieval.
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  front text not null,
  back text not null,
  embedding vector(768), -- adjust to Google embedding size
  created_at timestamptz default now()
);

-- Reviews store spaced repetition outcomes (SM-2-like fields simplified)
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating int not null check (rating between 0 and 5),
  interval_days int not null default 1,
  easiness real not null default 2.5,
  due_date date not null default (current_date + 1),
  reviewed_at timestamptz not null default now()
);

-- Conversations and messages for coaching sessions
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamptz default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.decks enable row level security;
alter table public.cards enable row level security;
alter table public.reviews enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Basic policies (owner-only)
create policy "own_profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own_rows" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own_rows" on public.decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own_rows_decks" on public.cards
  for all using (
    exists (select 1 from public.decks d where d.id = deck_id and d.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.decks d where d.id = deck_id and d.user_id = auth.uid())
  );

create policy "own_rows_reviews" on public.reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own_rows_convos" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own_rows_msgs" on public.messages
  for all using (
    exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );

-- Extension for vectors (pgvector) must be enabled in Supabase project
-- In SQL editor run: create extension if not exists vector;
