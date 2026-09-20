import { NextRequest, NextResponse } from 'next/server';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import aws4 from 'aws4';
import { getToken } from 'next-auth/jwt';
import { dispatch } from '@/lib/service';
import { AppError } from '@/lib/errors';
import { requireActor } from '@/lib/auth/session';
import { checkOrigin, readJson, rateLimit } from '@/lib/auth/security';
import { account, publicUser, organization, members } from '@/lib/auth/accounts';
import { organizationAction } from '@/lib/service/organization';
import { can } from '@/lib/auth/rbac';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: NextRequest) {
  const started = Date.now();
  let requestId = '';
  try {
    const actor = await requireActor();
    requestId = actor.requestId;
    if (request.method !== 'GET' && !checkOrigin(request.headers.get('origin'), request.headers.get('host')))
      throw new AppError(403, 'Cross-origin requests are not allowed.');
    const body = request.method === 'GET' ? undefined : await readJson(request);
    const path = request.nextUrl.pathname;
    if (request.method === 'POST')
      await rateLimit(
        `${actor.organizationId}:${actor.id}:${path.includes('compare') || path.endsWith('/ask') ? 'ai' : 'write'}`,
        path.includes('compare') ? 10 : 60,
        60,
      );
    if (path.startsWith('/api/organization/')) {
      if (request.method !== 'POST') throw new AppError(405, 'Use POST.');
      return NextResponse.json(await organizationAction(path.split('/').pop()!, body, actor));
    }
    if (
      path.endsWith('/manage') &&
      typeof body?.assignedTo === 'string' &&
      !(await members(actor.organizationId)).some(m => m.id === body.assignedTo && can(m.role, 'review'))
    )
      throw new AppError(400, 'Assign a reviewer from this organization.');
    let result;
    if (process.env.ECHO_API_URL) {
      const jwt = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, raw: true });
      if (!jwt) throw new AppError(401, 'Session missing.');
      const remote = new URL(process.env.ECHO_API_URL.replace(/\/$/, '') + path.replace(/^\/api/, ''));
      const raw = body === undefined ? undefined : JSON.stringify(body);
      const signed = aws4.sign(
        {
          host: remote.host,
          path: remote.pathname,
          service: 'execute-api',
          region: process.env.AWS_REGION || 'us-east-1',
          method: request.method,
          body: raw,
          headers: { 'Content-Type': 'application/json', 'X-Echo-Session': jwt },
        },
        await defaultProvider()(),
      );
      const headers = Object.fromEntries(Object.entries(signed.headers || {}).map(([k, v]) => [k, String(v)]));
      delete headers.Host;
      delete headers['Content-Length'];
      const response = await fetch(remote, {
        method: request.method,
        headers,
        body: raw,
        cache: 'no-store',
        signal: AbortSignal.timeout(55000),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new AppError(response.status, error.error || 'Backend request failed.');
      }
      const payload = await response.json();
      result = payload.url ? { url: String(payload.url) } : { body: payload };
    } else result = await dispatch(request.method, path, body, actor);
    if (path === '/api/workspace') {
      const row = (await account(actor.email))!;
      const state = result.body as Record<string, unknown>;
      if (!can(actor.role, 'audit')) state.audit = [];
      result.body = {
        ...state,
        user: publicUser(row.data),
        organization: await organization(actor.organizationId),
        members: await members(actor.organizationId),
        mode: { ai: process.env.ECHO_AI || 'groq', storage: process.env.ECHO_STORAGE || 'sqlite' },
      };
    }
    if ('url' in result && result.url) return NextResponse.redirect(result.url);
    if ('bytes' in result && result.bytes)
      return new NextResponse(new Uint8Array(result.bytes), {
        headers: {
          'Content-Type': result.mime!,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.name!)}`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    return NextResponse.json(result.body, {
      status: 'status' in result ? result.status || 200 : 200,
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (e) {
    console.error(
      JSON.stringify({
        event: 'request.failed',
        requestId,
        error: e instanceof AppError ? e.message : 'InternalError',
        durationMs: Date.now() - started,
      }),
    );
    return NextResponse.json(
      { error: e instanceof AppError ? e.message : 'The service could not complete this request.' },
      { status: e instanceof AppError ? e.status : 500 },
    );
  }
}
export const GET = handle;
export const POST = handle;
