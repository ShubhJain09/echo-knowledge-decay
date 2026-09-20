import { compareKnowledge, type CompareInput } from '../lib/ai/provider';
import { demoCompare } from '../lib/intelligence';
import { seedCards } from '../lib/seed';
import type { Relation } from '../lib/types';

/**
 * A labelled smoke evaluation across all eight relation labels. It is a development signal, not a
 * production benchmark. Per-label results are printed because aggregate review precision/recall stay
 * at 1.0 even when a meaningful change is detected under the wrong label.
 */
const cases: readonly (readonly [Relation, string, string])[] = [
  ['process_change', 'Manually restart Service X.', 'Service X now restarts automatically.'],
  ['dependency_change', 'Use Customer API v1.', 'Customer API v1 is deprecated; use Customer API v2.'],
  ['environment_change', 'The database runs on Server A.', 'The database migrated to a managed service.'],
  ['contradiction', 'Service X is enabled in production.', 'Service X is disabled in production.'],
  ['time_sensitive', 'Service X maintenance is on Monday.', 'Service X maintenance is cancelled for Monday.'],
  ['adds_context', 'Service X restarts after deployment.', 'Service X restarts after deployment and logs the event.'],
  ['consistent', 'Service X restarts after deployment.', 'Service X restarts after deployment.'],
  ['unrelated', 'Service X restarts after deployment.', 'The cafeteria offers lunch at noon.'],
];

const needsReview = (relation: Relation) => !['consistent', 'unrelated'].includes(relation);

async function main() {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // .env.local is optional; demo mode needs no configuration.
  }
  const mode = process.argv.includes('--live') ? 'live' : 'demo';
  const provider = (process.env.ECHO_AI === 'bedrock' ? 'bedrock' : 'groq') as CompareInput['provider'];
  const missed: { expected: Relation; actual: string }[] = [];
  let correct = 0,
    truePositives = 0,
    falsePositives = 0,
    falseNegatives = 0,
    failures = 0;

  for (const [expected, statement, evidence] of cases) {
    try {
      const card = { ...seedCards()[0], statement };
      const result =
        mode === 'demo'
          ? demoCompare(card, evidence)
          : await compareKnowledge({ knowledge: card, evidence: { text: evidence, sourceName: 'eval' }, provider });
      if (result.relation === expected) correct++;
      else missed.push({ expected, actual: result.relation });
      if (needsReview(expected) && result.needsReview) truePositives++;
      if (!needsReview(expected) && result.needsReview) falsePositives++;
      if (needsReview(expected) && !result.needsReview) falseNegatives++;
      console.log(`${result.relation === expected ? 'ok  ' : 'MISS'} ${expected.padEnd(19)} -> ${result.relation}`);
    } catch {
      failures++;
      console.log(`FAIL ${expected.padEnd(19)} -> provider or validation failure`);
    }
  }

  console.log(
    JSON.stringify(
      {
        mode,
        cases: cases.length,
        accuracy: correct / cases.length,
        reviewPrecision: truePositives / (truePositives + falsePositives) || 0,
        reviewRecall: truePositives / (truePositives + falseNegatives) || 0,
        failures,
        // Mislabelled rows still count as "needs review", so accuracy is the honest signal here.
        mislabelled: missed,
        note:
          mode === 'demo'
            ? 'Rule-based smoke evaluation, not LLM performance.'
            : 'Small development dataset, not a production benchmark.',
      },
      null,
      2,
    ),
  );
  if (mode === 'demo' && (missed.length || failures)) process.exitCode = 1;
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
