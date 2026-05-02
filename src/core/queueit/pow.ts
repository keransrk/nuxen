import { webcrypto } from 'crypto';

// Polyfill browser crypto APIs for the dynamic PoW script
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;
if (!(globalThis as any).window) (globalThis as any).window = {};
if (!(globalThis as any).self) (globalThis as any).self = {};
(globalThis as any).window.crypto = webcrypto;
(globalThis as any).self.crypto = webcrypto;

export interface PowChallenge {
  sessionId: string;
  parametersType: string;
  runs: number;
  complexity: number;
  functionLength: number;
  functionBody?: string;
}

export interface PowSolution {
  solutionEncoded: string;
  durationMs: number;
}

export const solvePoW = async (challenge: PowChallenge, functionBody: string): Promise<PowSolution> => {
  const start = Date.now();

  // Execute the dynamic PoW function from Queue-it
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const fn = new AsyncFunction(
    'runs',
    'complexity',
    `
    ${functionBody}
    return await solve(runs, complexity);
    `
  );

  const result = await fn(challenge.runs, challenge.complexity);
  const durationMs = Date.now() - start;

  // Encode solution to base64
  const solutionEncoded = Buffer.from(JSON.stringify(result)).toString('base64');

  return { solutionEncoded, durationMs };
};
