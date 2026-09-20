import { NextRequest } from 'next/server';
import { POST as accountPost } from '../../../app/api/account/[action]/route';

void (async () => {
  const response = await accountPost(
    new NextRequest('http://127.0.0.1:3001/api/account/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3001', host: '127.0.0.1:3001' },
      body: JSON.stringify({
        name: 'CI Owner',
        email: 'ci-owner@example.test',
        password: 'Long-password-2026',
        organizationName: 'CI Workspace',
      }),
    }),
    { params: Promise.resolve({ action: 'signup' }) },
  );

  console.log(JSON.stringify({ status: response.status, body: await response.json() }));
})();
