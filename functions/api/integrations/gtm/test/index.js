import { runGtmMutationTest } from '../../../../lib/gtm-api.js';
import { markConnectionTest } from '../../../../lib/integration-store.js';
import { assertSameOrigin, integrationActor } from '../../../../lib/integration-session.js';
import { errorResponse, json, readJson } from '../../../../lib/http.js';

const CONFIRMATION = 'RUN MERIDIAN GTM TEST';

export async function onRequestPost(context) {
  let actor;
  try {
    assertSameOrigin(context.request);
    actor = await integrationActor(context.request, context.env);
    const body = await readJson(context.request);
    const selection = {
      accountId: body.accountId,
      containerId: body.containerId,
    };
    if (body.confirmation !== CONFIRMATION) {
      return json({
        ok: true,
        dryRun: true,
        confirmationRequired: CONFIRMATION,
        selection,
        plan: [
          'Create an isolated Meridian test workspace',
          'Create a paused Custom HTML tag with no triggers or executable script',
          'Read and rename the test tag',
          'Delete the test tag',
          'Delete the temporary workspace',
        ],
        publishAvailable: false,
      });
    }
    const result = await runGtmMutationTest(context.env, actor.actorKey, selection);
    await markConnectionTest(context.env, actor.actorKey, { ok: true });
    return json(result);
  } catch (error) {
    if (actor?.actorKey) {
      await markConnectionTest(context.env, actor.actorKey, { ok: false, error: error.message }).catch(() => {});
    }
    const response = errorResponse(error);
    if (error.testEvidence) {
      return json({
        error: error.message,
        evidence: error.testEvidence,
        cleanupRequired: Boolean(error.cleanupRequired),
      }, response.status);
    }
    return response;
  }
}
