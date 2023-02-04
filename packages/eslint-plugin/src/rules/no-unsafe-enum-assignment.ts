import { AST_NODE_TYPES, TSESLint, TSESTree } from '@typescript-eslint/utils';
import * as tsutils from 'tsutils';
import * as ts from 'typescript';

import * as util from '../util';
import { getBaseEnumType, getEnumTypes } from './enum-utils/shared';

type MakeRequiredNonNullable<Base, Key extends keyof Base> = Omit<Base, Key> & {
  [K in Key]: NonNullable<Base[Key]>;
};

const ALLOWED_TYPES_FOR_ANY_ENUM_ARGUMENT =
  ts.TypeFlags.Unknown | ts.TypeFlags.Number | ts.TypeFlags.String;

type MessageIds = 'operation' | 'provided' | 'providedProperty';

export default util.createRule<[], MessageIds>({
  name: 'no-unsafe-enum-assignment',
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow providing non-enum values to enum typed locations',
      recommended: 'strict',
      requiresTypeChecking: true,
    },
    messages: {
      operation:
        'This {{ operator }} may change the enum value to one not present in its enum type.',
      provided: 'Unsafe non enum type provided to an enum value.',
      providedProperty:
        'Unsafe non enum type provided to an enum value for property {{ property }}.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const sourceCode = context.getSourceCode();
    const parserServices = util.getParserServices(context);
    const typeChecker = parserServices.program.getTypeChecker();

    /**
     * Similar to `getEnumTypes`, but returns early as soon as it finds one.
     */
    function hasEnumType(node: TSESTree.Node): boolean {
      return tsutils
        .unionTypeParts(getTypeFromNode(node))
        .some(subType => util.isTypeFlagSet(subType, ts.TypeFlags.EnumLiteral));
    }

    function getTypeFromNode(node: TSESTree.Node): ts.Type {
      return typeChecker.getTypeAtLocation(
        parserServices.esTreeNodeToTSNodeMap.get(node),
      );
    }

    /**
     * @returns Whether the recipient type is an enum and the provided type
     * unsafely provides it a number.
     */
    function isProvidedTypeUnsafe(
      providedType: ts.Type,
      recipientType: ts.Type,
    ): boolean {
      // This short-circuits most logic: if the types are the same, we're happy.
      if (providedType === recipientType) {
        return false;
      }

      // `any` types can't be reasoned with
      if (
        tsutils.isTypeFlagSet(recipientType, ts.TypeFlags.Any) ||
        tsutils.isTypeFlagSet(providedType, ts.TypeFlags.Any)
      ) {
        return false;
      }

      // If the two types are containers, check each matching type recursively.
      //
      // ```ts
      // declare let fruits: Fruit[];
      // fruits = [0, 1];
      // ```
      if (
        util.isTypeReferenceType(recipientType) &&
        util.isTypeReferenceType(providedType)
      ) {
        return isProvidedReferenceValueMismatched(providedType, recipientType);
      }

      // If the recipient is not an enum, we don't care about it.
      const recipientEnumTypes = new Set(
        getEnumTypes(typeChecker, recipientType),
      );
      if (recipientEnumTypes.size === 0) {
        return false;
      }

      const providedUnionTypes = tsutils.unionTypeParts(providedType);

      // Either every provided type should match the recipient enum...
      if (
        providedUnionTypes.every(providedType =>
          recipientEnumTypes.has(getBaseEnumType(typeChecker, providedType)),
        )
      ) {
        return false;
      }

      // ...or none of them can be an enum at all
      return !providedUnionTypes.every(tsutils.isEnumType);
    }

    /**
     * Finds the first mismatched type reference: meaning, a non-enum type in
     * the provided type compared to an enum type in the recipient type.
     */
    function isProvidedReferenceValueMismatched(
      providedType: ts.TypeReference,
      recipientType: ts.TypeReference,
    ): boolean {
      const providedTypeArguments = typeChecker.getTypeArguments(providedType);
      const recipientTypeArguments =
        typeChecker.getTypeArguments(recipientType);
      const checkableArguments = Math.min(
        recipientTypeArguments.length,
        providedTypeArguments.length,
      );

      for (let i = 0; i < checkableArguments; i += 1) {
        if (
          isProvidedTypeUnsafe(
            providedTypeArguments[i],
            recipientTypeArguments[i],
          )
        ) {
          return true;
        }
      }

      return false;
    }

    /**
     * @returns The type of the parameter to the node, accounting for generic
     * type parameters.
     */
    function getParameterType(
      node: TSESTree.CallExpression | TSESTree.NewExpression,
      signature: ts.Signature,
      index: number,
    ): ts.Type {
      // If possible, try to find the original parameter to retrieve any generic
      // type parameter. For example:
      //
      // ```ts
      // declare function useFruit<FruitType extends Fruit>(fruitType: FruitType);
      // useFruit(0)
      // ```
      const parameter = signature.getDeclaration()?.parameters[index];
      if (parameter !== undefined) {
        const parameterType = typeChecker.getTypeAtLocation(parameter);
        const constraint = parameterType.getConstraint();
        if (constraint !== undefined) {
          return constraint;
        }
      }

      // Failing that, defer to whatever TypeScript sees as the contextual type.
      return typeChecker.getContextualTypeForArgumentAtIndex(
        parserServices.esTreeNodeToTSNodeMap.get(node),
        index,
      );
    }

    function isMismatchedEnumFunctionArgument(
      argumentType: ts.Type,
      parameterType: ts.Type,
    ): boolean {
      // First, recursively check for functions with type containers like:
      //
      // ```ts
      // declare function useFruits(fruits: Fruit[]);
      // useFruits([0, 1]);
      // ```
      if (util.isTypeReferenceType(argumentType)) {
        const argumentTypeArguments =
          typeChecker.getTypeArguments(argumentType);

        const parameterSubTypes = tsutils.unionTypeParts(parameterType);
        for (const parameterSubType of parameterSubTypes) {
          if (!util.isTypeReferenceType(parameterSubType)) {
            continue;
          }
          const parameterTypeArguments =
            typeChecker.getTypeArguments(parameterSubType);

          for (let i = 0; i < argumentTypeArguments.length; i++) {
            if (
              isMismatchedEnumFunctionArgument(
                argumentTypeArguments[i],
                parameterTypeArguments[i],
              )
            ) {
              return true;
            }
          }
        }

        return false;
      }

      // Allow function calls that have nothing to do with enums, like:
      //
      // ```ts
      // declare function useNumber(num: number);
      // useNumber(0);
      // ```
      const parameterEnumTypes = getEnumTypes(typeChecker, parameterType);
      if (parameterEnumTypes.length === 0) {
        return false;
      }

      // Allow passing enum values into functions that take in the "any" type
      // and similar types that should basically match any enum, like:
      //
      // ```ts
      // declare function useNumber(num: number);
      // useNumber(Fruit.Apple);
      // ```
      const parameterSubTypes = new Set(tsutils.unionTypeParts(parameterType));
      for (const parameterSubType of parameterSubTypes) {
        if (
          util.isTypeFlagSet(
            parameterSubType,
            ALLOWED_TYPES_FOR_ANY_ENUM_ARGUMENT,
          )
        ) {
          return false;
        }
      }

      // Disallow passing number literals into enum parameters, like:
      //
      // ```ts
      // declare function useFruit(fruit: Fruit);
      // declare const fruit: Fruit.Apple | 1;
      // useFruit(fruit)
      // ```
      return tsutils.unionTypeParts(argumentType).some(
        argumentSubType =>
          argumentSubType.isLiteral() &&
          !util.isTypeFlagSet(argumentSubType, ts.TypeFlags.EnumLiteral) &&
          // Permit the argument if it's a number the parameter allows, like:
          //
          // ```ts
          // declare function useFruit(fruit: Fruit | -1);
          // useFruit(-1)
          // ```
          // that's ok too
          !parameterSubTypes.has(argumentSubType),
      );
    }

    /**
     * Checks whether a provided node mismatches
     */
    function compareProvidedNode(
      provided: TSESTree.Node,
      recipient: TSESTree.Node,
    ): void {
      compareProvidedType(
        provided,
        getTypeFromNode(provided),
        getTypeFromNode(recipient),
      );
    }

    /**
     * Checks whether a provided type mismatches
     */
    function compareProvidedType(
      provided: TSESTree.Node,
      providedType: ts.Type,
      recipientType: ts.Type,
      data: Omit<TSESLint.ReportDescriptor<MessageIds>, 'node'> = {
        messageId: 'provided',
      },
    ): void {
      if (isProvidedTypeUnsafe(providedType, recipientType)) {
        context.report({
          node: provided,
          ...data,
        });
      }
    }

    const alreadyCheckedObjects = new Set<TSESTree.Node>();

    function deduplicateObjectsCheck(node: TSESTree.Node): boolean {
      if (alreadyCheckedObjects.has(node)) {
        return false;
      }

      alreadyCheckedObjects.add(node);
      return true;
    }

    function compareObjectType(node: TSESTree.Expression): void {
      if (!deduplicateObjectsCheck(node)) {
        return;
      }

      const type = getTypeFromNode(node);
      const contextualType =
        typeChecker.getContextualType(
          parserServices.esTreeNodeToTSNodeMap.get(node) as ts.Expression,
        ) ?? type;

      for (const property of type.getProperties()) {
        if (!property.valueDeclaration) {
          continue;
        }

        const contextualProperty = contextualType.getProperty(property.name);
        if (!contextualProperty?.valueDeclaration) {
          continue;
        }

        const propertyValueDeclaration =
          parserServices.tsNodeToESTreeNodeMap.get(
            property.valueDeclaration,
          ) as TSESTree.PropertyDefinition | undefined;

        const propertyValueType = typeChecker.getTypeOfSymbolAtLocation(
          property,
          property.valueDeclaration,
        );
        const contextualValueType = typeChecker.getTypeOfSymbolAtLocation(
          contextualProperty,
          contextualProperty.valueDeclaration,
        );

        // If this is an inline object literal, we're able to complain on the specific property key
        if (propertyValueDeclaration?.parent === node) {
          compareProvidedType(
            propertyValueDeclaration.key,
            propertyValueType,
            contextualValueType,
          );
        }
        // Otherwise, complain on the whole node and name the property
        else {
          {
            compareProvidedType(node, propertyValueType, contextualValueType, {
              data: { name: property.name },
              messageId: 'providedProperty',
            });
          }
        }
      }
    }

    return {
      AssignmentPattern(node): void {
        if (hasEnumType(node.left)) {
          compareProvidedNode(node.left, node.right);
        } else {
          compareObjectType(node.right);
        }
      },

      'CallExpression, NewExpression'(
        node: TSESTree.CallExpression | TSESTree.NewExpression,
      ): void {
        const signature = typeChecker.getResolvedSignature(
          parserServices.esTreeNodeToTSNodeMap.get(node),
          undefined,
          node.arguments.length,
        )!;

        // Iterate through the arguments provided to the call function and cross
        // reference their types to the types of the "real" function parameters.
        for (let i = 0; i < node.arguments.length; i++) {
          // any-typed arguments can be ignored altogether
          const argumentType = getTypeFromNode(node.arguments[i]);
          if (
            !argumentType ||
            tsutils.isTypeFlagSet(argumentType, ts.TypeFlags.Any)
          ) {
            continue;
          }

          const parameterType = getParameterType(node, signature, i);

          // Disallow mismatched function calls, like:
          //
          // ```ts
          // declare function useFruit(fruit: Fruit);
          // useFruit(0);
          // ```
          if (isMismatchedEnumFunctionArgument(argumentType, parameterType)) {
            context.report({
              messageId: 'provided',
              node: node.arguments[i],
            });
          }
        }
      },

      'ClassBody > PropertyDefinition[value]:not([typeAnnotation])'(
        node: TSESTree.PropertyDefinition & {
          parent: TSESTree.ClassBody;
        },
      ): void {
        const parentClass = node.parent.parent as
          | TSESTree.ClassDeclaration
          | TSESTree.ClassExpression;
        if (!parentClass.implements) {
          return;
        }

        const { name } = util.getNameFromMember(node, sourceCode);

        for (const baseName of parentClass.implements) {
          const baseType = getTypeFromNode(baseName);
          const basePropertySymbol = typeChecker.getPropertyOfType(
            baseType,
            name,
          );
          if (!basePropertySymbol) {
            continue;
          }

          compareProvidedType(
            node.value!,
            getTypeFromNode(node.value!),
            typeChecker.getTypeOfSymbolAtLocation(
              basePropertySymbol,
              basePropertySymbol.valueDeclaration as ts.Declaration,
            ),
          );
        }
      },

      ObjectExpression(node): void {
        compareObjectType(node);
      },

      'PropertyDefinition[typeAnnotation][value]'(
        node: MakeRequiredNonNullable<
          TSESTree.PropertyDefinition,
          'typeAnnotation' | 'value'
        >,
      ): void {
        compareProvidedNode(node.value, node.key);
      },

      UpdateExpression(node): void {
        if (hasEnumType(node.argument)) {
          context.report({
            data: {
              operator: node.operator,
            },
            messageId: 'operation',
            node,
          });
        }
      },

      'VariableDeclarator[id.typeAnnotation][init]'(
        node: TSESTree.VariableDeclarator & {
          id: {
            typeAnnotation: object;
          };
          init: object;
        },
      ): void {
        if (hasEnumType(node.id.typeAnnotation)) {
          compareProvidedNode(node.init, node.id);
        } else {
          compareObjectType(node.init);
        }
      },
    };
  },
});
