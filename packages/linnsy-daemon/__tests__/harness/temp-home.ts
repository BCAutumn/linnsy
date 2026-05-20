import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function createTempLinnsyHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'linnsy-home-'));
}
