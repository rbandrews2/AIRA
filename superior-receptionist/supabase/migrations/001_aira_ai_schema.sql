create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.aira_operator_profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'AIRA Operator',
  company_name text not null default 'Superior Consultation, LLC',
  corporate_email text not null default 'info@superiorllc.org',
  general_email text not null default 'ray@workzoneos.org',
  primary_phone text not null default '540-797-0405',
  toll_free_phone text not null default '844-685-7207',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aira_voice_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  provider text not null default 'twilio',
  provider_voice_id text not null default 'Polly.Joanna-Neural',
  locale text not null default 'en-US',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aira_training_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'AIRA AI Receptionist Training',
  prompt text not null,
  source text not null default 'manual',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.aira_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  caller_name text not null default 'Unknown',
  caller_contact text,
  business_name text,
  message_body text not null,
  urgency text not null default 'Normal' check (urgency in ('Low', 'Normal', 'High', 'Urgent')),
  source text not null default 'manual',
  status text not null default 'new' check (status in ('new', 'reviewed', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aira_calls (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'twilio',
  provider_call_id text unique,
  caller_number text,
  call_status text not null default 'new' check (call_status in ('new', 'active', 'transferred', 'completed', 'missed', 'failed', 'archived')),
  screened_category text not null default 'General',
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  recording_url text,
  transcript_summary text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aira_call_turns (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.aira_calls(id) on delete cascade,
  speaker text not null check (speaker in ('caller', 'aira', 'system')),
  text_body text not null,
  confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now()
);

create table if not exists public.aira_audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists aira_voice_profiles_owner_default_idx on public.aira_voice_profiles(owner_id, is_default);
create index if not exists aira_training_owner_active_idx on public.aira_training_versions(owner_id, is_active, created_at desc);
create index if not exists aira_messages_owner_status_created_idx on public.aira_messages(owner_id, status, created_at desc);
create index if not exists aira_calls_owner_started_idx on public.aira_calls(owner_id, started_at desc);
create index if not exists aira_calls_provider_call_idx on public.aira_calls(provider_call_id);
create index if not exists aira_call_turns_call_created_idx on public.aira_call_turns(call_id, created_at);
create index if not exists aira_audit_owner_created_idx on public.aira_audit_events(owner_id, created_at desc);

drop trigger if exists set_aira_operator_profiles_updated_at on public.aira_operator_profiles;
create trigger set_aira_operator_profiles_updated_at before update on public.aira_operator_profiles for each row execute function public.set_updated_at();
drop trigger if exists set_aira_voice_profiles_updated_at on public.aira_voice_profiles;
create trigger set_aira_voice_profiles_updated_at before update on public.aira_voice_profiles for each row execute function public.set_updated_at();
drop trigger if exists set_aira_messages_updated_at on public.aira_messages;
create trigger set_aira_messages_updated_at before update on public.aira_messages for each row execute function public.set_updated_at();
drop trigger if exists set_aira_calls_updated_at on public.aira_calls;
create trigger set_aira_calls_updated_at before update on public.aira_calls for each row execute function public.set_updated_at();

alter table public.aira_operator_profiles enable row level security;
alter table public.aira_voice_profiles enable row level security;
alter table public.aira_training_versions enable row level security;
alter table public.aira_messages enable row level security;
alter table public.aira_calls enable row level security;
alter table public.aira_call_turns enable row level security;
alter table public.aira_audit_events enable row level security;

drop policy if exists "Operators manage own profile" on public.aira_operator_profiles;
create policy "Operators manage own profile" on public.aira_operator_profiles for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "Operators manage own voice profiles" on public.aira_voice_profiles;
create policy "Operators manage own voice profiles" on public.aira_voice_profiles for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "Operators manage own training" on public.aira_training_versions;
create policy "Operators manage own training" on public.aira_training_versions for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "Operators manage own messages" on public.aira_messages;
create policy "Operators manage own messages" on public.aira_messages for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "Operators manage own calls" on public.aira_calls;
create policy "Operators manage own calls" on public.aira_calls for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "Operators manage turns for own calls" on public.aira_call_turns;
create policy "Operators manage turns for own calls" on public.aira_call_turns for all to authenticated using (exists (select 1 from public.aira_calls c where c.id = aira_call_turns.call_id and c.owner_id = auth.uid())) with check (exists (select 1 from public.aira_calls c where c.id = aira_call_turns.call_id and c.owner_id = auth.uid()));
drop policy if exists "Operators manage own audit events" on public.aira_audit_events;
create policy "Operators manage own audit events" on public.aira_audit_events for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create or replace view public.aira_call_transcripts with (security_invoker = true) as
select
  c.id,
  c.owner_id,
  c.provider,
  c.provider_call_id,
  c.caller_number,
  c.call_status,
  c.screened_category,
  c.duration_seconds,
  c.recording_url,
  c.transcript_summary,
  c.started_at,
  c.ended_at,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'speaker', t.speaker,
        'text', t.text_body,
        'confidence', t.confidence,
        'created_at', t.created_at
      )
      order by t.created_at
    ) filter (where t.id is not null),
    '[]'::jsonb
  ) as transcript
from public.aira_calls c
left join public.aira_call_turns t on t.call_id = c.id
group by c.id;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.aira_operator_profiles to authenticated;
grant select, insert, update, delete on public.aira_voice_profiles to authenticated;
grant select, insert, update, delete on public.aira_training_versions to authenticated;
grant select, insert, update, delete on public.aira_messages to authenticated;
grant select, insert, update, delete on public.aira_calls to authenticated;
grant select, insert, update, delete on public.aira_call_turns to authenticated;
grant select, insert, update, delete on public.aira_audit_events to authenticated;
grant select on public.aira_call_transcripts to authenticated;
