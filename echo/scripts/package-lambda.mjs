import { cp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const destination = path.resolve('infra/dist/node_modules');
await mkdir(destination, { recursive: true });
// pdf-parse's PDF.js workers load dynamically and must be shipped alongside the bundle.
for (const name of ['pdf-parse', 'node-ensure', 'debug', 'ms']) {
  const source = path.dirname(require.resolve(`${name}/package.json`));
  await cp(source, path.join(destination, name), { recursive: true });
}
await writeFile('infra/dist/package.json', JSON.stringify({ name: 'echo-lambda', version: '1.0.0', private: true, type: 'commonjs' }, null, 2));
console.log('Lambda bundle prepared in infra/dist. Deploy with AWS CDK.');
