# Aira Netlify conversation gateway

Prepared October 30, 2026 from the October 2 published Netlify UI. This is a separate deploy root from `superior-receptionist`, which serves the Render/phone backend.

## Production phone rollout

The user authorized production for a real phone test, confirmed Render workspace `tea-d2ob0lu3jp1c73fhb7d0`, and approved a 1 GB disk at $0.25/month.

- Netlify production: https://aira.superiorllc.org ; deployment `6ae5623c6a94ffb113181306`.
- Code release: `d401cfadcd0c8d3706ff14d229f53eccc3f4e584` on GitHub main. Earlier staged changes not included in that focused release remain in the local checkout.
- Live number: 844-685-7207. Twilio's POST webhook is `https://aira-web-service.onrender.com/voice/incoming`; status callback is `/voice/status`.
- Render sends timestamped HMAC-authenticated requests to `/api/phone-reply`. This endpoint uses live-phone instructions, not the simulator's practice instructions. Netlify and Render use their existing Twilio secret to authenticate these server-to-server requests; the secret is never sent in a request body or exposed to a browser.
- The custom Netlify Anthropic key is now retained only for dev and branch-deploy contexts. Production and deploy-preview use gateway-injected credentials. No new AI-provider account, plan, or auto-recharge was enabled.
- Render `AIRA_DATA_DIR=/var/data/aira` is beneath the approved disk mount `/var/data`. Disk-backed deploys briefly interrupt the single running service.
- Private backend APIs require `AIRA_OPERATOR_TOKEN`. The live dashboard accepts this under Voice and connection settings, stores it in sessionStorage, and sends it only to the configured backend origin. Retrieve the token through the authenticated Render environment settings; do not paste it into chat or Git.
- `/api/restore` is operator-authenticated and idempotently merges preserved call/message records. The pre-rollout snapshot is local, ignored, and not in this repository's published source.

Validation: 12 Netlify/phone-adapter tests and 20 backend/conversation tests passed locally. A signed request to the production phone-model endpoint returned a real model reply in about 2.5 seconds. This timing is one observation, not a latency guarantee. Actual caller audio quality still requires the user's phone test.

Render deployment `dep-dbim3rbil8vc739saoc0` reached live on release `d401cfadcd0c8d3706ff14d229f53eccc3f4e584`. Signed `/voice/incoming` and `/voice/respond` checks returned HTTP 200 and valid TwiML with the new greeting and a gateway-generated response. The preserved call record was restored. A synthetic "Aira deployment test" message increased the inbox count from zero to one only after confirmation. Two synthetic call records and that clearly labeled test message were retained for review. No outbound phone call or customer notification was sent by these checks.

## What changed

Dashboard access repair: verified authenticated `/api/status`, `/api/messages` and `/api/calls` each return HTTP 200 with the expected dashboard CORS origin. The open in-app browser was signed in and showed four call records and two messages. Check connection now refreshes both records lists; Refresh and the periodic update also refresh status, messages and calls together. Missing or rejected tokens are distinguished from backend/network errors. Authentication remains session-scoped, so a different browser session must sign in separately. No phone backend deployment was needed for this UI repair.

- Browser conversation requests use same-origin `/api/simulate`, served by a Netlify Function using the official Anthropic SDK. Netlify AI Gateway can inject its credentials at runtime.
- Trusted receptionist instructions stay on the server; caller-supplied training cannot override them. Input, history, response length, provider timeout and endpoint request rate are bounded.
- Message collection remembers supplied details, accepts corrections and optional contact details, answers common side questions, and requests confirmation. Practice conversations do not write inbox messages or promise delivery.
- Provider billing/configuration failures are visible while local message collection remains available.
- Function source is outside the public publish directory. Preview hosts default to no live Render inbox connection.

## Validate locally

Use Node 22.13 or later. Run `npm ci`, `npm test`, then `npm run preview`. Open http://localhost:3138. Plain local preview does not receive Netlify gateway credentials; model replies require a Netlify runtime or appropriately configured local provider credentials. Never put credentials in public files.

## Preview checkpoint (historical, before phone rollout)

Target project: `stately-syrniki-aa3804` (`0288f77d-2578-4ce5-9f5f-c3e9dd191fda`).

Configuration inspected in Chrome on October 30: team Pro plan, 3,423.8 credits available before testing, AI Features enabled. The custom `ANTHROPIC_API_KEY` originally applied to all contexts. It now applies to production, branch-deploy and dev only; its production value was verified unchanged. Removing its deploy-preview override permits automatic gateway credentials in drafts. Connector and CLI authentication have been restored. The live provider catalog confirms `claude-haiku-4-5` is supported.

Draft deployment: https://6ae5600ad6f84bcb6583c909--stately-syrniki-aa3804.netlify.app . The first gateway draft returned a real `mode: model` reply in approximately 2.3 seconds; Chrome also showed AI connected. This is one timing observation, not a latency guarantee. Function source and package metadata correctly return 404 from the public site. The production deploy remains `6ac059eb8a5287f162f91708`.

Local validation: 9 new tests plus 19 existing backend tests pass. Chrome confirmed combined details, number correction, reconfirmation and no practice delivery. `.netlify/` is ignored so local deployment metadata stays out of Git. Prior staged work remains intact; this preview has not been committed or pushed.

Final runtime verification: `mode: model` returned with `providerHost` equal to the Netlify draft hostname, confirming the SDK is routed through the injected Netlify gateway endpoint rather than `api.anthropic.com`. Only the hostname is returned; keys and full gateway URLs are never returned. One request immediately after the preceding deploy failed with a sanitized configuration error; subsequent requests recovered. The cause was not established. Preserve the visible fallback and monitor this before production cutover.

1. Confirm the existing project's AI Gateway is enabled and the team has usable Netlify credits. ChatGPT/Codex credits are separate. Both were verified for this draft.
2. Inspect project and team environment-variable names and scopes without exposing values. User-supplied `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` overrides gateway injection. Resolve overrides deliberately; do not delete shared team credentials used by other projects.
3. Check the gateway's current supported models. `AIRA_MODEL` may override the existing `claude-haiku-4-5` default.
4. From this directory, deploy a draft: `netlify deploy --site 0288f77d-2578-4ce5-9f5f-c3e9dd191fda --dir public --functions netlify/functions --context deploy-preview`. The CLI requires its build phase when selecting a context; do not add `--no-build`.
5. Test a synthetic general question (must return `mode: model`), correction/confirmation, and provider-failure behavior. Confirm no inbox records were created. Inspect function logs without storing caller details.

At this historical preview checkpoint, no production deployment, plan/recharge changes or phone-routing migration had been performed. Gateway smoke tests use the existing Netlify credit balance. Real phone audio, interruption behavior and Twilio/Render persistence require separate end-to-end verification. Publishing to production requires deliberately addressing the production Anthropic override; promoting a draft alone is not a verified production gateway migration.
