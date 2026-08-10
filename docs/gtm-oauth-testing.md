# Meridian Google Tag Manager OAuth testing

Meridian requests two Google OAuth scopes:

```text
https://www.googleapis.com/auth/tagmanager.edit.containers
https://www.googleapis.com/auth/tagmanager.edit.containerversions
```

Meridian can create a validated container version from a selected workspace.
There are no routes for publishing, deleting containers, or managing users.
Google Tag Manager must grant the user Account `User` and Container `Edit` plus
`Approve` access; `Publish` is not required.

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
renames it, deletes it, and deletes the workspace. The permission test itself
does not create a version or publish. If cleanup cannot finish, the response identifies the remaining GTM
resource paths under `evidence` and returns `cleanupRequired: true`.

## Tagging and unpublished version workflow

After binding a property to an account, container, and workspace, Studio uses:

```text
PUT  /api/integrations/gtm/property
GET  /api/integrations/gtm/assessment?propertyKey=PROPERTY_KEY
POST /api/integrations/gtm/decisions
POST /api/integrations/gtm/apply
POST /api/integrations/gtm/export
```

The export endpoint synchronizes the workspace, blocks on merge conflicts,
compiler errors, stale decisions, or any noncompliant tag, and then creates a
container version. It returns version metadata and a portable workspace package.
It does not publish the version.

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
both `0004_gtm_oauth.sql` and `0005_gtm_property_bindings.sql` remotely before
enabling the integration.
