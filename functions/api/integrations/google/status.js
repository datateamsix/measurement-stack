import { GTM_REQUIRED_SCOPES } from '../../../lib/google-oauth.js';
import { connectionRecord } from '../../../lib/integration-store.js';
import { appendSetCookie, integrationActor } from '../../../lib/integration-session.js';
import { errorResponse, json } from '../../../lib/http.js';

export async function onRequestGet(context) {
  try {
    const actor = await integrationActor(context.request, context.env, { allowCreate: true });
    const record = await connectionRecord(context.env, actor.actorKey);
    const grantedScopes = new Set(String(record?.granted_scope || '').split(/\s+/u).filter(Boolean));
    const missingScopes = GTM_REQUIRED_SCOPES.filter((scope) => !grantedScopes.has(scope));
    return appendSetCookie(json({
      configured: Boolean(
        context.env.GOOGLE_CLIENT_ID
        && context.env.GOOGLE_CLIENT_SECRET
        && context.env.GOOGLE_OAUTH_REDIRECT_URI
        && context.env.OAUTH_TOKEN_ENCRYPTION_KEY
        && (context.env.MEASUREMENT_STACK_DB || context.env.DB)
      ),
      connected: record?.status === 'connected',
      status: record?.status || 'disconnected',
      scope: GTM_REQUIRED_SCOPES.join(' '),
      requiredScopes: GTM_REQUIRED_SCOPES,
      grantedScope: record?.granted_scope || '',
      reauthorizationRequired: record?.status === 'connected' && missingScopes.length > 0,
      missingScopes,
      connectedAt: record?.created_at || null,
      updatedAt: record?.updated_at || null,
      lastTestedAt: record?.last_tested_at || null,
      lastError: record?.last_error || null,
      authMode: actor.mode,
      capabilities: {
        listAccounts: true,
        listContainers: true,
        listWorkspaces: true,
        editWorkspaceEntities: true,
        publish: false,
        createVersion: missingScopes.length === 0,
        deleteContainer: false,
        manageUsers: false,
      },
    }), actor.setCookie);
  } catch (error) {
    return errorResponse(error);
  }
}
