import { it, expect, vi } from 'vitest';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoStore } from '../../lib/db/store';
it('DynamoDB uses tenant queries and revision-conditional transactional writes', async () => {
  const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockResolvedValue({ Items: [] } as never);
  const db = new DynamoStore('test-table');
  await db.list('ORG#tenant-a');
  const query = (send.mock.calls[0][0] as unknown as { input: Record<string, unknown> }).input;
  expect(query.ExpressionAttributeValues).toEqual({ ':pk': 'ORG#tenant-a', ':prefix': '' });
  await db.write([
    { row: { pk: 'ORG#a', sk: 'CARD#x', organizationId: 'a', revision: 3, data: { version: 2 } }, expected: 2 },
    { row: { pk: 'ORG#a', sk: 'VERSION#x#2', organizationId: 'a', revision: 0, data: {} }, expected: -1 },
  ]);
  const tx = (
    send.mock.calls[1][0] as unknown as {
      input: { TransactItems: { Put: { ConditionExpression: string; ExpressionAttributeValues?: unknown } }[] };
    }
  ).input;
  expect(tx.TransactItems[0].Put.ConditionExpression).toBe('revision = :revision');
  expect(tx.TransactItems[0].Put.ExpressionAttributeValues).toEqual({ ':revision': 2 });
  expect(tx.TransactItems[1].Put.ConditionExpression).toBe('attribute_not_exists(pk)');
  send.mockRestore();
});
