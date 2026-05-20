import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export type BoundaryRule =
  | 'no-linnya-internal-import'
  | 'no-linnya-llm-adapter-import'
  | 'no-linnkit-internal-import'
  | 'no-any-annotation'
  | 'no-daemon-api-unsafe-cast'
  | 'no-renderer-src-shared-deep-import'
  | 'no-renderer-payload-redeclare'
  | 'no-persistence-runtime-import'
  | 'no-third-party-llm-sdk';

export interface BoundaryViolation {
  rule: BoundaryRule;
  file: string;
  line: number;
  message: string;
}

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const ignoredPathFragments = [
  'node_modules/',
  'node_modules',
  'dist/',
  'dist',
  'coverage/',
  'coverage',
  '__tests__/contract/boundary-guard.contract.ts'
];

const generatedRuntimeFilePattern = /\.timestamp-\d+-[a-f0-9]+\.mjs$/u;

const forbiddenImports: Array<{ rule: BoundaryRule; pattern: RegExp; message: string }> = [
  {
    rule: 'no-linnya-llm-adapter-import',
    pattern: /src\/infra\/adapters\/llm/,
    message: 'Do not import Linnya LLM adapters; reimplement codecs in src/runtime/llm.'
  },
  {
    rule: 'no-linnya-internal-import',
    pattern: /src\/app-hosts\/linnya/,
    message: 'Do not import Linnya internal product code.'
  },
  {
    rule: 'no-linnkit-internal-import',
    pattern: /@linnlabs\/linnkit\/runtime-kernel\/internal|linnkit\/runtime-kernel\/internal/,
    message: 'Do not import linnkit internal runtime modules; use public exports.'
  }
];

const forbiddenLlmPackages = new Set(['langchain', 'litellm']);

export async function scanBoundaryViolations(projectRoot: string): Promise<BoundaryViolation[]> {
  const files = await listProjectFiles(projectRoot, projectRoot);
  const violations: BoundaryViolation[] = [];

  for (const file of files.filter(isSourceFile)) {
    violations.push(...(await scanSourceFile(projectRoot, file)));
  }

  const packageJson = files.find((file) => relative(projectRoot, file) === 'package.json');
  if (packageJson !== undefined) {
    violations.push(...(await scanPackageJson(projectRoot, packageJson)));
  }

  return violations;
}

