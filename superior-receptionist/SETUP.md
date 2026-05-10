# AIRA AI Setup Guide

This file explains what must be configured for AIRA AI to function as a PWA receptionist, call assistant, and future Supabase-backed product.

## 1. Required Accounts And Tools

Install or create these first:

- Node.js 18 or newer.
- A Twilio account with a voice-capable phone number.
- An Anthropic API key if you want live AI responses instead of local fallback replies.
- A Supabase project if you want database persistence and Edge Functions.
- A public HTTPS URL for Twilio webhooks. Use ngrok for testing or a deployed server for production.
- Netlify account if deploying the static PWA to Netlify.

## 2. Install The Project

From the project folder:

```bash
cd superior-receptionist
npm install
```

Create your local environment file:

```bash
copy .env.example .env
```

On macOS/Linux, use:

```bash
cp .env.example .env
```

## 3. Configure Environment Variables

Open `.env` and fill in the values:

```env
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+18446857207

PORT=3000
PUBLIC_URL=https://your-public-url.example

AIRA_VOICE=Polly.Joanna-Neural
AIRA_TRANSFER_NUMBER=+15407970405
AIRA_RECORD_CALLS=false

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
AIRA_OWNER_ID=your_supabase_auth_user_uuid
AIRA_ASSISTANT_FUNCTION_URL=https://your-project.supabase.co/functions/v1/aira-assistant
```

Keep `AIRA_RECORD_CALLS=false` until recording consent, retention rules, and legal review are complete.

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never place it in browser JavaScript or expose it through the PWA.

`AIRA_OWNER_ID` should be the Supabase Auth user UUID that owns the AIRA records.

## 4. Run Locally

Start the server:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

If port `3000` is already used, set another port:

```bash
$env:PORT=3099
npm start
```

Then open:

```text
http://localhost:3099
```

## 5. Expose The Local Server For Twilio Testing

Twilio needs a public HTTPS URL.

```bash
npx ngrok http 3000
```

Copy the HTTPS forwarding URL and place it in `.env` as `PUBLIC_URL`.

Example:

```env
PUBLIC_URL=https://abc123.ngrok-free.app
```

Restart the server after changing `.env`.

## 6. Configure Twilio

In Twilio Console, open the phone number that AIRA will answer.

Set these voice webhooks:

- Incoming call webhook: `POST https://YOUR_PUBLIC_URL/voice/incoming`
- Call status webhook: `POST https://YOUR_PUBLIC_URL/voice/status`

Then call the Twilio number. AIRA should answer and begin a speech conversation.

## 7. Configure The PWA

Open the app in a mobile browser:

```text
https://YOUR_PUBLIC_URL
```

In the AIRA install panel:

- Review the permission list.
- Grant browser-supported permissions if needed: camera/video and microphone.
- Install the PWA using the browser install prompt.
- If the install prompt does not appear, use the browser menu:
  - Android Chrome/Edge: Install App or Add to Home Screen.
  - iPhone Safari: Share, then Add to Home Screen.

Important: browser PWAs cannot directly grant device admin, overlay, write settings, cellular call control, SMS control, or hidden recording permissions. Those require native Android/iOS, telephony provider, carrier, or device-owner flows.

## 8. Supabase Database Setup

Install the Supabase CLI if it is not installed.

Log in:

```bash
supabase login
```

Link the project:

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

Apply the schema:

```bash
supabase db push
```

The migration creates tables for:

- Operator profiles.
- Voice profiles.
- Training versions.
- Messages.
- Calls.
- Call transcript turns.
- Audit events.
- Readable call transcript view.

Row-level security is enabled in the migration.

You can also run this directly in the Supabase SQL Editor as one continuous setup script:

