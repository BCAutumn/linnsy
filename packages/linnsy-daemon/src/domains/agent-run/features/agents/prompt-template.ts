import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';

export interface PromptTemplateVariables {
  agent: {
    id: string;
    displayName: string;
  };
}

const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/gu;

export function renderPromptTemplate(template: string, variables: PromptTemplateVariables): string {
  return template.replace(TEMPLATE_VARIABLE_PATTERN, (_match, rawKey: string) => {
    const key = rawKey.trim();
    switch (key) {
      case 'agent.id':
        return variables.agent.id;
      case 'agent.display_name':
        return variables.agent.displayName;
      default:
        throw new LinnsyError(
          LINNSY_ERROR_CODES.DEFINITION_INVALID,
          `Unsupported prompt variable ${key}`,
          false
        );
    }
  });
}