async function listProjectFiles(projectRoot: string, currentDirectory: string): Promise<string[]> {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(currentDirectory, entry.name);
    const normalized = normalizePath(relative(projectRoot, fullPath));

    if (isIgnoredProjectPath(normalized)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await listProjectFiles(projectRoot, fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function isSourceFile(filePath: string): boolean {
  const extension = filePath.slice(filePath.lastIndexOf('.'));
  return sourceExtensions.has(extension);
}

function isIgnoredProjectPath(normalizedPath: string): boolean {
  return ignoredPathFragments.some((fragment) => normalizedPath === fragment || normalizedPath.includes(`${fragment}/`))
    || generatedRuntimeFilePattern.test(normalizedPath);
}

async function scanSourceFile(projectRoot: string, filePath: string): Promise<BoundaryViolation[]> {
  const content = await readFile(filePath, 'utf8');
  const relativeFile = normalizePath(relative(projectRoot, filePath));
  const violations: BoundaryViolation[] = [];

  content.split(/\r?\n/).forEach((line, index) => {
    for (const importRule of forbiddenImports) {
      if (importRule.pattern.test(line)) {
        violations.push({
          rule: importRule.rule,
          file: relativeFile,
          line: index + 1,
          message: importRule.message
        });
      }
    }

  });

  violations.push(...scanAnyAnnotations(content, relativeFile));
  violations.push(...scanDaemonApiUnsafeCasts(content, relativeFile));
  violations.push(...scanRendererSrcSharedDeepImports(content, relativeFile));
  violations.push(...scanRendererPayloadRedeclarations(content, relativeFile));
  violations.push(...scanPersistenceRuntimeImports(content, relativeFile));

  return violations;
}

function scanRendererSrcSharedDeepImports(content: string, relativeFile: string): BoundaryViolation[] {
  if (
    !relativeFile.startsWith('app/renderer/src/')
    || relativeFile === 'app/renderer/src/contracts/shared.ts'
  ) {
    return [];
  }

  const violations: BoundaryViolation[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    if (rendererSrcSharedDeepImportPattern.test(line)) {
      violations.push({
        rule: 'no-renderer-src-shared-deep-import',
        file: relativeFile,
        line: index + 1,
        message: 'Renderer code must import daemon wire contracts through @renderer/contracts, not deep relative src/shared paths.'
      });
    }
  });
  return violations;
}

const rendererSrcSharedDeepImportPattern = /\bfrom\s+['"](?:\.\.\/)+src\/shared\//u;

function scanAnyAnnotations(content: string, relativeFile: string): BoundaryViolation[] {
  const sourceFile = ts.createSourceFile(relativeFile, content, ts.ScriptTarget.Latest, true);
  const violations: BoundaryViolation[] = [];

  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        rule: 'no-any-annotation',
        file: relativeFile,
        line: position.line + 1,
        message: 'Do not use any annotations or any assertions; read definitions and narrow unknown.'
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function scanDaemonApiUnsafeCasts(content: string, relativeFile: string): BoundaryViolation[] {
  if (!isRendererDaemonApiBoundary(relativeFile)) {
    return [];
  }

  const sourceFile = ts.createSourceFile(relativeFile, content, ts.ScriptTarget.Latest, true);
  const violations: BoundaryViolation[] = [];

  function visit(node: ts.Node): void {
    if (ts.isAsExpression(node) && isUnsafeDtoAssertionType(node.type)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.type.getStart(sourceFile));
      violations.push({
        rule: 'no-daemon-api-unsafe-cast',
        file: relativeFile,
        line: position.line + 1,
        message: 'Renderer daemon API must validate REST DTOs with zod schemas instead of as unknown / as T assertions.'
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function isRendererDaemonApiBoundary(relativeFile: string): boolean {
  return relativeFile === 'app/renderer/src/lib/daemon-api.ts'
    || relativeFile === 'app/renderer/src/lib/daemon-client.ts'
    || relativeFile === 'app/renderer/src/lib/daemon-http.ts';
}

function isUnsafeDtoAssertionType(typeNode: ts.TypeNode): boolean {
  if (typeNode.kind === ts.SyntaxKind.UnknownKeyword) {
    return true;
  }
  return ts.isTypeReferenceNode(typeNode)
    && ts.isIdentifier(typeNode.typeName)
    && typeNode.typeName.text === 'T';
}

function scanRendererPayloadRedeclarations(content: string, relativeFile: string): BoundaryViolation[] {
  if (relativeFile !== 'app/renderer/src/features/chat/projection/helpers/payload-readers.ts') {
    return [];
  }

  const sourceFile = ts.createSourceFile(relativeFile, content, ts.ScriptTarget.Latest, true);
  const violations: BoundaryViolation[] = [];

  function visit(node: ts.Node): void {
    const payloadName = readPayloadDeclarationName(node);
    if (payloadName !== null) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        rule: 'no-renderer-payload-redeclare',
        file: relativeFile,
        line: position.line + 1,
        message: `Do not redeclare ${payloadName} in renderer payload readers; import payload types from src/domains/observability/definitions/runtime-events.ts.`
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function readPayloadDeclarationName(node: ts.Node): string | null {
  if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith('Payload')) {
    return node.name.text;
  }
  if (ts.isTypeAliasDeclaration(node) && node.name.text.endsWith('Payload')) {
    return node.name.text;
  }
  return null;
}

function scanPersistenceRuntimeImports(content: string, relativeFile: string): BoundaryViolation[] {
  if (!isPersistenceBoundaryFile(relativeFile)) {
    return [];
  }

  const violations: BoundaryViolation[] = [];

  content.split(/\r?\n/).forEach((line, index) => {
    if (relativeRuntimeImportPattern.test(line)) {
      violations.push({
        rule: 'no-persistence-runtime-import',
        file: relativeFile,
        line: index + 1,
        message: 'Persistence must depend on domain/shared contracts, not runtime orchestration modules.'
      });
    }
  });
  return violations;
}

const relativeRuntimeImportPattern = /\bfrom\s+['"](?:\.\.\/)+runtime\//u;

function isPersistenceBoundaryFile(relativeFile: string): boolean {
  return relativeFile.startsWith('src/persistence/')
    || /^src\/domains\/[^/]+\/persistence\//u.test(relativeFile);
}

async function scanPackageJson(projectRoot: string, packageJsonPath: string): Promise<BoundaryViolation[]> {
  const content = await readFile(packageJsonPath, 'utf8');
  const parsed: unknown = JSON.parse(content);

  if (!isPackageLike(parsed)) {
    return [];
  }

  const dependencyNames = [
    ...Object.keys(parsed.dependencies ?? {}),
    ...Object.keys(parsed.devDependencies ?? {})
  ];

  return dependencyNames
    .filter((dependencyName) => isForbiddenLlmDependency(dependencyName))
    .map((dependencyName) => ({
      rule: 'no-third-party-llm-sdk' as const,
      file: normalizePath(relative(projectRoot, packageJsonPath)),
      line: 1,
      message: `Do not add ${dependencyName} as a core LLM SDK dependency.`
    }));
}

function isForbiddenLlmDependency(dependencyName: string): boolean {
  return dependencyName.startsWith('@ai-sdk/') || forbiddenLlmPackages.has(dependencyName);
}

interface PackageLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function isPackageLike(value: unknown): value is PackageLike {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const maybePackage = value as Record<string, unknown>;
  return isDependencyRecord(maybePackage.dependencies) && isDependencyRecord(maybePackage.devDependencies);
}

function isDependencyRecord(value: unknown): value is Record<string, string> | undefined {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Object.values(value).every((dependencyVersion) => typeof dependencyVersion === 'string');
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}

async function runCli(): Promise<number> {
  const projectRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const violations = await scanBoundaryViolations(projectRoot);

  for (const violation of violations) {
    console.error(`${violation.file}:${String(violation.line)} ${violation.rule} ${violation.message}`);
  }

  return violations.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown boundary guard error';
      console.error(message);
      process.exitCode = 1;
    });
}
