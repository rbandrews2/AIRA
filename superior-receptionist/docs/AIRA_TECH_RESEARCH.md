# AIRA AI Technical Research Notes

Date: 2026-05-09

## Product Direction

AIRA AI should be built as a consent-first receptionist platform:

- PWA for the owner/operator console.
- Supabase for readable call, transcript, message, training, and audit records.
- Telephony provider or carrier integration for business-number call answering, transfers, hold music, SMS, and call recording.
- Native Android/iOS companion apps only for OS-approved capabilities.
- On-device AI where possible for fast, private, low-latency caller notes, message summaries, and owner-side assistant features.

## What The Research Supports

Qualcomm's on-device AI material emphasizes privacy, responsiveness, personalization, reliability, and reduced cloud dependency. That supports an AIRA roadmap where sensitive owner-side context, preference learning, and quick summaries can run locally when device hardware supports it.

GSMA and GSMA Intelligence coverage of distributed inference and edge AI points toward a hybrid model: mobile networks, edge compute, and device AI share the workload. That is the right architecture for AIRA because real-time calls cannot depend on one overloaded remote service.

ABI Research projects strong growth for on-device AI chipsets and smartphone GenAI support. That supports designing AIRA's data model now so locally generated summaries, intent labels, and personal preferences can be synced later.

Android's official Telecom documentation shows the legitimate path for call screening is a user-chosen role using `CallScreeningService`; it is not a hidden super-user permission. Android can support call screening and caller ID through approved roles, but answering, ending, and recording PSTN calls remains restricted by OS, default dialer, carrier, and app-store rules.

Apple's CallKit documentation supports native VoIP call UI integration, not unrestricted interception or recording of normal cellular phone calls. iOS apps must use system-approved VoIP flows and user-visible permissions.

## Practical Architecture

The build should avoid invasive phone behavior:

1. Route business calls to a telephony number controlled by the company.
2. Let AIRA answer that business number through Twilio, SIP, or a similar provider.
3. Store every call event in Supabase with clear retention rules.
4. Record only when legally allowed and after a caller disclosure.
5. Use Android call-screening role only for a future native Android companion, and only after the user explicitly grants that role.
6. Use iOS CallKit only for AIRA's own VoIP calls, not hidden cellular call access.

## Sources

- Qualcomm, Mobile AI Solutions: https://www.qualcomm.com/smartphones/features/mobile-ai
- Qualcomm, 5 benefits of on-device generative AI: https://www.qualcomm.com/news/onq/2023/08/5-benefits-of-on-device-generative-ai
- GSMA, Distributed inference: AI adds a new dimension at the edge: https://www.gsma.com/newsroom/article/distributed-inference-ai-adds-a-new-dimension-at-the-edge/
- GSMA, AI technology programs powering mobile networks: https://www.gsma.com/solutions-and-impact/technologies/artificial-intelligence/ai-technology/
- ABI Research, on-device generative AI chipset shipment forecast: https://www.abiresearch.com/press/on-device-generative-ai-expected-to-drive-heterogenous-ai-chipset-shipments-to-over-18-billion-by-2030
- ABI Research, on-device AI chipset shipments: https://www.abiresearch.com/news-resources/chart-data/mobile-pc-productivity-ai-chipset-shipments/
- Android Developers, Screen calls: https://developer.android.com/develop/connectivity/telecom/dialer-app/screen-calls
- Android Developers, CallScreeningService: https://developer.android.com/reference/android/telecom/CallScreeningService.html
- Apple Developer, CallKit: https://developer.apple.com/documentation/callkit
