import { writeFile } from 'node:fs/promises';
const keys = [
  'ECHO_API_URL',
  'AWS_REGION',
  'ECHO_STORAGE',
  'KNOWLEDGE_TABLE',
  'EVIDENCE_BUCKET',
  'ECHO_AI',
  'GROQ_API_KEY',
  'GROQ_MODEL_ID',
  'NEXTAUTH_URL',
  'NEXTAUTH_SECRET',
  'COGNITO_CLIENT_ID',
  'COGNITO_CLIENT_SECRET',
  'COGNITO_ISSUER',
  'EMAIL_FROM',
  'BEDROCK_MODEL_ID',
  'BEDROCK_RUNTIME_VERIFIED',
];
for (const key of [
  'ECHO_API_URL',
  'KNOWLEDGE_TABLE',
  'NEXTAUTH_URL',
  'NEXTAUTH_SECRET',
  'COGNITO_CLIENT_ID',
  'COGNITO_CLIENT_SECRET',
  'COGNITO_ISSUER',
])
  if (!process.env[key]) throw new Error(`Configure ${key} in the server environment.`);
if (process.env.ECHO_STORAGE !== 'aws') throw new Error('Amplify requires ECHO_STORAGE=aws.');
await writeFile(
  '.env.production',
  keys
    .filter(key => process.env[key])
    .map(key => `${key}=${JSON.stringify(process.env[key])}`)
    .join('\n') + '\n',
  { mode: 0o600 },
);
console.log('Server-only environment prepared. Values omitted.');
