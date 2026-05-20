import type { ExternalAgentKind } from '../../definitions/task.js';

const externalKindByDefinitionKey: ReadonlyMap<string, ExternalAgentKind> = new Map([
  ['delegate_to_codex', 'codex'],
  ['delegate_to_claude_code', 'claude_code'],
  ['delegate_to_cursor', 'cursor'],
  ['delegate_to_linnya', 'linnya']
]);

const definitionKeyByAlias: ReadonlyMap<string, string> = new Map([
  ['codex', 'delegate_to_codex'],
  ['openai_codex', 'delegate_to_codex'],
  ['claude_code', 'delegate_to_claude_code'],
  ['claude', 'delegate_to_claude_code'],
  ['cursor', 'delegate_to_cursor'],
  ['linnya', 'delegate_to_linnya']
]);

export function resolveExternalAgentKind(definitionKey: string): ExternalAgentKind | undefined {
  return externalKindByDefinitionKey.get(definitionKey);
}

export function normalizeExternalAgentDefinitionKey(definitionKey: string): string {
  const trimmed = definitionKey.trim();
  // 主模型偶尔会把主人说的产品名直接填进 definitionKey，例如 codex。
  // 这里只收敛已知外部 vendor 的短名，未知值仍交给 registry fail closed。
  return definitionKeyByAlias.get(toAliasKey(trimmed)) ?? trimmed;
}

export function externalAgentKindUsesDirectoryLocator(externalKind: ExternalAgentKind | undefined): boolean {
  return externalKind === 'codex' || externalKind === 'cursor' || externalKind === 'claude_code';
}

function toAliasKey(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/gu, '_');
}
