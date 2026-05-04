import { webcrypto } from 'crypto';

// Polyfill browser crypto APIs for the dynamic PoW script
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;
if (!(globalThis as any).window) (globalThis as any).window = {};
if (!(globalThis as any).self) (globalThis as any).self = globalThis;
(globalThis as any).window.crypto = webcrypto;
(globalThis as any).self.crypto = webcrypto;

export interface PowParameters {
  type: string;
  input: string;
  runs: number;
  complexity: number;
}

export interface PowChallenge {
  sessionId: string;
  challengeDetails?: string;
  function: string;       // JS function body defining "run(...)"
  parameters: PowParameters;
  functionLength?: number;
}

export interface PowSolution {
  solutionEncoded: string;
  durationMs: number;
}

export const solvePoW = async (challenge: PowChallenge): Promise<PowSolution> => {
  const start = Date.now();

  const { type, input, runs, complexity } = challenge.parameters;
  const functionBody = challenge.function;

  if (!functionBody) throw new Error('PoW: function body vide');
  if (runs === undefined || complexity === undefined) {
    throw new Error(`PoW: parametres manquants runs=${runs} complexity=${complexity}`);
  }

  // The Queue-it function body defines a function named "run".
  // We append a call to run(type, input, runs, complexity, false) at the end.
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const fn = new AsyncFunction(
    functionBody +
    `; const r = run(
      "${type}",
      "${input}",
      ${runs},
      ${complexity},
      false
    );
    return r instanceof Promise ? await r : r;`
  );

  const solution = await fn();
  const durationMs = Date.now() - start;

  const solutionEncoded = Buffer.from(JSON.stringify(solution), 'utf8').toString('base64');

  return { solutionEncoded, durationMs };
};
