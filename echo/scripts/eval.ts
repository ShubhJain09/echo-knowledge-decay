import { compareKnowledge, type CompareInput } from '../lib/ai/provider';
import { demoCompare } from '../lib/intelligence';
import { seedCards } from '../lib/seed';
const cases = [
  ['process_change', 'Manually restart Service X.', 'Service X now restarts automatically.'],
  ['dependency_change', 'Use Customer API v1.', 'Customer API v1 is deprecated; use Customer API v2.'],
  ['environment_change', 'The database runs on Server A.', 'The database migrated to a managed service.'],
  ['contradiction', 'Service X is enabled in production.', 'Service X is disabled in production.'],
  ['time_sensitive', 'Service X maintenance is on Monday.', 'Service X maintenance is cancelled for Monday.'],
  ['adds_context', 'Service X restarts after deployment.', 'Service X restarts after deployment and logs the event.'],
  ['consistent', 'Service X restarts after deployment.', 'Service X restarts after deployment.'],
  ['unrelated', 'Service X restarts after deployment.', 'The cafeteria offers lunch at noon.'],
] as const;
async function main() {
  try {
    process.loadEnvFile('.env.local');
  } catch {}
  let correct = 0,
    tp = 0,
    fp = 0,
    fn = 0,
    failures = 0;
  const mode = process.argv.includes('--live') ? 'live' : 'demo';
  for (const [label, statement, evidence] of cases) {
    try {
      const card = { ...seedCards()[0], statement };
      const result =
        mode === 'demo'
          ? demoCompare(card, evidence)
          : await compareKnowledge({
              knowledge: card,
              evidence: { text: evidence, sourceName: 'eval' },
              provider: (process.env.ECHO_AI === 'bedrock' ? 'bedrock' : 'groq') as CompareInput['provider'],
            });
      if (result.relation === label) correct++;
      const actual = !['consistent', 'unrelated'].includes(label);
      if (actual && result.needsReview) tp++;
      if (!actual && result.needsReview) fp++;
      if (actual && !result.needsReview) fn++;
      console.log(`${label}: ${result.relation}`);
    } catch {
      failures++;
      console.log(`${label}: provider or validation failure`);
    }
  }
  console.log(
    JSON.stringify(
      {
        mode,
        cases: cases.length,
        accuracy: correct / cases.length,
        reviewPrecision: tp / (tp + fp) || 0,
        reviewRecall: tp / (tp + fn) || 0,
        failures,
        note:
          mode === 'demo'
            ? 'Rule-based smoke evaluation, not LLM performance.'
            : 'Small development dataset, not a production benchmark.',
      },
      null,
      2,
    ),
  );
}
main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
