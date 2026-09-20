# AWS deployment runbook (not executed)

The supported infrastructure is CDK in `infra/stack.ts`. The original `infra/template.yaml` is a legacy single-workspace SAM prototype and must not be used for this tenant-aware build. A new CDK table has both partition and sort keys; do not point the new application at the old table without a reviewed migration.

1. Choose an AWS account/region and create an Amplify Next.js hosting app with its HTTPS origin. Configure an SSR compute role. Keep Cognito callbacks on the exact trusted origin.
2. Store independent `NEXTAUTH_SECRET` and `GROQ_API_KEY` values in Secrets Manager as JSON keys. Supply their ARNs to CDK. The same session secret must be available to Next.js and Lambda. Do not put plaintext credentials in shell history or source control.
3. Install/validate and package:
   ```sh
   npm ci
   npm run db:generate
   npm run check:infra
   npm run package:lambda
   npm run cdk -- bootstrap
   npm run cdk -- deploy --parameters ApplicationOrigin=https://your-echo-domain.example --parameters SessionSecretArn=YOUR_SECRET_ARN --parameters GroqSecretArn=YOUR_GROQ_SECRET_ARN
   ```
4. Read the stack outputs. Set the server variables in `.env.example`: `ECHO_STORAGE=aws`, table/bucket, API URL, region, Cognito issuer/client ID/client secret, session secret and `NEXTAUTH_URL`. Configure the client secret through a secret store; never output it in logs. Attach the generated FrontendPolicy to the Amplify SSR compute role. The Next.js server needs the tenant membership table because authorization is checked before signing a backend request.
5. Cognito's managed login handles signup, email verification and recovery. The stack enables optional TOTP and passkeys. Configure a valid managed-login domain, register passkeys against that domain, and verify factor compatibility in the target account. This has not been tested live.
6. Optional Google/Microsoft federation: register IdP applications, configure the Cognito provider and exact callbacks, add it to the app client's supported providers, and map verified email claims. Echo intentionally rejects unverified email claims and does not silently link local-password accounts to an external identity. Microsoft tenants that do not emit an email-verification claim need a reviewed identity policy before activation.
7. Production credential signup (if used instead of Cognito) needs an SES verified sender, production delivery access, `EMAIL_FROM`, and a scoped `ses:SendEmail` grant on the SSR role. Do not enable the development email helper.
8. Deploy the Next.js app with `amplify.yml`. Session/AI configuration is server-only. Use HTTPS. CSP and edge protections should be reviewed for the chosen host.
9. Complete every deployed-evidence item in [SECURITY.md](SECURITY.md), including live two-tenant negative tests, concurrent approvals, restore rehearsal, signed download expiry, session revocation and alarm delivery.

## Optional future transport

`-c enableIngestionBackbone=true` provisions EventBridge/SQS/DLQ infrastructure only. No source bindings or processing consumers are active. The integration contracts in `lib/integrations/contracts.ts` must be implemented and tested before advertising continuous ingestion.

## Operational limits

The comparison adapters cap each provider request at 12 seconds; there is at most one output-validation retry. Long-running source ingestion belongs on a queue in a later phase. The table repository loads a tenant snapshot and uses a tenant revision guard; paginate and benchmark before large organizations. An oversized transaction fails instead of partially updating knowledge. Stored source files may become unreferenced if a write fails after upload; an eventual orphan-cleanup policy is future work and must preserve retention requirements.

No deployment or AWS runtime validation was performed for this delivery.
