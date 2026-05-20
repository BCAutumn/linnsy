import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { InternalSubAgentExecutor, InternalSubAgentRunInput, InternalSubAgentRunResult } from './types.js';

export function createEchoInternalSubAgentExecutor(): InternalSubAgentExecutor {
  return {
    async execute(input: InternalSubAgentRunInput): Promise<InternalSubAgentRunResult> {
      const text = `Echo: ${input.goal}`;
      const outputPath = join(input.workspacePath, 'outputs', 'result.txt');
      await mkdir(join(input.workspacePath, 'outputs'), { recursive: true, mode: 0o700 });
      await writeFile(outputPath, `${text}\n`, { mode: 0o600 });

      const transcript = [
        `definitionKey: ${input.definitionKey}`,
        `goal: ${input.goal}`,
        input.context === undefined ? undefined : `context: ${input.context}`,
        `output: ${outputPath}`
      ].filter(isString).join('\n');

      return {
        result: {
          text,
          outputPath
        },
        transcript
      };
    }
  };
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
