export type WorkspaceSubdir = 'inputs' | 'outputs' | 'notes' | 'transcripts';

export interface WorkspaceFileEntry {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedAt: number;
}

export interface WorkspacePort {
  create(taskId: string): Promise<string>;
  resolve(taskId: string): Promise<string | null>;
  list(taskId: string, subdir?: WorkspaceSubdir): Promise<WorkspaceFileEntry[]>;
}