```sql
create extension if not exists pgcrypto;
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create table if not exists public.aira_operator_profiles (owner_id uuid primary key references auth.users(id) on delete cascade, display_name text not null default 'AIRA Operator', company_name text not null default 'Superior Consultation, LLC', corporate_email text not null default 'info@superiorllc.org', general_email text not null default 'ray@workzoneos.org', primary_phone text not null default '540-797-0405', toll_free_phone text not null default '844-685-7207', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.aira_voice_profiles (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, label text not null, provider text not null default 'twilio', provider_voice_id text not null default 'Polly.Joanna-Neural', locale text not null default 'en-US', is_default boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.aira_training_versions (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, title text not null default 'AIRA AI Receptionist Training', prompt text not null, source text not null default 'manual', is_active boolean not null default true, created_at timestamptz not null default now());
create table if not exists public.aira_messages (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, caller_name text not null default 'Unknown', caller_contact text, business_name text, message_body text not null, urgency text not null default 'Normal' check (urgency in ('Low', 'Normal', 'High', 'Urgent')), source text not null default 'manual', status text not null default 'new' check (status in ('new', 'reviewed', 'closed')), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.aira_calls (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, provider text not null default 'twilio', provider_call_id text unique, caller_number text, call_status text not null default 'new' check (call_status in ('new', 'active', 'transferred', 'completed', 'missed', 'failed', 'archived')), screened_category text not null default 'General', duration_seconds integer not null default 0 check (duration_seconds >= 0), recording_url text, transcript_summary text, started_at timestamptz not null default now(), ended_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.aira_call_turns (id uuid primary key default gen_random_uuid(), call_id uuid not null references public.aira_calls(id) on delete cascade, speaker text not null check (speaker in ('caller', 'aira', 'system')), text_body text not null, confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)), created_at timestamptz not null default now());
create table if not exists public.aira_audit_events (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, event_type text not null, event_payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
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
create or replace view public.aira_call_transcripts with (security_invoker = true) as select c.id, c.owner_id, c.provider, c.provider_call_id, c.caller_number, c.call_status, c.screened_category, c.duration_seconds, c.recording_url, c.transcript_summary, c.started_at, c.ended_at, coalesce(jsonb_agg(jsonb_build_object('speaker', t.speaker, 'text', t.text_body, 'confidence', t.confidence, 'created_at', t.created_at) order by t.created_at) filter (where t.id is not null), '[]'::jsonb) as transcript from public.aira_calls c left join public.aira_call_turns t on t.call_id = c.id group by c.id;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.aira_operator_profiles to authenticated;
grant select, insert, update, delete on public.aira_voice_profiles to authenticated;
grant select, insert, update, delete on public.aira_training_versions to authenticated;
grant select, insert, update, delete on public.aira_messages to authenticated;
grant select, insert, update, delete on public.aira_calls to authenticated;
grant select, insert, update, delete on public.aira_call_turns to authenticated;
grant select, insert, update, delete on public.aira_audit_events to authenticated;
grant select on public.aira_call_transcripts to authenticated;
```

## 9. Supabase Edge Function Setup

Deploy the included assistant function:

```bash
supabase functions deploy aira-assistant
```

Set Supabase secrets:

```bash
supabase secrets set SUPABASE_URL=https://YOUR_PROJECT.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

The current Edge Function can answer from known AIRA business facts without external AI calls. It can also persist call turns when a `call_id` is provided.

## 10. Netlify Deployment

The current `netlify.toml` publishes the static PWA from `public`.

Deploy from Netlify by connecting the repo, or deploy manually with Netlify CLI:

```bash
npm install -g netlify-cli
netlify login
netlify deploy
```

For production:

```bash
netlify deploy --prod
```

Netlify serves the PWA. The Express/Twilio backend still needs a Node-capable host unless it is later converted to Netlify Functions or Supabase Edge Functions.

## 11. Production Hosting Requirement

AIRA has two deployable parts:

- Static PWA: can live on Netlify.
- Voice backend: must run on a Node server or serverless function that Twilio can reach.

Production backend options:

- Render.
- Railway.
- Fly.io.
- DigitalOcean.
- AWS/GCP/Azure.
- Netlify Functions after refactor.
- Supabase Edge Functions after refactor.

After deploying the backend, update Twilio webhooks to use the production backend URL.

## 12. Data Protection Requirements Before Launch

Before real customer use, complete these:

- Add authentication to the dashboard.
- Store production data in Supabase instead of local JSON.
- Verify Twilio webhook signatures server-side.
- Keep API keys only in server environment variables or Supabase secrets.
- Keep `.env` out of git.
- Keep service worker caching disabled for `/api/` and `/voice/`.
- Define retention rules for calls, transcripts, messages, and recordings.
- Add export/delete controls for account owners.
- Add call recording consent language before enabling recording.

See `docs/DATA_PROTECTION.md`.

## 13. Native Permission Roadmap

For future Android/iOS versions:

- Android call screening: `CallScreeningService`.
- Android overlay: native `SYSTEM_ALERT_WINDOW` settings flow.
- Android write settings: native `WRITE_SETTINGS` settings flow.
- Android device admin: `DeviceAdminReceiver` or Android Enterprise device-owner flow.
- iOS calls: CallKit for AIRA-owned VoIP workflows.
- Cellular call recording/control: carrier, telephony provider, or approved native capability only.

The PWA should explain these capabilities but cannot grant them directly.

## 14. Quick Verification Checklist

Run:

```bash
node --check server.js
node --check public/app.js
npm start
```

Then test:

- `GET /health` returns JSON.
- PWA opens in the browser.
- Install panel appears.
- Camera/microphone permission request works in a supported browser.
- Message form saves locally.
- Training text saves locally.
- Twilio call reaches `/voice/incoming`.
- Call responses continue through `/voice/respond`.

## 15. Reference Docs

- `docs/PROJECT_MEMORY.md`
- `docs/DATA_PROTECTION.md`
- `docs/AIRA_TECH_RESEARCH.md`
