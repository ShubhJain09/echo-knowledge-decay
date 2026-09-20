import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({oxc:{jsx:{runtime:'automatic'}},resolve:{alias:{'@':path.resolve('.')}},test:{include:['tests/unit/**/*.test.{ts,tsx}','tests/integration/**/*.test.ts'],environment:'node',fileParallelism:false,testTimeout:20000}});
