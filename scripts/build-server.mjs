import ts from 'typescript';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function buildServer() {
  const source = new URL('../server/api.ts', import.meta.url),
    output = new URL('../server/api.mjs', import.meta.url);
  const result = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  if (result.diagnostics?.some((d) => d.category === ts.DiagnosticCategory.Error))
    throw new Error('Kode server belum dapat dibangun.');
  if (!existsSync(output) || readFileSync(output, 'utf8') !== result.outputText)
    writeFileSync(output, result.outputText);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) buildServer();
