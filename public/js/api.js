// Sunucu API istemcisi.

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `İstek başarısız oldu (${status})`);
    this.status = status;
    this.code = data?.code;
    this.data = data || {};
  }
}

async function request(method, url, body, opts = {}) {
  const headers = { 'X-Requested-With': 'dijital-garaj' };
  let payload;
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    payload = body;
    headers['Content-Type'] = body.type || 'application/octet-stream';
    if (opts.filename) headers['X-File-Name'] = encodeURIComponent(opts.filename);
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, { error: 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.', code: 'NETWORK' });
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const err = new ApiError(res.status, data && typeof data === 'object' ? data : { error: typeof data === 'string' && data.length < 300 ? data : undefined });
    if (res.status === 401 && !opts.quiet) window.dispatchEvent(new CustomEvent('dg:unauthorized'));
    if (err.code === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new CustomEvent('dg:password-change'));
    throw err;
  }
  return data;
}

export const api = {
  get: (url, opts) => request('GET', url, undefined, opts),
  post: (url, body, opts) => request('POST', url, body ?? {}, opts),
  put: (url, body) => request('PUT', url, body ?? {}),
  del: (url) => request('DELETE', url),
  upload: (file) => {
    if (file.size > 10 * 1024 * 1024) return Promise.reject(new ApiError(413, { error: 'Dosya 10 MB sınırını aşıyor' }));
    return request('POST', '/uploads', file, { filename: file.name });
  },
};

/** { a: 1, b: '' } → "?a=1" */
export function qs(obj = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
}

export const fileUrl = (id, download = false) => `/api/uploads/${id}${download ? '?download=1' : ''}`;
