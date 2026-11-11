import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export interface McpToolDescriptor {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  inputSchema: Record<string, unknown>;
  pathParameters: readonly string[];
  queryParameters: readonly string[];
  bodyParameters: readonly string[];
}

const MCP_EXTENSION = 'x-tfg-mcp';
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function jsonPointerGet(document: JsonObject, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    throw new Error(`Only local OpenAPI references are supported: ${ref}`);
  }
  return ref
    .slice(2)
    .split('/')
    .map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>((value, part) => requireObject(value, `Reference ${ref}`)[part], document);
}

function dereferenceObject(document: JsonObject, value: unknown, label: string): JsonObject {
  const object = requireObject(value, label);
  const ref = object['$ref'];
  return typeof ref === 'string' ? requireObject(jsonPointerGet(document, ref), ref) : object;
}

function schemaProperties(
  document: JsonObject,
  schema: unknown,
  label: string,
): {
  properties: JsonObject;
  required: readonly string[];
} {
  const object = dereferenceObject(document, schema, label);
  if (object['type'] !== 'object' && object['properties'] === undefined) {
    throw new Error(`${label} must resolve to an object schema`);
  }
  const properties = requireObject(object['properties'] ?? {}, `${label}.properties`);
  const required = object['required'];
  if (required !== undefined && (!Array.isArray(required) || required.some(item => typeof item !== 'string'))) {
    throw new Error(`${label}.required must be an array of strings`);
  }
  return { properties, required: (required ?? []) as string[] };
}

/**
 * An MCP tool's inputSchema ships to the client on its own — the OpenAPI document (and its
 * `components/schemas`) does not travel with it, so a `#/components/schemas/X` ref would dangle.
 * Rewrite those refs to local `#/$defs/X` and inline the referenced definitions, producing a
 * self-contained schema. `$defs` (not inlining) keeps recursive/shared schemas finite; the
 * `visiting` set guards cycles. This also lets `z.fromJSONSchema` resolve the refs downstream.
 */
