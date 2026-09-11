import { setWriteAvailability } from './write-access.js';
export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const READ_API_PREFIX = '/api/read';
const WRITE_API_PREFIX = '/api/write';

function isReadMethod(method) {
  return ['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase());
}

export function apiPath(path, { method = 'GET' } = {}) {
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  return `${isReadMethod(method) ? READ_API_PREFIX : WRITE_API_PREFIX}${normalizedPath}`;
}

async function errorFromResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  let payload;
  try {
    payload = contentType.includes('application/json') ? await response.json() : await response.text();
  } catch {
    payload = null;
  }
  const message = payload?.error?.message || payload?.message || `Verzoek mislukt (${response.status})`;
  return new ApiError(message, response.status, payload?.error?.details);
}

function requestOptions(options = {}) {
  const request = {
    method: options.method || 'GET',
    headers: { ...(options.headers || {}) },
    signal: options.signal
  };
  if (options.body !== undefined) {
    request.headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(options.body);
  }
  return request;
}

export async function api(path, options = {}) {
  const request = requestOptions(options);
  const writeRequest = !isReadMethod(request.method);
  let response;
  try {
    response = await fetch(apiPath(path, { method: request.method }), request);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (writeRequest) setWriteAvailability(false);
    throw new ApiError(writeRequest
      ? 'De schrijf-API is niet bereikbaar vanaf dit netwerk.'
      : 'De server is niet bereikbaar.', 0, { cause: error.message });
  }
  const contentType = response.headers.get('content-type') || '';
  if (writeRequest) {
    const proxyDenied = [401, 403].includes(response.status)
      || ([404, 405].includes(response.status) && !contentType.includes('application/json'));
    setWriteAvailability(!proxyDenied);
  }
  if (!response.ok) throw await errorFromResponse(response);
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  return payload?.data ?? payload;
}

export async function downloadApi(path, options = {}) {
  const request = requestOptions(options);
  const writeRequest = !isReadMethod(request.method);
  let response;
  try {
    response = await fetch(apiPath(path, { method: request.method }), request);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (writeRequest) setWriteAvailability(false);
    throw new ApiError(writeRequest ? 'De schrijf-API is niet bereikbaar vanaf dit netwerk.' : 'De server is niet bereikbaar.', 0, { cause: error.message });
  }
  const contentType = response.headers.get('content-type') || '';
  if (writeRequest) {
    const proxyDenied = [401, 403].includes(response.status)
      || ([404, 405].includes(response.status) && !contentType.includes('application/json'));
    setWriteAvailability(!proxyDenied);
  }
  if (!response.ok) throw await errorFromResponse(response);

  const disposition = response.headers.get('content-disposition') || '';
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const filename = encodedName ? decodeURIComponent(encodedName) : (plainName || options.filename || 'download');
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (entry !== undefined && entry !== null && entry !== '') params.append(key, entry);
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}
