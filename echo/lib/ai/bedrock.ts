import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { AppError } from '../errors';
export async function bedrock(system: string, input: unknown): Promise<string> {
  if (process.env.BEDROCK_RUNTIME_VERIFIED !== 'true' || !process.env.BEDROCK_MODEL_ID)
    throw new AppError(503, 'Bedrock is disabled until runtime access has been verified.');
  const response = await new BedrockRuntimeClient({}).send(
    new ConverseCommand({
      modelId: process.env.BEDROCK_MODEL_ID,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: JSON.stringify({ untrustedData: input }) }] }],
      inferenceConfig: { temperature: 0, maxTokens: 3000 },
    }),
    { abortSignal: AbortSignal.timeout(12000) },
  );
  return (response.output?.message?.content || []).map(c => c.text || '').join('');
}
