# Echo implementation status

This build continues the prototype referenced in the supplied documents. The original Downloads project is unchanged. The deliverable is this `echo/` workspace copy. The user requested local execution only; no AWS resources or public website were deployed.

## Working locally

- Next.js App Router, strict TypeScript, React, Tailwind, accessible Radix/shadcn-style controls and a dark workspace.
- Account signup, development email verification, Auth.js credential login, revocable eight-hour sessions, password change and sign-out-all. Local passwords use salted scrypt.
- Organizations, invitation links bound to a verified email, server-enforced Owner/Admin/Reviewer/Editor/Viewer/Auditor permissions.
- Prisma/SQLite persistence, original evidence retention, SHA-256 deduplication per card, PDF/TXT/Markdown ingestion, size/encoding validation.
- Stable Groq/Bedrock comparison contract, strict JSON and exact-substring quote validation, one constrained retry, typed failures and failure audit events. Demo mode is explicitly rule-based and whole-word matched; `npm run eval` fails on any mislabelled relation.
- Atomic review/knowledge/audit transactions, conditional versions, update/keep/archive, assignment, snooze, evidence requests and rollback as a new version.
- Immutable version records. Archived/current status derives from the canonical card pointer when reading history.
- Audit records use one shape for every event (`{ cards, reviews }`), so exporters never branch on the payload.
- Identity events (sign-in, profile, password, membership) append a single audit row instead of taking the tenant knowledge transaction, so they cannot contend with a concurrent review.
- Current-only extractive answers with validated numbered citations, source/version/verification date and insufficient-evidence handling. Expired/future validity windows are excluded.
- Dashboard, knowledge search and topic/owner/status/due filters, evidence library, version timeline, why-current panel, member/settings screens and audit center.
- Manual freshness checks create idempotent policy reviews; no automatic scheduler is claimed.
- Unit, integration, React Testing Library and Playwright tests, CI, and a labeled eight-relation smoke evaluation.

## AWS code supplied; runtime NOT verified

- DynamoDB partition-scoped queries and conditional transactions; immutable versions stored separately from cards.
- Tenant-prefixed S3 objects and short-lived signed downloads.
- CDK Cognito, IAM-protected API Gateway, Lambda, DynamoDB, private/versioned S3, CloudWatch dashboard and alarms. Amplify build configuration and scoped SSR policy are supplied.
- Auth.js Cognito OIDC with PKCE/state/nonce. Infrastructure configures optional TOTP MFA and passkeys on the Essentials plan; actual enrollment/login depends on deployment, region and managed-login configuration.
- Google/Microsoft federation requires customer-owned provider credentials and verified email mappings. Do not claim SSO is live before testing those flows.
- Groq requires a key. Bedrock fails closed until `BEDROCK_RUNTIME_VERIFIED=true` and a model ID are supplied after a real invocation test.
- Production credential signup requires SES email configuration. Development verification is refused in production and with AWS storage.

## Remaining work

Phase 1 is **not declared production-complete**. External runtime validation, account avatars, editable email, per-device session listings, local MFA/passkey enrollment, team/date/risk filter taxonomy, configurable organization review policies, notifications, and deployed security verification remain open. Sensitivity is metadata, not a document ACL. Account/organization audit writes are separate from identity updates, unlike atomic knowledge review transactions. Large tenant snapshots need pagination and scale testing. SQLite concurrency tests do not replace deployed DynamoDB tests.

Phase 2–5 connector, retrieval, graph, enterprise and scheduler interfaces are scaffolds. No real-time monitoring, automatic source ingestion, SCIM, legal hold, retention enforcement, embeddings or dependency graph is claimed.

The source PDF's earlier implementation claims were checked against code. The master prompt was treated as the requested build specification, not authorization to publish or send third-party messages.
