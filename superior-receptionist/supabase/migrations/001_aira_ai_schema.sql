create extension if not exists pgcrypto;

create table if not exists public.aira_voice_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  label text not null,
  provider_voice_id text not null,
  locale text not null default 'en-US',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.aira_training_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  title text not null default 'AIRA AI Receptionist Training',
  prompt text not null,
  source text not null default 'manual',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.aira_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  caller_name text not null default 'Unknown',
  caller_contact text,
  business_name text,
  message_body text not null,
  urgency text not null default 'Normal' check (urgency in ('Low', 'Normal', 'High', 'Urgent')),
  source text not null default 'manual',
  status text not null default 'new' check (status in ('new', 'reviewed', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.aira_calls (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  provider_call_id text unique,
  caller_number text,
  call_status text not null default 'new',
  screened_category text not null default 'General',
  duration_seconds integer not null default 0,
  recording_url text,
  transcript_summary text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.aira_call_turns (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.aira_calls(id) on delete cascade,
  speaker text not null check (speaker in ('caller', 'aira', 'system')),
  text_body text not null,
  confidence numeric(4, 3),
  created_at timestamptz not null default now()
);

create table if not exists public.aira_audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists aira_messages_owner_created_idx on public.aira_messages(owner_id, created_at desc);
create index if not exists aira_calls_owner_started_idx on public.aira_calls(owner_id, started_at desc);
create index if not exists aira_call_turns_call_created_idx on public.aira_call_turns(call_id, created_at);
create index if not exists aira_training_active_idx on public.aira_training_versions(owner_id, is_active, created_at desc);

alter table public.aira_voice_profiles enable row level security;
alter table public.aira_training_versions enable row level security;
alter table public.aira_messages enable row level security;
alter table public.aira_calls enable row level security;
alter table public.aira_call_turns enable row level security;
alter table public.aira_audit_events enable row level security;

create policy "Users manage own voice profiles" on public.aira_voice_profiles
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Users manage own training" on public.aira_training_versions
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Users manage own messages" on public.aira_messages
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Users manage own calls" on public.aira_calls
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Users read turns for own calls" on public.aira_call_turns
  for select using (
    exists (
      select 1 from public.aira_calls
      where aira_calls.id = aira_call_turns.call_id
      and aira_calls.owner_id = auth.uid()
    )
  );

create policy "Users manage own audit events" on public.aira_audit_events
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
