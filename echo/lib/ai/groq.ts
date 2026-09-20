import { z } from 'zod';
import { AppError } from '../errors';
export async function groq(system: string, input: unknown): Promise<string> {
  if (!process.env.GROQ_API_KEY) throw new AppError(503, 'Groq is not configured. Add GROQ_API_KEY on the server.');
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL_ID || 'openai/gpt-oss-20b',
      temperature: 0,
      max_completion_tokens: 3000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify({ untrustedData: input }) },
      ],
    }),
  });
  if (!response.ok) throw new AppError(502, 'Groq inference failed. Please retry.');
  const parsed = z
    .object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) })
    .safeParse(await response.json());
  if (!parsed.success) throw new AppError(502, 'Groq returned an invalid response.');
  return parsed.data.choices[0].message.content;
}
