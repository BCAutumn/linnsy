import type { Command } from 'commander';

import type { DoctorResult } from './doctor.js';

export type DoctorRunner = () => Promise<DoctorResult>;

export interface CliCommand {
  name: string;
  description: string;
  register(command: Command): void;
}
