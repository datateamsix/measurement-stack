import { createClerkClient } from '@clerk/backend';
import { HttpError } from './http.js';

function authorizedParties(request, env) {
  const configured = String(env.CLERK_AUTHORIZED_PARTIES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length ? configured : [new URL(request.url).origin];
}

export function clerkConfigured(env) {
  return Boolean(env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);
}

export async function authenticate(request, env, { required = true, includeUser = false } = {}) {
  if (!clerkConfigured(env)) {
    if (required) throw new HttpError(503, 'Clerk authentication is not configured.');
    return { configured: false, isAuthenticated: false, auth: null, user: null };
  }

  const client = createClerkClient({
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    secretKey: env.CLERK_SECRET_KEY,
  });

  try {
    const state = await client.authenticateRequest(request, {
      authorizedParties: authorizedParties(request, env),
      acceptsToken: 'session_token',
    });
    if (!state.isAuthenticated) {
      if (required) throw new HttpError(401, 'Authentication is required.');
      return { configured: true, isAuthenticated: false, auth: null, user: null };
    }
    const auth = state.toAuth();
    const user = includeUser && auth.userId ? await client.users.getUser(auth.userId) : null;
    return { configured: true, isAuthenticated: true, auth, user, client };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (required) throw new HttpError(401, 'The authentication token could not be verified.');
    return { configured: true, isAuthenticated: false, auth: null, user: null };
  }
}
