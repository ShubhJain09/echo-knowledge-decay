/**
 * End-to-end smoke check over HTTP against a running development server.
 *
 * It covers the same path as the Playwright spec — signup, verification, sign-in, seeding, evidence
 * ingest, comparison, the human decision, answering, rollback and the audit trail — without needing
 * a browser or Playwright's system libraries. Start the server first:
 *
 *   npm run dev -- --port 3001
 *   npm run smoke
 *
 * It creates a real account in the local database and exits non-zero on the first failed check.
 */
const BASE = 'http://127.0.0.1:3001';
const ORIGIN = { Origin: BASE };
let cookies = {};
const jar = () =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
function save(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    cookies[pair.slice(0, i)] = pair.slice(i + 1);
  }
}
async function call(method, path, body, extraHeaders = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...ORIGIN, Cookie: jar(), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  save(res);
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}
const ok = [];
const check = (name, cond, detail = '') => {
  ok.push([cond, name, detail]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

// Fail with a clear message rather than a property error if nothing is listening.
try {
  await fetch(BASE + '/login', { signal: AbortSignal.timeout(5000) });
} catch {
  console.error(`No server responded at ${BASE}. Start one first: npm run dev -- --port 3001`);
  process.exit(1);
}

const email = `smoke-${Date.now()}@example.test`;
const password = 'Echo-testing-password-2026';

// 1. signup + local verification
const signup = await call('POST', '/api/account/signup', {
  name: 'Rahul',
  email,
  password,
  organizationName: 'Payments Engineering',
});
check('signup returns 201 with a local verification token', signup.status === 201 && !!signup.body.localVerificationToken);
const verify = await call('POST', '/api/account/verify', { email, token: signup.body.localVerificationToken });
check('email verification succeeds', verify.status === 200 && verify.body.ok === true);

// 2. anonymous access is refused
const anon = await fetch(BASE + '/api/workspace');
check('unauthenticated workspace read is 401', anon.status === 401, `got ${anon.status}`);

// 3. credentials login through NextAuth
const csrf = await call('GET', '/api/auth/csrf');
const form = new URLSearchParams({ csrfToken: csrf.body.csrfToken, email, password, json: 'true' });
const login = await fetch(BASE + '/api/auth/callback/credentials', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...ORIGIN, Cookie: jar() },
  body: form,
  redirect: 'manual',
});
save(login);
check(
  'credentials sign-in issues a session',
  !!cookies['next-auth.session-token'] || !!cookies['__Secure-next-auth.session-token'],
);

// 4. workspace + seed
const ws = await call('GET', '/api/workspace');
check('authenticated workspace read is 200', ws.status === 200, `role=${ws.body?.user?.role} ai=${ws.body?.mode?.ai}`);
const seed = await call('POST', '/api/seed', {});
check('seeding the example workspace succeeds', seed.status === 200);
const seeded = await call('GET', '/api/workspace');
check('four example cards exist at version 1', seeded.body.cards.length === 4 && seeded.body.cards.every(c => c.version === 1));

// 5. evidence ingest
const content =
  'Payment deployment update\n\nThe payment deployment pipeline now automatically restarts Service X after every successful deployment. Engineers no longer need to restart Service X manually.\n\nIf the automated restart fails, follow the incident response runbook.';
const ev = await call('POST', '/api/evidence', {
  cardId: 'payment-deployment',
  name: 'deployment-update.txt',
  content,
  encoding: 'text',
});
check('evidence ingests', ev.status === 201, `${ev.body.size} bytes, sha=${String(ev.body.contentHash).slice(0, 8)}`);
const dup = await call('POST', '/api/evidence', {
  cardId: 'payment-deployment',
  name: 'deployment-update.txt',
  content,
  encoding: 'text',
});
check('identical evidence is deduplicated', dup.body.duplicate === true && dup.body.id === ev.body.id);

// 6. comparison
const cmp = await call('POST', `/api/evidence/${ev.body.id}/compare`, {});
check('comparison classifies a process change', cmp.body.relation === 'process_change', `relation=${cmp.body.relation}`);
check('comparison needs human review', cmp.body.needsReview === true && cmp.body.status === 'pending');
check(
  'old quote is an exact substring of the card',
  seeded.body.cards.find(c => c.id === 'payment-deployment').statement.includes(cmp.body.oldQuote),
);
check(
  'new quote is an exact substring of the evidence',
  content.includes(cmp.body.newQuote),
  JSON.stringify(cmp.body.newQuote.slice(0, 60)),
);
const again = await call('POST', `/api/evidence/${ev.body.id}/compare`, {});
check('re-comparing reuses the same review (idempotent)', again.body.id === cmp.body.id);

// 7. the human decision
const stale = await call('POST', `/api/reviews/${cmp.body.id}/decision`, {
  decision: 'update',
  expectedVersion: 99,
  note: 'stale',
  statement: content,
});
check('a stale expectedVersion is rejected as a conflict', stale.status === 409, `status=${stale.status}`);
const decide = await call('POST', `/api/reviews/${cmp.body.id}/decision`, {
  decision: 'update',
  expectedVersion: 1,
  note: 'Verified automated restart.',
  statement: cmp.body.proposedStatement,
});
check('the decision creates version 2', decide.status === 200 && decide.body.card.version === 2);
check(
  'version 1 is archived and preserved',
  decide.body.card.history.length === 2 && decide.body.card.history[0].status === 'archived',
);

// 8. answers come only from the current version
const ask = await call('POST', '/api/ask', {
  question: 'How should engineers handle Service X after a successful payment deployment?',
});
check('the answer cites version 2', ask.body.citations[0]?.version === 2);
check('the answer quotes the new procedure', /automatically restarts/.test(ask.body.text));
check('the answer no longer contains the superseded procedure', !/Manually restart Service X/.test(ask.body.text));

// 9. rollback
const rb = await call('POST', '/api/knowledge/payment-deployment/rollback', {
  expectedVersion: 2,
  version: 1,
  reason: 'Automation reverted',
});
check('rollback creates version 3 and preserves all versions', rb.body.version === 3 && rb.body.history.length === 3);
check('rollback records its provenance', rb.body.history.at(-1).rollbackFrom === 1);

// 10. audit shape
const final = await call('GET', '/api/workspace');
const shaped = final.body.audit.every(
  e => e.before && e.after && 'cards' in e.before && 'reviews' in e.before && 'cards' in e.after && 'reviews' in e.after,
);
check('every audit record uses the same { cards, reviews } shape', shaped, `${final.body.audit.length} events`);
check(
  'sign-in is audited without a knowledge transaction',
  final.body.audit.some(e => e.action === 'auth.login'),
);

// 11. 404 on an unknown endpoint
const missing = await call('POST', '/api/nonexistent', {});
check('unknown endpoints 404 through the route table', missing.status === 404);

const failed = ok.filter(([c]) => !c);
console.log(`\n${ok.length - failed.length}/${ok.length} checks passed`);
process.exit(failed.length ? 1 : 0);
