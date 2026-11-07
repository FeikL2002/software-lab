import { refreshWinners } from '../../server/api-handlers.mjs';
export default async function (_request, context) {
  try {
    const result = await refreshWinners(context);
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Ohio winner reports could not be refreshed.' }, { status: 503 });
  }
}
// Hourly in UTC, including while Joe has the app closed. Published deploys only.
export const config = { schedule: '0 * * * *' };
