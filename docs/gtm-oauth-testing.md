# Meridian Google Tag Manager OAuth testing

Meridian requests one Google OAuth scope:

```text
https://www.googleapis.com/auth/tagmanager.edit.containers
```

There are no routes for publishing, approving, creating container versions,
deleting containers, or managing users. Google Tag Manager must grant the test
user Account `User` and Container `Edit` access.

## Local setup

The Google OAuth web-client file stays at:

```text
.secrets/google-oauth-client.json
```

Its authorized redirect URI must include exactly:

```text
http://127.0.0.1:3000/api/integrations/google/callback
```

Prepare local Worker secrets, apply the D1 migration, and start Pages Functions:

```bash
npm run oauth:setup
npm run db:migrate:local
npm run dev
```

Neither `.secrets/` nor `.dev.vars` may be committed. The setup script copies the
web client ID and secret into Wrangler's ignored local-secret file and generates
separate 256-bit session and token-encryption secrets. It does not print them.

Open this URL in the same browser that will complete Google authorization:

```text
http://127.0.0.1:3000/api/integrations/google/authorize
```

After Google redirects back, inspect connection status:

```text
GET /api/integrations/google/status
GET /api/integrations/gtm/accounts
GET /api/integrations/gtm/containers?accountId=ACCOUNT_ID
GET /api/integrations/gtm/workspaces?accountId=ACCOUNT_ID&containerId=CONTAINER_ID
GET /api/integrations/gtm/resources?accountId=ACCOUNT_ID&containerId=CONTAINER_ID&workspaceId=WORKSPACE_ID
```

## Reversible mutation test

First send the request without the confirmation phrase to receive the dry-run
plan. Mutation requests must include the same-origin `Origin` header.

```http
POST /api/integrations/gtm/test
Content-Type: application/json
Origin: http://127.0.0.1:3000

{
  "accountId": "123456",
  "containerId": "654321"
}
```

To execute, add:

```json
"confirmation": "RUN MERIDIAN GTM TEST"
```

The test creates a temporary workspace, creates a paused no-trigger test tag,
renames it, deletes it, and deletes the workspace. It never creates a version or
publishes. If cleanup cannot finish, the response identifies the remaining GTM
resource paths under `evidence` and returns `cleanupRequired: true`.

## Production secrets

The Google OAuth client must also register the production callback exactly:

```text
https://measurementstack.com/api/integrations/google/callback
```

Set `GOOGLE_OAUTH_REDIRECT_URI` to that same URL in the production Pages
environment. Studio begins authorization from `/meridian/consent-studio/` and
returns there after the callback completes.

For a hosted test, store these as Cloudflare secrets rather than `vars`:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `OAUTH_SESSION_SECRET`
- `OAUTH_TOKEN_ENCRYPTION_KEY`

Set `MERIDIAN_GTM_TEST_MODE=false` when Clerk authentication is configured. Apply
the D1 migration remotely before enabling the integration.
