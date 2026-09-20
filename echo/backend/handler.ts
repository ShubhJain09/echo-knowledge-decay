import type { APIGatewayProxyHandler } from 'aws-lambda';
import { decode } from 'next-auth/jwt';
import { dispatch } from '../lib/service';
import { account } from '../lib/auth/accounts';
import { AppError } from '../lib/errors';
import { rateLimit } from '../lib/auth/security';
import { can } from '../lib/auth/rbac';
export const handler: APIGatewayProxyHandler = async event => {
  try {
    const token = event.headers['X-Echo-Session'] || event.headers['x-echo-session'];
    if (!process.env.NEXTAUTH_SECRET || !token) throw new AppError(401, 'Authentication required.');
    const jwt = await decode({ token, secret: process.env.NEXTAUTH_SECRET });
    const row = jwt?.email ? await account(jwt.email) : undefined;
    if (!row || row.data.status !== 'active' || jwt?.sessionVersion !== row.data.sessionVersion)
      throw new AppError(401, 'Session expired.');
    const u = row.data;
    const actor = {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      organizationId: u.organizationId,
      requestId: event.requestContext.requestId,
    };
    const raw = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : '';
    if (Buffer.byteLength(raw) > 3000000) throw new AppError(413, 'Request too large.');
    if (
      event.httpMethod !== 'GET' &&
      !/application\/json/i.test(event.headers['content-type'] || event.headers['Content-Type'] || '')
    )
      throw new AppError(415, 'Use application/json.');
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      throw new AppError(400, 'Invalid JSON.');
    }
    if (event.httpMethod !== 'GET') await rateLimit(`lambda:${u.organizationId}:${u.id}`, 60, 60);
    const result = await dispatch(event.httpMethod, `/api${event.path}`, body, actor);
    if (event.path === '/workspace' && !can(actor.role, 'audit')) (result.body as { audit: unknown[] }).audit = [];
    return {
      statusCode: result.status || 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(result.url ? { url: result.url } : result.body),
    };
  } catch (e) {
    console.error(
      JSON.stringify({
        event: 'lambda.failed',
        requestId: event.requestContext.requestId,
        error: e instanceof AppError ? e.message : 'InternalError',
      }),
    );
    return {
      statusCode: e instanceof AppError ? e.status : 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: e instanceof AppError ? e.message : 'Backend request failed.' }),
    };
  }
};
