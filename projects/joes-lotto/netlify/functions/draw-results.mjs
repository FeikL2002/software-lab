import { drawResultsHandler } from '../../server/draw-results.mjs';

export default drawResultsHandler;
export const config = {
  path: '/api/draw-results',
  method: 'GET',
  rateLimit: { action: 'rate_limit', aggregateBy: 'ip', windowSize: 60, windowLimit: 120 },
};
