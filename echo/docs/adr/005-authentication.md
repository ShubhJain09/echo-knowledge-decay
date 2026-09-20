# ADR 005: Auth.js with server-resolved membership

Accepted. Auth.js provides encrypted JWT sessions, CSRF on authentication and Cognito OIDC state/nonce/PKCE. The application reloads membership by authenticated identity on every API request. Organization and role are never accepted from request JSON. A server-held session version enables all-device revocation and role-change invalidation.

Local credentials use salted scrypt and explicit email verification. Development-only token prefill enables an offline test; it is disabled in production and with AWS storage. Cognito is the deployment identity provider, including configured TOTP/passkeys and optional federation. No authentication capability is claimed live until it passes a deployed flow.
