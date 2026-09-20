import { describe, it, expect } from 'vitest';
import { bestPassage, demoCompare } from '../../lib/intelligence';
import { seedCards } from '../../lib/seed';
import type { Card } from '../../lib/types';

/**
 * Regression tests for the knowledge-decay behaviour itself, rather than for the API around it.
 * A green build and a working upload say nothing about whether Echo detects the right change, so
 * these cases stay permanent. Evidence isolation and retry-after-failure are exercised end to end in
 * tests/integration/workflow.test.ts ("tenant isolation…" and "invalid model quotes never create a
 * review…"); the cases here cover classification and quoting.
 */
const card = (statement: string): Card => ({ ...seedCards()[0], title: statement.slice(0, 60), topic: 'General', statement });

describe('detecting a real change', () => {
  it('reports a changed deadline and quotes the passage that carries it', () => {
    const result = demoCompare(
      card('The project submission deadline is September 20.'),
      'Programme update\n\nThe project submission deadline has been extended to September 25. All other milestones are unchanged.',
    );
    expect(result.relation).toBe('time_sensitive');
    expect(result.needsReview).toBe(true);
    expect(result.newQuote).toContain('September 25');
  });

  it('reports a manual step that became automated', () => {
    const result = demoCompare(
      card('Manually restart Service X after every successful payment deployment.'),
      'The pipeline now automatically restarts Service X after deployment.',
    );
    expect(result.relation).toBe('process_change');
    expect(result.needsReview).toBe(true);
  });

  it('reports a pinned version that was deprecated', () => {
    const result = demoCompare(
      card('Use Customer API v1 for profile lookups.'),
      'Customer API v1 is deprecated; use Customer API v2.',
    );
    expect(result.relation).toBe('dependency_change');
  });

  it('reports a hosting migration', () => {
    const result = demoCompare(
      card('The production database runs on Server A.'),
      'The production database migrated to a managed service.',
    );
    expect(result.relation).toBe('environment_change');
  });
});

describe('not treating rewording as a change', () => {
  it('recognises the same information in a different order', () => {
    const result = demoCompare(card('The submission deadline is September 20.'), 'September 20 is the deadline for submission.');
    expect(result.relation).toBe('consistent');
    expect(result.needsReview).toBe(false);
  });

  it('separates added detail from a conflicting claim', () => {
    const result = demoCompare(
      card('Service X restarts after deployment.'),
      'Service X restarts after deployment and logs the event.',
    );
    expect(result.relation).toBe('adds_context');
  });

  it('does not match rules on substrings: "platform" is not "form"', () => {
    const result = demoCompare(
      card('The platform information is published quarterly.'),
      'The portal now hosts the published information.',
    );
    expect(result.relation).not.toBe('process_change');
  });
});

describe('contradiction', () => {
  it('flags a reversed condition', () => {
    expect(demoCompare(card('Service X is enabled in production.'), 'Service X is disabled in production.').relation).toBe(
      'contradiction',
    );
  });

  it('flags the same claim carrying a different figure', () => {
    const result = demoCompare(
      card('The project has 100 registered participants.'),
      'The project has 500 registered participants.',
    );
    expect(result.relation).toBe('contradiction');
    expect(result.needsReview).toBe(true);
  });

  it('flags evidence that negates the current procedure', () => {
    const result = demoCompare(
      card('Engineers escalate Service X incidents to the on-call rota.'),
      'Engineers can no longer escalate Service X incidents to the on-call rota.',
    );
    expect(result.relation).toBe('contradiction');
  });
});

describe('quoting', () => {
  it('leaves unrelated evidence unlinked and proposes nothing', () => {
    const result = demoCompare(card('Service X restarts after deployment.'), 'The cafeteria offers lunch at noon.');
    expect(result.relation).toBe('unrelated');
    expect(result.needsReview).toBe(false);
    expect(result.proposedStatement).toBe('');
  });

  it('keeps every quote an exact substring of its source', () => {
    const statement = 'Manually restart Service X after every successful payment deployment.';
    const evidence =
      'Payment deployment update\n\nThe pipeline now automatically restarts Service X. Engineers no longer restart it manually.\n\nUnrelated: the cafeteria menu changed.';
    const result = demoCompare(card(statement), evidence);
    expect(result.oldQuote).toBe(statement);
    expect(evidence).toContain(result.newQuote);
  });

  it('proposes only the matching passage of a long document, not the whole file', () => {
    const noise = 'The cafeteria menu changed. '.repeat(120);
    const evidence = `${noise}\n\nService X now restarts automatically after deployment.`;
    const result = demoCompare(card('Manually restart Service X.'), evidence);
    expect(evidence.length).toBeGreaterThan(2000);
    expect(result.proposedStatement).toContain('automatically');
    expect(result.proposedStatement.length).toBeLessThan(500);
  });

  it('a short document is its own proposal', () => {
    const evidence = 'Service X now restarts automatically after deployment.';
    expect(demoCompare(card('Manually restart Service X.'), evidence).proposedStatement).toBe(evidence);
  });

  it('bestPassage returns a contiguous slice of the source', () => {
    const evidence = 'One sentence. The deployment pipeline restarts Service X. Another sentence.';
    const passage = bestPassage({ title: 'Service X', statement: 'Restart Service X after deployment.' }, evidence);
    expect(evidence).toContain(passage);
    expect(passage).toContain('Service X');
  });
});
