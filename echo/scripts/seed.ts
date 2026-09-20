async function main() {
  process.loadEnvFile('.env.local');
  const { account } = await import('../lib/auth/accounts');
  const { dispatch } = await import('../lib/service');
  const email = process.argv[2];
  if (!email) throw new Error('Usage: npm run seed -- owner@example.com');
  const row = await account(email);
  if (!row) throw new Error('Sign up and verify this account first.');
  const u = row.data;
  await dispatch(
    'POST',
    '/api/seed',
    {},
    { id: u.id, email: u.email, name: u.name, organizationId: u.organizationId, role: u.role, requestId: crypto.randomUUID() },
  );
  console.log('Example workspace seeded without overwriting existing cards.');
  process.exit(0);
}
main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
