# Aira Netlify conversation preview

Prepared October 30, 2026 from the October 2 published Netlify UI. This is a separate deploy root from `superior-receptionist`, which serves the Render/phone backend.

## What changed

- Browser conversation requests use same-origin `/api/simulate`, served by a Netlify Function using the official Anthropic SDK. Netlify AI Gateway can inject its credentials at runtime.
- Trusted receptionist instructions stay on the server; caller-supplied training cannot override them. Input, history, response length, provider timeout and endpoint request rate are bounded.
- Message collection remembers supplied details, accepts corrections and optional contact details, answers common side questions, and requests confirmation. Practice conversations do not write inbox messages or promise delivery.
- Provider billing/configuration failures are visible while local message collection remains available.
- Function source is outside the public publish directory. Preview hosts default to no live Render inbox connection.

## Validate locally

Use Node 22.13 or later. Run `npm ci`, `npm test`, then `npm run preview`. Open http://localhost:3138. Plain local preview does not receive Netlify gateway credentials; model replies require a Netlify runtime or appropriately configured local provider credentials. Never put credentials in public files.

## Gateway configuration and draft deployment

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

No production deployment, plan/recharge changes or phone-routing migration has been performed by this preview. Gateway smoke tests use the existing Netlify credit balance. Real phone audio, interruption behavior and Twilio/Render persistence require separate end-to-end verification. Publishing to production requires deliberately addressing the production Anthropic override; promoting a draft alone is not a verified production gateway migration.
