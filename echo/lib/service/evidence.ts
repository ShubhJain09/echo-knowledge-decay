import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { conflict } from '../repository';
import { AppError } from '../errors';
import { authorize } from '../auth/rbac';
import { compare } from '../intelligence';
import { evidenceSchema, valid } from '../types/schemas';
import type { Evidence, Review } from '../types';
import { activeCard, comparisonKey, type ApiResult, type RouteContext } from './shared';

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 30_000;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HIGH_PRIORITY: readonly string[] = ['contradiction', 'process_change', 'dependency_change'];

async function extractText(name: string, bytes: Buffer) {
  if (!/\.pdf$/i.test(name)) return { mime: 'text/plain', extracted: bytes.toString('utf8') };
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new AppError(400, 'This file does not contain a valid PDF.');
  try {
    const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const parsed = await pdf(new Uint8Array(bytes) as unknown as Buffer, { version: 'v2.0.550' });
    return { mime: 'application/pdf', extracted: parsed.text };
  } catch {
    throw new AppError(422, 'This PDF could not be read. Try an unlocked text-based PDF or paste its text.');
  }
}

/** Stores the original bytes alongside the extracted text. Identical evidence per card is deduplicated. */
export async function ingestEvidence({ actor, repo, body }: RouteContext): Promise<ApiResult> {
  authorize(actor.role, 'ingest');
  const input = valid(evidenceSchema, body);
  const initial = await repo.snapshot();
  activeCard(initial, input.cardId);
  if (!/\.(pdf|txt|md)$/i.test(input.name)) throw new AppError(400, 'Choose a PDF, TXT, or Markdown document.');
  if (input.encoding === 'base64' && !BASE64.test(input.content)) throw new AppError(400, 'The file encoding is invalid.');

  const bytes = Buffer.from(input.content, input.encoding === 'base64' ? 'base64' : 'utf8');
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new AppError(413, 'Documents must be smaller than 2 MB.');
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const seen = (e: Evidence) => e.contentHash === contentHash && e.cardId === input.cardId;
  const duplicate = initial.evidence.find(seen);
  if (duplicate) return { body: { ...duplicate, duplicate: true, message: 'Already ingested.' } };

  const { mime, extracted } = await extractText(input.name, bytes);
  const text = extracted.replace(/\u0000/g, '').trim();
  if (text.length < 10) throw new AppError(422, 'No usable text was found. Scanned PDFs need OCR first.');
  if (text.length > MAX_EXTRACTED_CHARACTERS) throw new AppError(413, 'Evidence must contain at most 30,000 characters.');

  const id = randomUUID();
  const evidence: Evidence = {
    id,
    organizationId: actor.organizationId,
    name: input.name.replace(/[/\\\r\n]/g, '_'),
    cardId: input.cardId,
    mime,
    size: bytes.length,
    text,
    createdAt: new Date().toISOString(),
    contentHash,
    submittedBy: actor.id,
    storageKey: `${actor.organizationId}/${id}`,
    trustMetadata: { authority: 'User-submitted, unverified', independentSources: 1 },
  };
  await repo.saveDocument(evidence, bytes);
  try {
    await repo.mutate(actor, 'evidence.ingested', id, data => {
      if (data.evidence.some(seen)) throw conflict();
      data.evidence.push(evidence);
    });
  } catch (error) {
    // Another request ingested the same bytes first; return that record rather than failing the upload.
    if (error instanceof AppError && error.status === 409) {
      const existing = (await repo.snapshot()).evidence.find(seen);
      if (existing) return { body: { ...existing, duplicate: true, message: 'Already ingested.' } };
    }
    throw error;
  }
  return { status: 201, body: evidence };
}

export async function downloadEvidence({ repo }: RouteContext, evidenceId: string): Promise<ApiResult> {
  const evidence = (await repo.snapshot()).evidence.find(e => e.id === evidenceId);
  if (!evidence) throw new AppError(404, 'Evidence not found.');
  const url = await repo.documentUrl(evidence.id);
  return url ? { url } : { bytes: await repo.document(evidence.id), mime: evidence.mime, name: evidence.name };
}

/**
 * Compares stored evidence against the current version of its card. Knowledge is never modified here:
 * a failed or unverifiable model response records an audit event and leaves the card untouched.
 */
export async function compareEvidence({ actor, repo, body }: RouteContext, evidenceId: string): Promise<ApiResult> {
  authorize(actor.role, 'ingest');
  valid(z.object({}).strict(), body);
  const data = await repo.snapshot();
  const evidence = data.evidence.find(e => e.id === evidenceId);
  if (!evidence) throw new AppError(404, 'Evidence not found.');

  const card = activeCard(data, evidence.cardId);
  const id = comparisonKey(actor.organizationId, card.id, card.version, evidence.contentHash);
  const existing = data.reviews.find(r => r.id === id);
  if (existing) return { body: existing };

  let comparison;
  try {
    comparison = await compare(card, evidence.text);
  } catch (error) {
    await repo.mutate(actor, 'ai.failed', evidence.id, () => {});
    throw error;
  }

  const review: Review = {
    ...comparison,
    organizationId: actor.organizationId,
    id,
    cardId: card.id,
    cardVersion: card.version,
    evidenceId: evidence.id,
    evidenceName: evidence.name,
    createdAt: new Date().toISOString(),
    status: comparison.needsReview ? 'pending' : 'resolved',
    priority: HIGH_PRIORITY.includes(comparison.relation) ? 'high' : 'medium',
  };
  try {
    await repo.mutate(actor, 'review.created', id, d => {
      // A card archived or superseded mid-comparison is a conflict to retry, not a 404.
      const live = d.cards.find(c => c.id === card.id);
      if (!live || live.status !== 'verified' || live.version !== card.version) throw conflict();
      if (d.reviews.some(r => r.id === id)) throw conflict();
      d.reviews.push(review);
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 409) {
      const raced = (await repo.snapshot()).reviews.find(r => r.id === id);
      if (raced) return { body: raced };
    }
    throw error;
  }
  return { status: 201, body: review };
}
