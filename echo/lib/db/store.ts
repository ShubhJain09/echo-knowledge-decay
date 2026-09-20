import type { PrismaClient } from '@prisma/client';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { AppError } from '../errors';
export type Row<T = unknown> = { pk: string; sk: string; organizationId: string; revision: number; data: T };
export type Write = { row: Row; expected: number };
export interface Store { get<T>(pk: string, sk: string): Promise<Row<T> | undefined>; list<T>(pk: string, prefix?: string): Promise<Row<T>[]>; write(writes: Write[]): Promise<void> }
export const conflict = () => new AppError(409, 'This knowledge changed while you were reviewing it. Refresh before approving.');
const globalDb = globalThis as unknown as { echoPrisma?: PrismaClient };
export class SqliteStore implements Store {
  readonly db: PrismaClient;
  constructor(url = process.env.DATABASE_URL || 'file:./echo.db') {
    const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
    this.db = url === process.env.DATABASE_URL && globalDb.echoPrisma ? globalDb.echoPrisma : new PrismaClient({ datasources: { db: { url } } });
    if (url === process.env.DATABASE_URL) globalDb.echoPrisma = this.db;
  }
  async get<T>(pk: string, sk: string) { const row = await this.db.record.findUnique({ where: { pk_sk: { pk, sk } } }); return row ? { ...row, data: JSON.parse(row.data) as T } : undefined; }
  async list<T>(pk: string, prefix = '') { return (await this.db.record.findMany({ where: { pk, sk: { startsWith: prefix } } })).map(row => ({ ...row, data: JSON.parse(row.data) as T })); }
  async write(writes: Write[]) {
    try {
      await this.db.$transaction(async tx => {
        for (const { row, expected } of writes) {
          const data = { ...row, data: JSON.stringify(row.data) };
          if (expected < 0) await tx.record.create({ data });
          else {
            const result = await tx.record.updateMany({ where: { pk: row.pk, sk: row.sk, revision: expected }, data });
            if (result.count !== 1) throw conflict();
          }
        }
      }, { timeout: 10000 });
    } catch (error) {
      if (error instanceof Error && 'code' in error && ['P2002','P2034','P2028'].includes(String(error.code))) throw conflict();
      throw error;
    }
  }
}
export class DynamoStore implements Store {
  constructor(private table = process.env.KNOWLEDGE_TABLE!, private db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } })) {
    if (!table) throw new AppError(503, 'KNOWLEDGE_TABLE is not configured.');
  }
  async get<T>(pk: string, sk: string) { const result = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk, sk }, ConsistentRead: true })); return result.Item as Row<T> | undefined; }
  async list<T>(pk: string, prefix = '') {
    const rows: Row<T>[] = []; let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.db.send(new QueryCommand({ TableName: this.table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix }, ConsistentRead: true, ExclusiveStartKey: cursor }));
      rows.push(...(result.Items || []) as Row<T>[]); cursor = result.LastEvaluatedKey;
    } while (cursor);
    return rows;
  }
  async write(writes: Write[]) {
    if (!writes.length) return;
    if (writes.length > 100 || writes.some(w => Buffer.byteLength(JSON.stringify(w.row)) > 350000)) throw new AppError(422, 'Transaction exceeds storage limits. Contact your administrator.');
    try { await this.db.send(new TransactWriteCommand({ TransactItems: writes.map(({ row, expected }) => ({ Put: { TableName: this.table, Item: row, ConditionExpression: expected < 0 ? 'attribute_not_exists(pk)' : 'revision = :revision', ...(expected < 0 ? {} : { ExpressionAttributeValues: { ':revision': expected } }) } })) })); }
    catch (error) { if ((error as Error).name === 'TransactionCanceledException') throw conflict(); throw error; }
  }
}
let singleton: Store | undefined;
export function store(): Store { return singleton ||= process.env.ECHO_STORAGE === 'aws' ? new DynamoStore() : new SqliteStore(); }
