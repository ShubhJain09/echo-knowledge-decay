import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { store, type Store, type Row, type Write, conflict } from './db/store';
import type { Card, Evidence, Review, Data, AuditEvent } from './types';
import type { Actor } from './auth/rbac';
import { AppError } from './errors';
export interface Repository {
  organizationId: string;
  snapshot(): Promise<Data>;
  mutate<T>(actor: Actor, action: string, entityId: string, change: (data: Data) => T, requestId?: string): Promise<T>;
  saveDocument(evidence: Evidence, bytes: Buffer): Promise<void>;
  document(id: string): Promise<Buffer>;
  documentUrl(id: string): Promise<string | undefined>;
}
const kinds = { cards: 'CARD', reviews: 'REVIEW', evidence: 'EVIDENCE', audit: 'AUDIT' } as const;
export class TenantRepository implements Repository {
  private pk: string;
  constructor(
    public organizationId: string,
    readonly db: Store = store(),
    private root = process.env.ECHO_DATA_DIR || '.echo-data',
  ) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(organizationId)) throw new AppError(400, 'Invalid organization.');
    this.pk = `ORG#${organizationId}`;
  }
  private async load() {
    const rows = await this.db.list<Card | Evidence | Review | AuditEvent | { revision: number }>(this.pk);
    const data: Data = { cards: [], reviews: [], evidence: [], audit: [] };
    for (const [collection, prefix] of Object.entries(kinds)) {
      (data[collection as keyof Data] as unknown[]) = rows
        .filter(r => r.sk.startsWith(`${prefix}#`))
        .map(r => structuredClone(r.data));
    }
    // Immutable version rows keep growing history out of the DynamoDB card item.
    const versions = await this.db.list<Card['history'][number]>(this.pk, 'VERSION#');
    data.cards.forEach(c => {
      c.history = versions
        .filter(r => r.sk.startsWith(`VERSION#${c.id}#`))
        .map(r => ({
          ...r.data,
          status: r.data.version === c.version && c.status === 'verified' ? ('verified' as const) : ('archived' as const),
        }))
        .sort((a, b) => a.version - b.version);
    });
    return { data, rows };
  }
  async snapshot() {
    return (await this.load()).data;
  }
  async mutate<T>(actor: Actor, action: string, entityId: string, change: (data: Data) => T) {
    if (actor.organizationId !== this.organizationId) throw new AppError(403, 'Organization mismatch.');
    const { data, rows } = await this.load();
    const before = structuredClone(data);
    const result = change(data);
    const audit: AuditEvent = {
      id: randomUUID(),
      organizationId: this.organizationId,
      actorId: actor.id,
      actorName: actor.name,
      action,
      entityType: action.split('.')[0],
      entityId,
      before: null,
      after: null,
      timestamp: new Date().toISOString(),
      requestId: actor.requestId,
    };
    const changedCards = data.cards.filter(c => JSON.stringify(c) !== JSON.stringify(before.cards.find(old => old.id === c.id)));
    audit.before = changedCards.map(c => {
      const old = before.cards.find(o => o.id === c.id);
      return old ? { id: old.id, version: old.version, status: old.status } : null;
    });
    audit.after = changedCards.map(c => ({ id: c.id, version: c.version, status: c.status }));
    const changedReviews = data.reviews.filter(
      r => JSON.stringify(r) !== JSON.stringify(before.reviews.find(old => old.id === r.id)),
    );
    if (changedReviews.length) {
      audit.before = {
        cards: audit.before,
        reviews: changedReviews.map(r => {
          const old = before.reviews.find(o => o.id === r.id);
          return old ? { id: old.id, status: old.status, decision: old.decision, assignedTo: old.assignedTo } : null;
        }),
      };
      audit.after = {
        cards: audit.after,
        reviews: changedReviews.map(r => ({
          id: r.id,
          status: r.status,
          decision: r.decision,
          reviewer: r.reviewer,
          reason: r.note,
          assignedTo: r.assignedTo,
          snoozedUntil: r.snoozedUntil,
          evidenceRequested: r.evidenceRequested,
        })),
      };
    }
    data.audit.push(audit);
    const writes: Write[] = [];
    const meta = rows.find(r => r.sk === 'META');
    writes.push({
      row: { pk: this.pk, sk: 'META', organizationId: this.organizationId, revision: (meta?.revision ?? -1) + 1, data: {} },
      expected: meta?.revision ?? -1,
    });
    for (const [collection, prefix] of Object.entries(kinds)) {
      for (const value of data[collection as keyof Data]) {
        if (value.organizationId !== this.organizationId) throw new AppError(403, 'Cross-organization write rejected.');
        const sk = `${prefix}#${value.id}`;
        const old = rows.find(r => r.sk === sk);
        const payload = prefix === 'CARD' ? { ...value, history: [] } : value;
        if (JSON.stringify(payload) !== JSON.stringify(old?.data))
          writes.push({
            row: { pk: this.pk, sk, organizationId: this.organizationId, revision: (old?.revision ?? -1) + 1, data: payload },
            expected: old?.revision ?? -1,
          });
      }
    }
    for (const card of changedCards) {
      for (const version of card.history.filter(
        v => !before.cards.find(c => c.id === card.id)?.history.some(old => old.version === v.version),
      )) {
        writes.push({
          row: {
            pk: this.pk,
            sk: `VERSION#${card.id}#${String(version.version).padStart(8, '0')}`,
            organizationId: this.organizationId,
            revision: 0,
            data: version,
          },
          expected: -1,
        });
      }
    }
    await this.db.write(writes);
    console.info(
      JSON.stringify({
        event: action,
        requestId: actor.requestId,
        organizationId: actor.organizationId,
        entityId,
        actorId: actor.id,
        timestamp: audit.timestamp,
      }),
    );
    return result;
  }
  async saveDocument(evidence: Evidence, bytes: Buffer) {
    if (evidence.organizationId !== this.organizationId) throw new AppError(403, 'Organization mismatch.');
    if (process.env.ECHO_STORAGE === 'aws') {
      await new S3Client({}).send(
        new PutObjectCommand({
          Bucket: process.env.EVIDENCE_BUCKET!,
          Key: `${this.organizationId}/${evidence.id}`,
          Body: bytes,
          ContentType: evidence.mime,
          ServerSideEncryption: 'AES256',
        }),
      );
    } else {
      const dir = path.join(this.root, this.organizationId, 'documents');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, evidence.id), bytes, { mode: 0o600 });
    }
  }
  async documentUrl(id: string) {
    await this.ensureDocument(id);
    if (process.env.ECHO_STORAGE !== 'aws') return undefined;
    return getSignedUrl(
      new S3Client({}),
      new GetObjectCommand({
        Bucket: process.env.EVIDENCE_BUCKET!,
        Key: `${this.organizationId}/${id}`,
        ResponseContentDisposition: 'attachment',
      }),
      { expiresIn: 60 },
    );
  }
  private async ensureDocument(id: string) {
    if (!(await this.snapshot()).evidence.some(e => e.id === id)) throw new AppError(404, 'Evidence not found.');
  }
  async document(id: string) {
    await this.ensureDocument(id);
    if (process.env.ECHO_STORAGE === 'aws') {
      const r = await new S3Client({}).send(
        new GetObjectCommand({ Bucket: process.env.EVIDENCE_BUCKET!, Key: `${this.organizationId}/${id}` }),
      );
      return Buffer.from(await r.Body!.transformToByteArray());
    }
    return readFile(path.join(this.root, this.organizationId, 'documents', id));
  }
}
export function repository(organizationId: string): Repository {
  return new TenantRepository(organizationId);
}
export { conflict };
