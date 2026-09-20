import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { repository, type Repository, conflict } from './repository';
import { compare, ask } from './intelligence';
import { AppError } from './errors';
import type { Card, Evidence, Review, Data } from './types';
import { authorize, can, type Actor } from './auth/rbac';
import { valid, text, cardSchema, evidenceSchema, decisionSchema } from './types/schemas';
import { nextReview } from './intelligence/freshness';
import { seedCards } from './seed';
export interface ApiResult { status?: number; body?: unknown; bytes?: Buffer; mime?: string; name?: string; url?: string }
export const comparisonKey = (org: string, cardId: string, version: number, hash: string) => createHash('sha256').update(JSON.stringify([org,cardId,version,hash])).digest('hex');
function activeCard(data: Data, id: string) { const c = data.cards.find(c => c.id === id && c.status === 'verified'); if (!c) throw new AppError(404, 'Choose an active knowledge card.'); return c; }
export async function dispatch(method: string, pathname: string, body: unknown, actor: Actor, repo: Repository = repository(actor.organizationId)): Promise<ApiResult> {
  if (actor.organizationId !== repo.organizationId) throw new AppError(403, 'Organization mismatch.');
  authorize(actor.role, 'read');
  const parts = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  if (method === 'GET' && parts.join('/') === 'workspace') { const data = await repo.snapshot(); return { body: { ...data, audit: can(actor.role, 'audit') ? data.audit : [] } }; }
  if (method === 'POST' && parts.join('/') === 'seed') {
    authorize(actor.role, 'admin'); valid(z.object({}).strict(), body);
    const cards = seedCards(actor.organizationId);
    await repo.mutate(actor, 'knowledge.seed', 'service-x', d => { for (const c of cards) if (!d.cards.some(old => old.id === c.id)) d.cards.push(c); });
    return { body: { ok: true } };
  }
  if (method === 'POST' && parts.join('/') === 'knowledge') {
    authorize(actor.role, 'create'); const input = valid(cardSchema, body); const now = new Date().toISOString();
    const card: Card = { ...input, id: randomUUID(), organizationId: actor.organizationId, version: 1, status: 'verified', updatedAt: now, lastVerifiedAt: now, nextReviewAt: nextReview(now, input.volatility), history: [{ organizationId: actor.organizationId, version: 1, statement: input.statement, source: input.source, createdAt: now, author: actor.name, note: 'Initial human-verified knowledge', status: 'verified' }] };
    await repo.mutate(actor, 'knowledge.created', card.id, d => d.cards.push(card)); return { status: 201, body: card };
  }
  if (method === 'POST' && parts.join('/') === 'evidence') {
    authorize(actor.role, 'ingest'); const input = valid(evidenceSchema, body);
    const initial = await repo.snapshot(); activeCard(initial, input.cardId);
    if (!/\.(pdf|txt|md)$/i.test(input.name)) throw new AppError(400, 'Choose a PDF, TXT, or Markdown document.');
    if (input.encoding === 'base64' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content)) throw new AppError(400, 'The file encoding is invalid.');
    const bytes = Buffer.from(input.content, input.encoding === 'base64' ? 'base64' : 'utf8');
    if (bytes.length > 2 * 1024 * 1024) throw new AppError(413, 'Documents must be smaller than 2 MB.');
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const duplicate = initial.evidence.find(e => e.contentHash === contentHash && e.cardId === input.cardId);
    if (duplicate) return { body: { ...duplicate, duplicate: true, message: 'Already ingested.' } };
    let extracted: string; let mime: string;
    if (/\.pdf$/i.test(input.name)) {
      if (bytes.subarray(0,5).toString() !== '%PDF-') throw new AppError(400, 'This file does not contain a valid PDF.');
      mime = 'application/pdf';
      try { const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default; extracted = (await pdf(new Uint8Array(bytes) as unknown as Buffer, { version: 'v2.0.550' })).text; }
      catch { throw new AppError(422, 'This PDF could not be read. Try an unlocked text-based PDF or paste its text.'); }
    } else { mime = 'text/plain'; extracted = bytes.toString('utf8'); }
    extracted = extracted.replace(/\u0000/g, '').trim();
    if (extracted.length < 10) throw new AppError(422, 'No usable text was found. Scanned PDFs need OCR first.');
    if (extracted.length > 30000) throw new AppError(413, 'Evidence must contain at most 30,000 characters.');
    const id = randomUUID();
    const evidence: Evidence = { id, organizationId: actor.organizationId, name: input.name.replace(/[\/\\\r\n]/g,'_'), cardId: input.cardId, mime, size: bytes.length, text: extracted, createdAt: new Date().toISOString(), contentHash, submittedBy: actor.id, storageKey: `${actor.organizationId}/${id}`, trustMetadata: { authority: 'User-submitted, unverified', independentSources: 1 } };
    await repo.saveDocument(evidence, bytes);
    try {
      await repo.mutate(actor, 'evidence.ingested', id, d => {
        if (d.evidence.some(e => e.contentHash === contentHash && e.cardId === input.cardId)) throw conflict();
        d.evidence.push(evidence);
      });
    } catch (error) { if (error instanceof AppError && error.status === 409) { const e = (await repo.snapshot()).evidence.find(e => e.contentHash === contentHash && e.cardId === input.cardId); if (e) return { body: { ...e, duplicate: true, message: 'Already ingested.' } }; } throw error; }
    return { status: 201, body: evidence };
  }
  if (parts[0] === 'evidence' && parts[1]) {
    const data = await repo.snapshot(); const evidence = data.evidence.find(e => e.id === parts[1]);
    if (!evidence) throw new AppError(404, 'Evidence not found.');
    if (method === 'GET' && parts.length === 2) { const url = await repo.documentUrl(evidence.id); return url ? { url } : { bytes: await repo.document(evidence.id), mime: evidence.mime, name: evidence.name }; }
    if (method === 'POST' && parts.length === 3 && parts[2] === 'compare') {
      authorize(actor.role, 'ingest'); valid(z.object({}).strict(), body);
      const card = activeCard(data, evidence.cardId);
      const id = comparisonKey(actor.organizationId,card.id,card.version,evidence.contentHash);
      const existing = data.reviews.find(r => r.id === id); if (existing) return { body: existing };
      let comparison;
      try { comparison = await compare(card, evidence.text); }
      catch (error) { await repo.mutate(actor, 'ai.failed', evidence.id, () => {}); throw error; }
      const review: Review = { ...comparison, organizationId: actor.organizationId, id, cardId: card.id, cardVersion: card.version, evidenceId: evidence.id, evidenceName: evidence.name, createdAt: new Date().toISOString(), status: comparison.needsReview ? 'pending' : 'resolved', priority: ['contradiction','process_change','dependency_change'].includes(comparison.relation) ? 'high' : 'medium' };
      try { await repo.mutate(actor, 'review.created', id, d => { if (activeCard(d,card.id).version !== card.version) throw conflict(); if (d.reviews.some(r => r.id === id)) throw conflict(); d.reviews.push(review); }); }
      catch (error) { if (error instanceof AppError && error.status === 409) { const r = (await repo.snapshot()).reviews.find(r => r.id === id); if (r) return { body: r }; } throw error; }
      return { status: 201, body: review };
    }
  }
  if (method === 'POST' && parts[0] === 'reviews' && parts[2] === 'decision' && parts.length === 3) {
    authorize(actor.role, 'review'); const input = valid(decisionSchema, body);
    const result = await repo.mutate(actor, `review.${input.decision}`, parts[1], d => {
      const review = d.reviews.find(r => r.id === parts[1]);
      if (!review) throw new AppError(404, 'Review not found.');
      const card = d.cards.find(c => c.id === review.cardId);
      if (review.status !== 'pending' || !card || card.version !== input.expectedVersion || review.cardVersion !== input.expectedVersion || card.status !== 'verified') throw conflict();
      const now = new Date().toISOString();
      if (input.decision !== 'keep') {
        if (input.decision === 'update' && !input.statement) throw new AppError(400, 'Write the verified statement before updating.');
        card.history.forEach(v => { v.status = 'archived'; });
        card.version = input.expectedVersion + 1;
        card.status = input.decision === 'archive' ? 'archived' : 'verified';
        card.statement = input.decision === 'update' ? input.statement! : card.statement;
        card.source = input.decision === 'update' ? review.evidenceName : card.source;
        card.updatedAt = now;
        card.history.push({ organizationId: actor.organizationId, version: card.version, statement: card.statement, source: card.source, createdAt: now, author: actor.name, note: input.note, evidenceId: review.evidenceId || undefined, status: card.status, supersedesVersion: input.expectedVersion });
      }
      card.lastVerifiedAt = now; card.nextReviewAt = nextReview(now, card.volatility);
      Object.assign(review, { status: 'resolved', decision: input.decision, resolvedAt: now, reviewer: actor.name, note: input.note });
      return { card, review };
    }); return { body: result };
  }
  if (method === 'POST' && parts[0] === 'reviews' && parts[2] === 'manage' && parts.length === 3) {
    authorize(actor.role, 'review');
    const input = valid(z.object({ assignedTo: text(100).optional(), snoozedUntil: z.iso.datetime().optional(), evidenceRequested: text(1000).optional() }).strict().refine(v => Object.keys(v).length > 0), body);
    if (input.snoozedUntil && (Date.parse(input.snoozedUntil) <= Date.now() || Date.parse(input.snoozedUntil) > Date.now() + 90 * 86400000)) throw new AppError(400, 'Snooze for a future date within 90 days.');
    await repo.mutate(actor, 'review.managed', parts[1], d => { const r = d.reviews.find(r => r.id === parts[1] && r.status === 'pending'); if (!r) throw new AppError(404,'Pending review not found.'); Object.assign(r,input); });
    return { body: { ok: true } };
  }
  if (method === 'POST' && parts[0] === 'knowledge' && parts[2] === 'rollback' && parts.length === 3) {
    authorize(actor.role, 'review'); const input = valid(z.object({ expectedVersion: z.number().int().positive(), version: z.number().int().positive(), reason: text(1000) }).strict(),body);
    const result = await repo.mutate(actor,'knowledge.rollback',parts[1],d => {
      const c = d.cards.find(c => c.id === parts[1]); if (!c) throw new AppError(404,'Knowledge not found.'); if (c.version !== input.expectedVersion) throw conflict();
      const target = c.history.find(v => v.version === input.version); if (!target) throw new AppError(404,'Version not found.');
      const now = new Date().toISOString(); c.history.forEach(v => { v.status = 'archived'; });
      c.version++; c.statement = target.statement; c.source = target.source; c.status = 'verified'; c.updatedAt = now; c.lastVerifiedAt = now; c.nextReviewAt = nextReview(now,c.volatility);
      c.history.push({ ...target, status: 'verified', version: c.version, author: actor.name, createdAt: now, note: input.reason, supersedesVersion: input.expectedVersion, rollbackFrom: input.version }); return c;
    }); return { body: result };
  }
  if (method === 'POST' && parts.join('/') === 'freshness') {
    authorize(actor.role,'review'); valid(z.object({}).strict(),body);
    await repo.mutate(actor,'review.freshness','scheduled',d => {
      for (const c of d.cards.filter(c => c.status === 'verified' && ((c.nextReviewAt && Date.parse(c.nextReviewAt) <= Date.now()) || (c.validUntil && Date.parse(c.validUntil) <= Date.now())))) {
        const id = comparisonKey(actor.organizationId,c.id,c.version,`freshness:${c.lastVerifiedAt}`);
        if (!d.reviews.some(r => r.id === id)) d.reviews.push({ id, organizationId: actor.organizationId, cardId:c.id, cardVersion:c.version, evidenceId:'', evidenceName:'Scheduled review policy', createdAt:new Date().toISOString(), status:'pending', priority:'medium', relation:'time_sensitive', needsReview:true, explanation:'The scheduled review date or validity window has elapsed. Verify the procedure before renewing it.', oldQuote:c.statement, newQuote:'', proposedStatement:c.statement, engine:'policy' });
      }
    }); return { body: { ok: true } };
  }
  if (method === 'POST' && parts.join('/') === 'ask') {
    const { question } = valid(z.object({question:text(1000)}).strict(),body);
    return { body: await ask(question,(await repo.snapshot()).cards) };
  }
  throw new AppError(404,'Endpoint not found.');
}
