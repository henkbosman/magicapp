import { isIP } from 'node:net';

function parsedOrigin(value) {
  try {
    return new URL(String(value)).origin.toLowerCase();
  } catch {
    return '';
  }
}

function hostnameFromHost(host) {
  try {
    return new URL(`http://${String(host)}`).hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  } catch {
    return '';
  }
}

function isTrustedLocalHost(host) {
  const hostname = hostnameFromHost(host);
  if (!hostname) return false;
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return true;
  if (!hostname.includes('.') && !hostname.includes(':')) return true;
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    if (/^127\./u.test(hostname) || /^10\./u.test(hostname) || /^192\.168\./u.test(hostname)) return true;
    const ipv4 = hostname.match(/^172\.(\d+)\./u);
    return Boolean(ipv4 && Number(ipv4[1]) >= 16 && Number(ipv4[1]) <= 31);
  }
  return ipVersion === 6 && (hostname === '::1' || /^(?:fc|fd|fe8|fe9|fea|feb)/u.test(hostname));
}

export function isCrossOriginBrowserRequest({ origin = '', host = '', fetchSite = '', allowedOrigin = '' } = {}) {
  const site = String(fetchSite).toLowerCase();
  const requestOrigin = origin ? parsedOrigin(origin) : '';
  const trustedOrigin = allowedOrigin ? parsedOrigin(allowedOrigin) : '';

  // PUBLIC_ORIGIN is the authoritative check when a deployment has a stable
  // external URL. It also remains correct when a reverse proxy rewrites Host.
  if (origin && allowedOrigin && (!trustedOrigin || !requestOrigin || requestOrigin !== trustedOrigin)) return true;
  if (site === 'cross-site' || site === 'same-site') return true;
  if (!origin) return false;

  if (trustedOrigin && requestOrigin === trustedOrigin) return false;

  // Without an explicit public origin, browser writes are limited to normal
  // LAN/loopback hostnames and private addresses. This rejects DNS-rebinding
  // hostnames while preserving the app's local-first default.
  return !requestOrigin
    || new URL(requestOrigin).host !== String(host).toLowerCase()
    || !isTrustedLocalHost(host);
}
