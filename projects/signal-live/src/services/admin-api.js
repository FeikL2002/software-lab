const API_BASE = '/.netlify/functions/api';

export class AdminApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'AdminApiError';
    this.code = code;
    this.status = status;
  }
}

export async function adminRequest(route, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}/${route}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new AdminApiError('The studio server could not be reached. Check your connection and try again.', 'NETWORK_ERROR', 0);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new AdminApiError('The secure studio API is unavailable. Use npm run dev:netlify for the full Netlify development server, or deploy the project with its Functions.', 'API_UNAVAILABLE', response.status);
  }
  const data = await response.json();
  if (!response.ok) {
    throw new AdminApiError(data.error?.message || data.message || 'Something went wrong. Please try again.', data.error?.code || 'API_ERROR', response.status);
  }
  return data;
}
