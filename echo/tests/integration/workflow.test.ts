import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../../lib/db/store';
import { TenantRepository } from '../../lib/repository';
import { dispatch } from '../../lib/service';
import type { Actor } from '../../lib/auth/rbac';
import type { Answer, Card, Evidence, Review } from '../../lib/types';
import { ask } from '../../lib/intelligence';
let root: string, db: SqliteStore, repo: TenantRepository;
const actor: Actor = {
  id: 'owner',
  organizationId: 'tenant-a',
  name: 'Rahul',
  email: 'rahul@example.test',
  role: 'Owner',
  requestId: 'test-request',
};
const update =
  'The payment deployment pipeline now automatically restarts Service X after every successful deployment. Engineers no longer need to restart Service X manually. If the automated restart fails, follow the incident response runbook.';
const call = async <T>(method: string, url: string, body?: unknown, who = actor, r = repo) =>
  (await dispatch(method, `/api/${url}`, body, who, r)).body as T;
const evidence = (content = update) =>
  call<Evidence>('POST', 'evidence', {
    cardId: 'payment-deployment',
    name: 'deployment-update-groq.txt',
    content,
    encoding: 'text',
  });
const review = async () => {
  const e = await evidence();
  return call<Review>('POST', `evidence/${e.id}/compare`, {});
};
beforeEach(async () => {
  process.env.ECHO_AI = 'demo';
  process.env.ECHO_STORAGE = 'sqlite';
  root = await mkdtemp(path.join(os.tmpdir(), 'echo-test-'));
  db = new SqliteStore(`file:${root}/test.db`);
  await db.db.$executeRawUnsafe(
    'CREATE TABLE "Record" ("pk" TEXT NOT NULL,"sk" TEXT NOT NULL,"organizationId" TEXT NOT NULL,"revision" INTEGER NOT NULL,"data" TEXT NOT NULL,PRIMARY KEY ("pk","sk"))',
  );
  repo = new TenantRepository('tenant-a', db, root);
  await call('POST', 'seed', {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.db.$disconnect();
  if (root.startsWith(path.join(os.tmpdir(), 'echo-test-'))) await rm(root, { recursive: true, force: true });
});
it('complete Service X lifecycle creates immutable v2 and answers only from v2', async () => {
  const r = await review();
  expect(r.relation).toBe('process_change');
  expect((await repo.snapshot()).cards[0].version).toBe(1);
  const result = await call<{ card: Card }>('POST', `reviews/${r.id}/decision`, {
    decision: 'update',
    expectedVersion: 1,
    note: 'Verified the pipeline behavior',
    statement: update,
  });
  expect(result.card.version).toBe(2);
  expect(result.card.history[0].status).toBe('archived');
  expect(result.card.history[1].status).toBe('verified');
  expect(result.card.history[1].author).toBe('Rahul');
  const answer = await call<Answer>('POST', 'ask', { question: 'Service X after deployment' });
  expect(answer.text).toContain('automatically');
  expect(answer.text).not.toContain('Manually restart');
  expect(answer.citations[0].version).toBe(2);
  expect(answer.citations[0].verifiedAt).toBeTruthy();
  const original = (await db.get<Card['history'][number]>('ORG#tenant-a', 'VERSION#payment-deployment#00000001'))!;
  expect(original.revision).toBe(0);
  expect(original.data.statement).toContain('Manually');
  expect((await repo.snapshot()).audit.some(e => e.action === 'review.update')).toBe(true);
});
it('two concurrent approvals produce exactly one new version', async () => {
  const r = await review();
  const payload = { decision: 'update', expectedVersion: 1, note: 'Reviewed', statement: update };
  const result = await Promise.allSettled([
    call('POST', `reviews/${r.id}/decision`, payload),
    call('POST', `reviews/${r.id}/decision`, payload),
  ]);
  expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const failure = result.find(r => r.status === 'rejected') as PromiseRejectedResult;
  expect(failure.reason.status).toBe(409);
  expect((await repo.snapshot()).cards.find(c => c.id === r.cardId)?.history).toHaveLength(2);
});
it('stale expectedVersion is rejected with the prescribed message', async () => {
  const r = await review();
  await expect(
    call('POST', `reviews/${r.id}/decision`, { decision: 'update', expectedVersion: 2, note: 'Reviewed', statement: update }),
  ).rejects.toThrow('This knowledge changed while you were reviewing it. Refresh before approving.');
});
it('keep refreshes verification without changing the version and remains idempotent', async () => {
  const r = await review();
  await call('POST', `reviews/${r.id}/decision`, { decision: 'keep', expectedVersion: 1, note: 'Staging evidence only' });
  expect((await repo.snapshot()).cards.find(c => c.id === r.cardId)?.version).toBe(1);
  const e = await evidence();
  const again = await call<Review>('POST', `evidence/${e.id}/compare`, {});
  expect(again.id).toBe(r.id);
  expect(again.status).toBe('resolved');
});
it('archive preserves all versions and excludes knowledge from answers', async () => {
  const r = await review();
  await call('POST', `reviews/${r.id}/decision`, { decision: 'archive', expectedVersion: 1, note: 'Service retired' });
  const c = (await repo.snapshot()).cards.find(c => c.id === r.cardId)!;
  expect(c.history).toHaveLength(2);
  expect(c.history.every(v => v.status === 'archived')).toBe(true);
  expect((await ask('Service X', [c])).citations).toHaveLength(0);
});
it('rollback creates v3 and preserves provenance', async () => {
  const r = await review();
  await call('POST', `reviews/${r.id}/decision`, { decision: 'update', expectedVersion: 1, note: 'Reviewed', statement: update });
  const c = await call<Card>('POST', 'knowledge/payment-deployment/rollback', {
    expectedVersion: 2,
    version: 1,
    reason: 'Automation reverted',
  });
  expect(c.version).toBe(3);
  expect(c.statement).toContain('Manually');
  expect(c.history.at(-1)?.rollbackFrom).toBe(1);
  expect((await repo.snapshot()).cards.find(c => c.id === r.cardId)?.history).toHaveLength(3);
});
it('duplicates reuse evidence and comparisons', async () => {
  const a = await evidence();
  const b = await evidence();
  expect(a.id).toBe(b.id);
  expect((await repo.document(a.id)).toString()).toBe(update);
  const r = await review();
  const again = await review();
  expect(r.id).toBe(again.id);
  expect((await repo.snapshot()).evidence).toHaveLength(1);
});
it('tenant isolation prevents listing, downloading and reviewing another organization', async () => {
  const e = await evidence();
  const r = await review();
  const other = { ...actor, organizationId: 'tenant-b' };
  const otherRepo = new TenantRepository('tenant-b', db, root);
  expect((await otherRepo.snapshot()).cards).toHaveLength(0);
  await expect(call('GET', `evidence/${e.id}`, undefined, other, otherRepo)).rejects.toMatchObject({ status: 404 });
  await expect(
    call('POST', `reviews/${r.id}/decision`, { decision: 'keep', expectedVersion: 1, note: 'Reviewed' }, other, otherRepo),
  ).rejects.toMatchObject({ status: 404 });
  await expect(call('GET', 'workspace', undefined, other, repo)).rejects.toMatchObject({ status: 403 });
});
it.each(['Viewer', 'Editor', 'Auditor'] as const)(
  '%s cannot approve even with forged reviewer/organization fields',
  async role => {
    const r = await review();
    await expect(
      call(
        'POST',
        `reviews/${r.id}/decision`,
        { decision: 'keep', expectedVersion: 1, note: 'Forged', reviewer: 'Owner', organizationId: 'tenant-a' },
        { ...actor, role },
      ),
    ).rejects.toMatchObject({ status: 403 });
  },
);
it('rejects tenant and identity overrides at the boundary', async () => {
  await expect(
    call('POST', 'knowledge', { title: 'T', topic: 'T', owner: 'O', statement: 'S', source: 'S', organizationId: 'other' }),
  ).rejects.toMatchObject({ status: 400 });
});
it('invalid model quotes never create a review or modify knowledge, and record an AI failure', async () => {
  process.env.ECHO_AI = 'groq';
  process.env.GROQ_API_KEY = 'test-only';
  const e = await evidence();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    relation: 'process_change',
                    needsReview: true,
                    explanation: 'The process changed in a meaningful way.',
                    oldQuote: 'Invented quote',
                    newQuote: update,
                    proposedStatement: update,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    ),
  );
  await expect(call('POST', `evidence/${e.id}/compare`, {})).rejects.toMatchObject({ status: 502 });
  const d = await repo.snapshot();
  expect(d.reviews).toHaveLength(0);
  expect(d.cards.find(c => c.id === 'payment-deployment')?.version).toBe(1);
  expect(d.audit.some(a => a.action === 'ai.failed')).toBe(true);
  vi.unstubAllGlobals();
});
it('freshness expiration creates one policy review per verification period', async () => {
  await repo.mutate(actor, 'test.expire', 'payment-deployment', d => {
    d.cards[0].nextReviewAt = '2020-01-01T00:00:00Z';
  });
  await call('POST', 'freshness', {});
  await call('POST', 'freshness', {});
  expect((await repo.snapshot()).reviews.filter(r => r.engine === 'policy')).toHaveLength(1);
});
it('expired validity windows are excluded from answers', async () => {
  const c = (await repo.snapshot()).cards[0];
  expect((await ask('Service X', [{ ...c, validUntil: '2020-01-01T00:00:00Z' }])).citations).toHaveLength(0);
});
it.each([
  { name: 'bad.exe' },
  { content: 'tiny' },
  { name: 'bad.pdf' },
  { encoding: 'base64', content: 'bad$base64' },
  { content: 'x'.repeat(30001) },
])('validates upload %o', async override => {
  await expect(
    call('POST', 'evidence', { cardId: 'payment-deployment', name: 'test.txt', content: update, encoding: 'text', ...override }),
  ).rejects.toBeDefined();
});

it('PDF ingestion extracts source text and preserves the exact original bytes', async () => {
  const bytes = pdfFixture();
  const e = await call<Evidence>('POST', 'evidence', {
    cardId: 'payment-deployment',
    name: 'deployment-update.pdf',
    content: bytes.toString('base64'),
    encoding: 'base64',
  });
  expect(e.text).toContain('automatically restarts Service X');
  expect(await repo.document(e.id)).toEqual(bytes);
  const r = await call<Review>('POST', `evidence/${e.id}/compare`, {});
  expect(r.relation).toBe('process_change');
});
function pdfFixture() {
  const stream = 'BT /F1 12 Tf 40 740 Td (The payment pipeline automatically restarts Service X after deployment.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(content));
    content += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const start = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map(n => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(content);
}
