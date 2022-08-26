import { AST_NODE_TYPES, TSESLint, TSESTree } from '@typescript-eslint/utils';
import * as ts from 'typescript';
import * as util from '../util';

type ExportNode =
  | TSESTree.ExportAllDeclaration
  | TSESTree.ExportDefaultDeclaration
  | TSESTree.ExportNamedDeclaration;

interface ExportAndDeclaration {
  exportNode: ExportNode;
  identifier?: TSESTree.Identifier;
}

export default util.createRule({
  name: 'no-unused-exports',
  meta: {
    docs: {
      description: 'Disallow exported',
      recommended: 'error',
      requiresTypeChecking: true,
    },
    hasSuggestions: true,
    messages: {
      exportNeverUsed:
        'This export is never used in any other known files in the project.',
      suggestRemovingExport: 'Remove unused `export`.',
    },
    schema: [],
    type: 'problem',
  },
  defaultOptions: [],
  create(context) {
    const exportedEsNodes: ExportAndDeclaration[] = [];

    return {
      ExportAllDeclaration(node): void {
        exportedEsNodes.push({ exportNode: node });
      },
      ExportNamedDeclaration(node): void {
        for (const identifier of getExportNamedDeclarationIdentifiers(node)) {
          exportedEsNodes.push({
            exportNode: node,
            identifier,
          });
        }
      },
      ExportDefaultDeclaration(node): void {
        exportedEsNodes.push({
          exportNode: node,
          identifier: getExportDefaultDeclarationIdentifier(node),
        });
      },
      'Program:exit'(): void {
        if (!exportedEsNodes.length) {
          return;
        }

        const parserServices = util.getParserServices(context);

        const exportedTsNodes = new Map(
          exportedEsNodes.map(({ exportNode, identifier }) => [
            parserServices.esTreeNodeToTSNodeMap.get(
              exportNode,
            ) as ts.ExportDeclaration,
            identifier &&
              (parserServices.esTreeNodeToTSNodeMap.get(
                identifier,
              ) as ts.Identifier),
          ]),
        );

        for (const otherSourceFile of parserServices.program.getSourceFiles()) {
          const importDeclarations = collectSourceFileImports(
            otherSourceFile,
          ).filter(sourceFileImportReferencesCurrentFile);

          for (const importDeclaration of importDeclarations) {
            for (const [exportedTsNode, identifier] of exportedTsNodes) {
              if (
                importDeclarationCouldImport(
                  importDeclaration,
                  exportedTsNode,
                  identifier,
                )
              ) {
                exportedTsNodes.delete(exportedTsNode);
              }
            }
          }
        }

        for (const [exportedTsNode] of exportedTsNodes) {
          const exportedEsNode =
            parserServices.tsNodeToESTreeNodeMap.get(exportedTsNode);
          const parentExport = exportedEsNode.parent!;

          context.report({
            messageId: 'exportNeverUsed',
            loc: {
              end: {
                column: parentExport.loc.start.column + 'export'.length,
                line: parentExport.loc.end.line,
              },
              start: parentExport.loc.start,
            },
            suggest: [
              {
                fix(fixer): TSESLint.RuleFix {
                  return fixer.removeRange([
                    parentExport.range[0],
                    parentExport.range[0] + 'export '.length,
                  ]);
                },
                messageId: 'suggestRemovingExport',
              },
            ],
          });
        }
      },
    };

    function sourceFileImportReferencesCurrentFile(
      _importDeclaration: ts.ImportDeclaration,
    ): boolean {
      // TODO
      return true;
    }
  },
});

function getExportNamedDeclarationIdentifiers(
  node: TSESTree.ExportNamedDeclaration,
): TSESTree.Identifier[] {
  switch (node.declaration?.type) {
    case AST_NODE_TYPES.VariableDeclaration:
      return node.declaration.declarations.flatMap(variableDeclaration => {
        switch (variableDeclaration.id.type) {
          case AST_NODE_TYPES.ArrayPattern:
            // TODO
            return [];
          case AST_NODE_TYPES.Identifier:
            return variableDeclaration.id;
          case AST_NODE_TYPES.ObjectPattern:
            // TODO
            return [];
        }
      });
  }

  // TODO
  return [];
}

function getExportDefaultDeclarationIdentifier(
  _: TSESTree.ExportDefaultDeclaration,
): TSESTree.Identifier | undefined {
  // TODO
  return undefined;
}

function collectSourceFileImports(
  sourceFile: ts.SourceFile | undefined,
): ts.ImportDeclaration[] {
  if (
    !sourceFile ||
    (sourceFile.fileName.includes('node_modules') &&
      sourceFile.isDeclarationFile)
  ) {
    return [];
  }

  // TODO: also look at dynamic imports
  return sourceFile?.statements.filter(ts.isImportDeclaration) ?? [];
}

function importDeclarationCouldImport(
  _importDeclaration: ts.ImportDeclaration,
  _exportedTsNode: ts.ExportDeclaration,
  _identifier: ts.Identifier | undefined,
): boolean {
  // TODO
  return false;
}
