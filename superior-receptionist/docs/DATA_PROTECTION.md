# AIRA AI Data Protection Practices

These are the practices this project is designed to follow.

## Data Minimization

- Collect only information needed to answer calls, route requests, take messages, and improve AIRA's training.
- Store caller messages separately from call records and transcript turns.
- Keep call recording disabled by default.

## Consent And Transparency

- Ask the operator for supported browser permissions during onboarding.
- Disclose recording before enabling call recording.
- Show which requested capabilities are browser-supported, native-only, or telephony-provider-only.
- Give the operator a clear stop-install choice.

## Secret Handling

- Keep API keys, Twilio credentials, Supabase service role keys, and model-provider keys out of browser JavaScript.
- Store secrets only in server environment variables or Supabase function secrets.
- Do not commit `.env` files.

## Database Protection

- Supabase tables are separated by purpose: voice profiles, training versions, messages, calls, call turns, and audit events.
- Row-level security is enabled in the included migration.
- Owner-scoped policies are defined for user-owned records.
- Call turns are ordered by `created_at` for readable transcript output.

## Browser And PWA Guards

- Service worker caching excludes `/api/` and `/voice/` routes.
- Netlify headers deny framing and MIME sniffing.
- The permissions policy allows only camera and microphone for this origin and denies unrelated sensitive APIs.
- The manifest is concise and does not claim unsupported OS privileges.

## Retention And Review

- Training changes should create versioned records.
- Admin actions should create audit events.
- Call recordings should have retention rules before production launch.
- Old transcripts and messages should be exportable and deletable by the account owner.

## Production Requirements Before Launch

- Add authenticated dashboard access.
- Add Supabase Auth user ownership throughout the app.
- Add server-side validation for all incoming Twilio webhooks.
- Add webhook signature verification.
- Add legal copy for call recording consent by jurisdiction.
- Add backup, deletion, and export workflows.
