# Security implementation and deployment verification

No AWS resource has been deployed in this delivery. “Defined” below describes code, not a verified live control. This is not a security certification.

| Control | Implementation / planned resource | Local evidence | Deployment evidence needed |
|---|---|---|---|
| Credentials server-side | Auth.js options, AI adapters, Amplify server allowlist | Client imports contain no secrets | Inspect deployed bundles and secret access |
| Signed/encrypted expiring sessions | Auth.js JWT, 8h; secure cookies on HTTPS, httpOnly, SameSite=Lax defaults | Signup/login E2E; account/session checks | HTTPS cookie capture, invalid/expired-token tests |
| Revoke all sessions | Server user `sessionVersion` checked on every API request and Lambda invocation | Identity tests; account endpoint | Cross-instance logout test |
| Password storage | Random salts and scrypt; timing-safe hash comparison | Password tests | Cognito policy and real account recovery |
| CSRF/origin | Auth.js CSRF; application mutations require a present trusted Origin matching configured origin | Origin unit tests and hostile-origin E2E | Proxy/forwarding header review |
| Input/file limits | Zod strict input schemas; streamed body cap; file type/base64/PDF validation | Ingestion and boundary tests | Gateway request limits/load test |
| Tenant isolation | Identity-derived org, Query by `ORG#id`, account membership recheck, S3 tenant prefix | Cross-tenant service tests | Live Dynamo/S3 IDOR suite; IAM conditions audit |
| Roles | Central RBAC in service; owner restrictions on admin invitations and role changes | RBAC matrix, forged-role tests | Deployed API and IAM bypass tests |
| S3 private/encrypted/TLS | `EchoStack/EvidenceBucket`: blocked public access, versioned, AES256, SSL/TLS >=1.2 | CDK assertions | Bucket policy/object ACL/signed URL checks |
| Dynamo encrypted/backed up | `EchoStack/KnowledgeTable`: managed encryption, PITR, retained deletion policy | CDK assertions | Resource configuration and restore rehearsal |
| AI guardrails | Provider-independent JSON schema, exact quotes, single retry, human decision | Contract and invalid-provider integration tests | Provider-specific prompt-injection evaluation |
| Citation integrity | Pure parser, retrieved current versions, exact source excerpts | Citation edge-case tests and lifecycle tests | Deployed provider/retrieval regression |
| Rate limits | Durable conditional counters by account/user; shared ingress limiter | Counter tests | Trusted edge per-IP throttles/WAF still required |
| Idempotency/concurrency | Deterministic comparison key; content hash; conditional tenant revision and changed rows | SQLite concurrent-approval tests, Dynamo command assertions | Deployed concurrent Dynamo review tests |
| Provenance/audit | Immutable version rows, atomic review + knowledge + audit; auth/admin audit events | Lifecycle and review persistence tests | Restrict table write privileges; export/retention policy |
| Observability | JSON request/entity IDs; API/Lambda metrics, dashboard, two alarms | CDK synthesis | Alarm destinations and operational drills |
| Auth factors | Cognito Essentials managed login; TOTP optional; WebAuthn enabled | CDK template only | Actual MFA/passkey enrollment/login and recovery |
| Federation | Cognito provider boundary; Google/Microsoft credential configuration required | No live assertion | Federation configuration and verified-email mappings |

## Known limitations

Sensitivity labels are informational; source-level ACLs are not implemented. Audit records are append-only through the application, but the database administrator can change them; no WORM guarantee is claimed. Account and organization changes emit audit separately, so transactional administrative auditing remains work. Local verification tokens appear only in explicit development mode, and are never proof of email ownership. No IP address is trusted from client-supplied forwarding headers; deploy an authenticated edge/WAF policy for per-IP throttling. No deployment action, email invitation delivery, live Groq invocation, Bedrock invocation or identity-provider login was performed for this local-only request.