function bundleSchema({ document, root }: { document: JsonObject; root: JsonObject }): JsonObject {
  const definitions: JsonObject = {};
  const visiting = new Set<string>();

  function visit(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    if (!isObject(value)) {
      return value;
    }
    const ref = value['$ref'];
    if (typeof ref === 'string') {
      if (!ref.startsWith('#/components/schemas/')) {
        throw new Error(`Unsupported MCP schema reference: ${ref}`);
      }
      const name = ref.slice('#/components/schemas/'.length);
      if (!(name in definitions) && !visiting.has(name)) {
        visiting.add(name);
        definitions[name] = visit(jsonPointerGet(document, ref));
        visiting.delete(name);
      }
      return {
        ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$ref')),
        $ref: `#/$defs/${name}`,
      };
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
  }

  const bundled = requireObject(visit(root), 'Bundled input schema');
  return Object.keys(definitions).length === 0 ? bundled : { ...bundled, $defs: definitions };
}

function parseExtension(
  value: unknown,
  operationLabel: string,
): {
  name: string;
  description: string;
  annotations: McpToolDescriptor['annotations'];
} {
  const extension = requireObject(value, `${operationLabel}.${MCP_EXTENSION}`);
  const name = requireString(extension['name'], `${operationLabel}.${MCP_EXTENSION}.name`);
  const description = requireString(extension['description'], `${operationLabel}.${MCP_EXTENSION}.description`);
  const annotations = requireObject(extension['annotations'], `${operationLabel}.${MCP_EXTENSION}.annotations`);
  if (typeof annotations['readOnlyHint'] !== 'boolean') {
    throw new Error(`${operationLabel} must declare readOnlyHint`);
  }
  if (
    !annotations['readOnlyHint'] &&
    (typeof annotations['destructiveHint'] !== 'boolean' || typeof annotations['idempotentHint'] !== 'boolean')
  ) {
    throw new Error(`${operationLabel} mutations must declare destructiveHint and idempotentHint`);
  }
  return {
    name,
    description,
    annotations: {
      readOnlyHint: annotations['readOnlyHint'],
      ...(typeof annotations['destructiveHint'] === 'boolean'
        ? { destructiveHint: annotations['destructiveHint'] }
        : {}),
      ...(typeof annotations['idempotentHint'] === 'boolean' ? { idempotentHint: annotations['idempotentHint'] } : {}),
    },
  };
}

export function mcpToolsFromOpenApi(documentValue: unknown): McpToolDescriptor[] {
  const document = requireObject(documentValue, 'OpenAPI document');
  const paths = requireObject(document['paths'], 'OpenAPI paths');
  const descriptors: McpToolDescriptor[] = [];
  const names = new Set<string>();

  for (const path of Object.keys(paths).sort()) {
    const pathItem = requireObject(paths[path], `Path ${path}`);
    for (const method of HTTP_METHODS) {
      const operationValue = pathItem[method];
      if (!isObject(operationValue) || operationValue[MCP_EXTENSION] === undefined) {
        continue;
      }
      const operationLabel = `${method.toUpperCase()} ${path}`;
      const metadata = parseExtension(operationValue[MCP_EXTENSION], operationLabel);
      if (names.has(metadata.name)) {
        throw new Error(`Duplicate MCP tool name: ${metadata.name}`);
      }
      names.add(metadata.name);

      const properties: JsonObject = {};
      const required = new Set<string>();
      const pathParameters: string[] = [];
      const queryParameters: string[] = [];
      const pathItemParameters = pathItem['parameters'];
      const operationParameters = operationValue['parameters'];
      const parameters = [
        ...(Array.isArray(pathItemParameters) ? (pathItemParameters as unknown[]) : []),
        ...(Array.isArray(operationParameters) ? (operationParameters as unknown[]) : []),
      ];
      for (const parameterValue of parameters) {
        const parameter = dereferenceObject(document, parameterValue, `${operationLabel} parameter`);
        const parameterName = requireString(parameter['name'], `${operationLabel} parameter name`);
        if (properties[parameterName] !== undefined) {
          throw new Error(`${operationLabel} has duplicate input property ${parameterName}`);
        }
        if (parameter['in'] !== 'path' && parameter['in'] !== 'query') {
          throw new Error(`${operationLabel} has unsupported ${String(parameter['in'])} parameter ${parameterName}`);
        }
        properties[parameterName] = parameter['schema'] ?? {};
        if (parameter['required'] === true) {
          required.add(parameterName);
        }
        (parameter['in'] === 'path' ? pathParameters : queryParameters).push(parameterName);
      }

      const bodyParameters: string[] = [];
      if (operationValue['requestBody'] !== undefined) {
        const requestBody = dereferenceObject(document, operationValue['requestBody'], `${operationLabel} requestBody`);
        const content = requireObject(requestBody['content'], `${operationLabel} requestBody.content`);
        const mediaType = requireObject(content['application/json'], `${operationLabel} application/json request body`);
        const body = schemaProperties(document, mediaType['schema'], `${operationLabel} request body schema`);
        for (const [propertyName, propertySchema] of Object.entries(body.properties)) {
          if (properties[propertyName] !== undefined) {
            throw new Error(`${operationLabel} input property collision: ${propertyName}`);
          }
          properties[propertyName] = propertySchema;
          bodyParameters.push(propertyName);
        }
        if (requestBody['required'] === true) {
          body.required.forEach(name => required.add(name));
        }
      }

      const inputSchema = bundleSchema({
        document,
        root: {
          type: 'object',
          properties,
          ...(required.size === 0 ? {} : { required: [...required].sort() }),
          additionalProperties: false,
        },
      });
      descriptors.push({
        name: metadata.name,
        description: metadata.description,
        annotations: metadata.annotations,
        method: method.toUpperCase() as McpToolDescriptor['method'],
        path,
        inputSchema,
        pathParameters,
        queryParameters,
        bodyParameters,
      });
    }
  }

  return descriptors.sort((left, right) => left.name.localeCompare(right.name));
}
