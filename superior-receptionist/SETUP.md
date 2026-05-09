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
```

Keep `AIRA_RECORD_CALLS=false` until recording consent, retention rules, and legal review are complete.

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

- Voice profiles.
- Training versions.
- Messages.
- Calls.
- Call transcript turns.
- Audit events.

Row-level security is enabled in the migration.

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
