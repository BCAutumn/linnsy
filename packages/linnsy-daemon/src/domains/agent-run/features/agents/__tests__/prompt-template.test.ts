import { describe, expect, test } from 'vitest';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import { renderPromptTemplate, type PromptTemplateVariables } from '../prompt-template.js';

const variables: PromptTemplateVariables = {
  agent: {
    id: 'linnsy_main',
    displayName: 'Linnsy Main'
  }
};

describe('renderPromptTemplate', () => {
  test('replaces supported prompt variables', () => {
    const rendered = renderPromptTemplate(
      'agent={{agent.id}} name={{agent.display_name}}',
      variables
    );

    expect(rendered).toBe(
      'agent=linnsy_main name=Linnsy Main'
    );
  });

  test('rejects unsupported variables', () => {
    let captured: unknown;

    try {
      renderPromptTemplate('{{owner.name}}', variables);
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(LinnsyError);
    expect((captured as LinnsyError).code).toBe(LINNSY_ERROR_CODES.DEFINITION_INVALID);
  });
});
