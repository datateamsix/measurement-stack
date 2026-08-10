import { exportPropertyVersion } from '../../../lib/gtm-workflow.js';
import { assertSameOrigin, integrationActor } from '../../../lib/integration-session.js';
import { HttpError, errorResponse, json, readJson } from '../../../lib/http.js';

const CONFIRMATION = 'CREATE UNPUBLISHED GTM VERSION';

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const actor = await integrationActor(context.request, context.env);
    const body = await readJson(context.request);
    if (body.confirmation !== CONFIRMATION) {
      return json({
        ok: true,
        dryRun: true,
        confirmationRequired: CONFIRMATION,
        publishAvailable: false,
        plan: [
          'Synchronize the selected workspace with the latest container state',
          'Block on merge conflicts or any noncompliant tag',
          'Create a named GTM container version from the validated workspace',
          'Return the version metadata and downloadable workspace package',
          'Leave the created version unpublished',
        ],
      });
    }
    if (!body.versionName) throw new HttpError(400, 'versionName is required.');
    return json(await exportPropertyVersion(context.env, actor.actorKey, body.propertyKey, {
      name: body.versionName,
      notes: body.notes,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
