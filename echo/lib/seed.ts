import type { Card } from './types';
export function seedCards(organizationId = "demo"): Card[] {
  const rows = [
    ['payment-deployment', 'Payment deployment', 'Engineering', 'Rahul', 'Manually restart Service X after every successful payment deployment. If the restart fails, follow the incident response runbook.', 'deployment-runbook.txt', '2026-09-17T09:30:00.000Z'],
    ['expense-requests', 'Submitting expense requests', 'People & operations', 'Priya', 'Submit expense requests using the expense form and email it to HR for approval.', 'People operations handbook', '2026-09-14T10:00:00.000Z'],
    ['customer-api', 'Customer API integration', 'Engineering', 'Alex', 'Use Customer API v1 for customer profile lookups. Authenticate with an API key.', 'Customer API integration guide', '2026-09-12T14:00:00.000Z'],
    ['database-hosting', 'Production database', 'Infrastructure', 'Sam', 'The production database runs on Server A. Take a snapshot before every schema migration.', 'Infrastructure runbook', '2026-09-10T11:00:00.000Z'],
  ];
  return rows.map(([id, title, topic, owner, statement, source, updatedAt]) => ({
    organizationId, lastVerifiedAt: updatedAt, nextReviewAt: new Date(Date.parse(updatedAt) + 90 * 86400000).toISOString(), volatility: "medium", sensitivity: "Internal", id, title, topic, owner, statement, source, updatedAt, status: 'verified', version: 1,
    history: [{organizationId, version: 1, statement, source, createdAt: updatedAt, author: owner, note: 'Initial verified knowledge', status: 'verified'}],
  }));
}
