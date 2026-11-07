export async function api(route, options = {}) {
  const response = await fetch(`/.netlify/functions/api/${route}`, { credentials: 'same-origin', signal: AbortSignal.timeout(15000), ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The API is unavailable. Run Netlify Dev for server features.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.message || 'The request could not be completed.');
  return data;
}
