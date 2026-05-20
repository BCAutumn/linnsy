import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ToolResultWriteInput {
  workspacePath: string;
  toolCallId: string;
  payload: string;
}

export interface ToolResultWriteOutput {
  absolutePath: string;
  ref: string;
}

export class FileToolResultStore {
  public async write(input: ToolResultWriteInput): Promise<ToolResultWriteOutput> {
    const outputDirectory = join(input.workspacePath, 'outputs');
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    const absolutePath = join(outputDirectory, `tool-result-${input.toolCallId}.json`);
    await writeFile(absolutePath, input.payload, 'utf8');
    return {
      absolutePath,
      ref: `file://${absolutePath}`
    };
  }
}
