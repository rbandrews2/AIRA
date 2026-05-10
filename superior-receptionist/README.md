# AIRA AI Receptionist

AIRA AI is a progressive web app and receptionist backend for Superior Consultation, LLC. It is designed to act as a call assistant with secretary-like duties today, while laying the groundwork for a future AI smartphone operating-system layer.

## What AIRA Does

- Answers a company-controlled phone number through Twilio.
- Speaks as AIRA AI for Superior Consultation, LLC.
- Explains Work Zone OS - The operating system for desk-less workers.
- Screens calls, takes messages, transfers calls, and logs transcripts.
- Provides an installable PWA dashboard for training, messages, and call readiness.
- Includes Supabase schema and Edge Function starters for production persistence.

## Tech Stack

- Node.js + Express backend
- Twilio Voice webhooks
- Anthropic SDK for AI responses
- Static PWA frontend
- Supabase migration and Edge Function starter
- Netlify static hosting config

## Quick Start

```bash
npm install
copy .env.example .env
npm start
```

Open:

```text
http://localhost:3000
```

On macOS/Linux, use `cp .env.example .env` instead of `copy`.

## Environment Variables

Configure `.env`:

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

Do not commit `.env`. Keep production secrets in server environment variables or Supabase secrets.

## Twilio Setup

Twilio must be able to reach the backend over HTTPS.

For local testing:

```bash
npx ngrok http 3000
```

Configure the Twilio number:

- Incoming call: `POST https://YOUR_PUBLIC_URL/voice/incoming`
- Call status: `POST https://YOUR_PUBLIC_URL/voice/status`

## Supabase

The repo includes:

- `supabase/migrations/001_aira_ai_schema.sql`
- `supabase/functions/aira-assistant/index.ts`

Apply the database schema:

```bash
supabase db push
```

Deploy the Edge Function:

```bash
supabase functions deploy aira-assistant
```

## Deployment

The PWA can be deployed from `public` using Netlify. The Express/Twilio backend needs a Node-capable host unless it is later migrated to Netlify Functions or Supabase Edge Functions.

Useful production split:

- PWA: Netlify
- Voice backend: Render, Railway, Fly.io, DigitalOcean, AWS, GCP, Azure, Netlify Functions, or Supabase Edge Functions
- Database: Supabase

## Permissions And Safety

AIRA includes an install and permission screen for supported browser permissions such as camera/video and microphone.

A PWA cannot directly grant root, device admin, overlay, write-system-settings, SMS, cellular call recording, or cellular call control permissions. Those require legitimate native Android/iOS, carrier, or telephony-provider flows.

Recording is disabled by default. Enable recording only after adding proper caller disclosure, retention rules, and jurisdiction-specific review.

## Documentation

- `SETUP.md` - full setup and launch checklist
- `docs/PROJECT_MEMORY.md` - project direction and product assumptions
- `docs/DATA_PROTECTION.md` - data protection practices
- `docs/AIRA_TECH_RESEARCH.md` - technical research notes and sources

## License

This project uses the `AIRA AI Limited Use Source-Available License`.

GitHub license type: custom proprietary source-available limited-use license. It is public for review and collaboration, but it is not open source and cannot be used commercially or redistributed without written permission from Superior Consultation, LLC.

## Verification

```bash
node --check server.js
node --check public/app.js
npm start
```

Then test:

- `GET /health`
- PWA install panel
- Camera/microphone permission request
- Message form
- Training save
- Twilio incoming call webhook
