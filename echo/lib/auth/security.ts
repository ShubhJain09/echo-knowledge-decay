import { createHash } from 'node:crypto';
import { store } from '../db/store';
import { AppError } from '../errors';
export function checkOrigin(origin: string | null, host: string | null) {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    const configured = process.env.NEXTAUTH_URL;
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      url.host === host &&
      (!configured || url.origin === new URL(configured).origin)
    );
  } catch {
    return false;
  }
}
/**
 * Durable fixed-window limits shared by workers; conditional writes fail closed.
 * Lost updates are retried with jitter so that genuinely concurrent requests from one user are counted
 * rather than rejected: a bare compare-and-set retried only a few times returned 429 while under the limit.
 */
export async function rateLimit(key: string, limit: number, seconds: number) {
  const window = Math.floor(Date.now() / (seconds * 1000));
  const pk = `RATE#${createHash('sha256').update(key).digest('hex')}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const old = await store().get<{ window: number; count: number }>(pk, 'RATE');
    const count = old?.data.window === window ? old.data.count + 1 : 1;
    if (count > limit) throw new AppError(429, 'Too many requests. Please try again later.');
    try {
      await store().write([
        {
          row: { pk, sk: 'RATE', organizationId: 'system', revision: (old?.revision ?? -1) + 1, data: { window, count } },
          expected: old?.revision ?? -1,
        },
      ]);
      return;
    } catch (e) {
      if (!(e instanceof AppError) || e.status !== 409) throw e;
      await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (5 * 2 ** attempt))));
    }
  }
  throw new AppError(429, 'Too many requests. Please try again later.');
}
export async function readJson(request: Request, limit = 3000000) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
    throw new AppError(415, 'Use application/json.');
  if (Number(request.headers.get('content-length')) > limit) throw new AppError(413, 'Request is too large.');
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader)
    while (true) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new AppError(413, 'Request is too large.');
      }
      chunks.push(p.value);
    }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'Invalid JSON request.');
  }
}
