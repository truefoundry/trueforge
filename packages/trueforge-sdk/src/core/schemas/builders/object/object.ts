import { type MaybeValid, type Schema, SchemaType, type ValidationError } from "../../Schema.js";
import { entries } from "../../utils/entries.js";
import { filterObject } from "../../utils/filterObject.js";
import { getErrorMessageForIncorrectType } from "../../utils/getErrorMessageForIncorrectType.js";
import { isPlainObject } from "../../utils/isPlainObject.js";
import { keys } from "../../utils/keys.js";
import { maybeSkipValidation } from "../../utils/maybeSkipValidation.js";
import { partition } from "../../utils/partition.js";
import { getObjectLikeUtils } from "../object-like/index.js";
import { getSchemaUtils } from "../schema-utils/index.js";
import { isProperty } from "./property.js";
import type {
    BaseObjectSchema,
    inferObjectSchemaFromPropertySchemas,
    inferParsedObjectFromPropertySchemas,
    inferRawObjectFromPropertySchemas,
    ObjectSchema,
    ObjectUtils,
    PropertySchemas,
} from "./types.js";

// eslint-disable-next-line @typescript-eslint/unbound-method
const _hasOwn = Object.prototype.hasOwnProperty;

interface ObjectPropertyWithRawKey {
    rawKey: string;
    parsedKey: string;
    valueSchema: Schema<any, any>;
}

export function object<ParsedKeys extends string, T extends PropertySchemas<ParsedKeys>>(
    schemas: T,
): inferObjectSchemaFromPropertySchemas<T> {
    // All property metadata is lazily computed on first use.
    // This keeps schema construction free of iteration, which matters when
    // many schemas are defined but only some are exercised at runtime.
    // Required-key computation is also deferred because lazy() schemas may
    // not be resolved at construction time.

    let _rawKeyToProperty: Record<string, ObjectPropertyWithRawKey> | undefined;

    function getRawKeyToProperty(): Record<string, ObjectPropertyWithRawKey> {
        if (_rawKeyToProperty == null) {
            _rawKeyToProperty = {};
            for (const [parsedKey, schemaOrObjectProperty] of entries(schemas)) {
                const rawKey = isProperty(schemaOrObjectProperty)
                    ? schemaOrObjectProperty.rawKey
                    : (parsedKey as string);
                const valueSchema: Schema<any, any> = isProperty(schemaOrObjectProperty)
                    ? schemaOrObjectProperty.valueSchema
                    : schemaOrObjectProperty;

                _rawKeyToProperty[rawKey] = {
                    rawKey,
                    parsedKey: parsedKey as string,
                    valueSchema,
                };
            }
        }
        return _rawKeyToProperty;
    }

    let _parseRequiredKeys: string[] | undefined;
    let _jsonRequiredKeys: string[] | undefined;
    let _parseRequiredKeysSet: Set<string> | undefined;
    let _jsonRequiredKeysSet: Set<string> | undefined;

    function getParseRequiredKeys(): string[] {
        if (_parseRequiredKeys == null) {
            _parseRequiredKeys = [];
            _jsonRequiredKeys = [];
            for (const [parsedKey, schemaOrObjectProperty] of entries(schemas)) {
                const rawKey = isProperty(schemaOrObjectProperty)
                    ? schemaOrObjectProperty.rawKey
                    : (parsedKey as string);
                const valueSchema: Schema<any, any> = isProperty(schemaOrObjectProperty)
                    ? schemaOrObjectProperty.valueSchema
                    : schemaOrObjectProperty;
                if (isSchemaRequired(valueSchema)) {
                    _parseRequiredKeys.push(rawKey);
                    _jsonRequiredKeys.push(parsedKey as string);
                }
            }
            _parseRequiredKeysSet = new Set(_parseRequiredKeys);
            _jsonRequiredKeysSet = new Set(_jsonRequiredKeys);
        }
        return _parseRequiredKeys;
    }

    function getJsonRequiredKeys(): string[] {
        if (_jsonRequiredKeys == null) {
            getParseRequiredKeys();
        }
        return _jsonRequiredKeys!;
    }

    function getParseRequiredKeysSet(): Set<string> {
        if (_parseRequiredKeysSet == null) {
            getParseRequiredKeys();
        }
        return _parseRequiredKeysSet!;
    }

    function getJsonRequiredKeysSet(): Set<string> {
        if (_jsonRequiredKeysSet == null) {
            getParseRequiredKeys();
        }
        return _jsonRequiredKeysSet!;
    }

    const baseSchema: BaseObjectSchema<
        inferRawObjectFromPropertySchemas<T>,
        inferParsedObjectFromPropertySchemas<T>
    > = {
        _getRawProperties: () =>
            Object.entries(schemas).map(([parsedKey, propertySchema]) =>
                isProperty(propertySchema) ? propertySchema.rawKey : parsedKey,
            ) as unknown as (keyof inferRawObjectFromPropertySchemas<T>)[],
        _getParsedProperties: () => keys(schemas) as unknown as (keyof inferParsedObjectFromPropertySchemas<T>)[],

        parse: (raw, opts) => {
            const breadcrumbsPrefix = opts?.breadcrumbsPrefix ?? [];
            return validateAndTransformObject({
                value: raw,
                requiredKeys: getParseRequiredKeys(),
                requiredKeysSet: getParseRequiredKeysSet(),
                getProperty: (rawKey) => {
                    const property = getRawKeyToProperty()[rawKey];
                    if (property == null) {
                        return undefined;
                    }
                    return {
                        transformedKey: property.parsedKey,
                        transform: (propertyValue) => {
                            const childBreadcrumbs = [...breadcrumbsPrefix, rawKey];
                            return property.valueSchema.parse(propertyValue, {
                                ...opts,
                                breadcrumbsPrefix: childBreadcrumbs,
                            });
                        },
                    };
                },
                unrecognizedObjectKeys: opts?.unrecognizedObjectKeys,
                skipValidation: opts?.skipValidation,
                breadcrumbsPrefix,
                omitUndefined: opts?.omitUndefined,
            });
        },

        json: (parsed, opts) => {
            const breadcrumbsPrefix = opts?.breadcrumbsPrefix ?? [];
            return validateAndTransformObject({
                value: parsed,
                requiredKeys: getJsonRequiredKeys(),
                requiredKeysSet: getJsonRequiredKeysSet(),
                getProperty: (
                    parsedKey,
                ): { transformedKey: string; transform: (propertyValue: object) => MaybeValid<any> } | undefined => {
                    const property = schemas[parsedKey as keyof T];

                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (property == null) {
                        return undefined;
                    }

                    if (isProperty(property)) {
                        return {
                            transformedKey: property.rawKey,
                            transform: (propertyValue) => {
                                const childBreadcrumbs = [...breadcrumbsPrefix, parsedKey];
                                return property.valueSchema.json(propertyValue, {
                                    ...opts,
                                    breadcrumbsPrefix: childBreadcrumbs,
                                });
                            },
                        };
                    } else {
                        return {
                            transformedKey: parsedKey,
                            transform: (propertyValue) => {
                                const childBreadcrumbs = [...breadcrumbsPrefix, parsedKey];
                                return property.json(propertyValue, {
                                    ...opts,
                                    breadcrumbsPrefix: childBreadcrumbs,
                                });
                            },
                        };
                    }
                },
                unrecognizedObjectKeys: opts?.unrecognizedObjectKeys,
                skipValidation: opts?.skipValidation,
                breadcrumbsPrefix,
                omitUndefined: opts?.omitUndefined,
            });
        },

        getType: () => SchemaType.OBJECT,
    };

    return {
        ...maybeSkipValidation(baseSchema),
        ...getSchemaUtils(baseSchema),
        ...getObjectLikeUtils(baseSchema),
        ...getObjectUtils(baseSchema),
    };
}

function validateAndTransformObject<Transformed>({
    value,
    requiredKeys,
    requiredKeysSet,
    getProperty,
    unrecognizedObjectKeys = "fail",
    skipValidation = false,
    breadcrumbsPrefix = [],
}: {
    value: unknown;
    requiredKeys: string[];
    requiredKeysSet: Set<string>;
    getProperty: (
        preTransformedKey: string,
    ) => { transformedKey: string; transform: (propertyValue: object) => MaybeValid<any> } | undefined;
    unrecognizedObjectKeys: "fail" | "passthrough" | "strip" | undefined;
    skipValidation: boolean | undefined;
    breadcrumbsPrefix: string[] | undefined;
    omitUndefined: boolean | undefined;
}): MaybeValid<Transformed> {
    if (!isPlainObject(value)) {
        return {
            ok: false,
            errors: [
                {
                    path: breadcrumbsPrefix,
                    message: getErrorMessageForIncorrectType(value, "object"),
                },
            ],
        };
    }

    // Track which required keys have been seen.
    // Use a counter instead of copying the Set to avoid per-call allocation.
    let missingRequiredCount = requiredKeys.length;
    const errors: ValidationError[] = [];
    const transformed: Record<string | number | symbol, any> = {};

    for (const preTransformedKey in value) {
        if (!_hasOwn.call(value, preTransformedKey)) {
            continue;
        }
        const preTransformedItemValue = value[preTransformedKey];
        const property = getProperty(preTransformedKey);

        if (property != null) {
            if (missingRequiredCount > 0 && requiredKeysSet.has(preTransformedKey)) {
                missingRequiredCount--;
            }

            const value = property.transform(preTransformedItemValue as object);
            if (value.ok) {
                transformed[property.transformedKey] = value.value;
            } else {
                transformed[preTransformedKey] = preTransformedItemValue;
                errors.push(...value.errors);
            }
        } else {
            switch (unrecognizedObjectKeys) {
                case "fail":
                    errors.push({
                        path: [...breadcrumbsPrefix, preTransformedKey],
                        message: `Unexpected key "${preTransformedKey}"`,
                    });
                    break;
                case "strip":
                    break;
                case "passthrough":
                    transformed[preTransformedKey] = preTransformedItemValue;
                    break;
            }
        }
    }

    if (missingRequiredCount > 0) {
        for (const key of requiredKeys) {
            if (!(key in (value as Record<string, unknown>))) {
                errors.push({
                    path: breadcrumbsPrefix,
                    message: `Missing required key "${key}"`,
                });
            }
        }
    }

    if (errors.length === 0 || skipValidation) {
        return {
            ok: true,
            value: transformed as Transformed,
        };
    } else {
        return {
            ok: false,
            errors,
        };
    }
}

export function getObjectUtils<Raw, Parsed>(schema: BaseObjectSchema<Raw, Parsed>): ObjectUtils<Raw, Parsed> {
    return {
        extend: <RawExtension, ParsedExtension>(extension: ObjectSchema<RawExtension, ParsedExtension>) => {
            const baseSchema: BaseObjectSchema<Raw & RawExtension, Parsed & ParsedExtension> = {
                _getParsedProperties: () => [...schema._getParsedProperties(), ...extension._getParsedProperties()],
                _getRawProperties: () => [...schema._getRawProperties(), ...extension._getRawProperties()],
                parse: (raw, opts) => {
                    return validateAndTransformExtendedObject({
                        extensionKeys: extension._getRawProperties(),
                        value: raw,
                        transformBase: (rawBase) => schema.parse(rawBase, opts),
                        transformExtension: (rawExtension) => extension.parse(rawExtension, opts),
                        breadcrumbsPrefix: opts?.breadcrumbsPrefix,
                    });
                },
                json: (parsed, opts) => {
                    return validateAndTransformExtendedObject({
                        extensionKeys: extension._getParsedProperties(),
                        value: parsed,
                        transformBase: (parsedBase) => schema.json(parsedBase, opts),
                        transformExtension: (parsedExtension) => extension.json(parsedExtension, opts),
                        breadcrumbsPrefix: opts?.breadcrumbsPrefix,
                    });
                },
                getType: () => SchemaType.OBJECT,
            };

            return {
                ...baseSchema,
                ...getSchemaUtils(baseSchema),
                ...getObjectLikeUtils(baseSchema),
                ...getObjectUtils(baseSchema),
            };
        },
        passthrough: () => {
            const knownRawKeys = new Set<string>(schema._getRawProperties() as string[]);
            const knownParsedKeys = new Set<string>(schema._getParsedProperties() as string[]);
            const baseSchema: BaseObjectSchema<Raw & { [key: string]: unknown }, Parsed & { [key: string]: unknown }> =
                {
                    _getParsedProperties: () => schema._getParsedProperties(),
                    _getRawProperties: () => schema._getRawProperties(),
                    parse: (raw, opts) => {
                        const transformed = schema.parse(raw, { ...opts, unrecognizedObjectKeys: "passthrough" });
                        if (!transformed.ok) {
                            return transformed;
                        }
                        const extraProperties: Record<string, unknown> = {};
                        if (typeof raw === "object" && raw != null) {
                            for (const [key, value] of Object.entries(raw)) {
                                if (!knownRawKeys.has(key)) {
                                    extraProperties[key] = value;
                                }
                            }
                        }
                        return {
                            ok: true,
                            value: {
                                ...extraProperties,
                                ...transformed.value,
                            },
                        };
                    },
                    json: (parsed, opts) => {
                        const transformed = schema.json(parsed, { ...opts, unrecognizedObjectKeys: "passthrough" });
                        if (!transformed.ok) {
                            return transformed;
                        }
                        const extraProperties: Record<string, unknown> = {};
                        if (typeof parsed === "object" && parsed != null) {
                            for (const [key, value] of Object.entries(parsed)) {
                                if (!knownParsedKeys.has(key)) {
                                    extraProperties[key] = value;
                                }
                            }
                        }
                        return {
                            ok: true,
                            value: {
                                ...extraProperties,
                                ...transformed.value,
                            },
                        };
                    },
                    getType: () => SchemaType.OBJECT,
                };

            return {
                ...baseSchema,
                ...getSchemaUtils(baseSchema),
                ...getObjectLikeUtils(baseSchema),
                ...getObjectUtils(baseSchema),
            };
        },
    };
}

function validateAndTransformExtendedObject<PreTransformedExtension, TransformedBase, TransformedExtension>({
    extensionKeys,
    value,
    transformBase,
    transformExtension,
    breadcrumbsPrefix = [],
}: {
    extensionKeys: (keyof PreTransformedExtension)[];
    value: unknown;
    transformBase: (value: object) => MaybeValid<TransformedBase>;
    transformExtension: (value: object) => MaybeValid<TransformedExtension>;
    breadcrumbsPrefix?: string[];
}): MaybeValid<TransformedBase & TransformedExtension> {
    if (!isPlainObject(value)) {
        return {
            ok: false,
            errors: [
                {
                    path: breadcrumbsPrefix,
                    message: getErrorMessageForIncorrectType(value, "object"),
                },
            ],
        };
    }

    const extensionPropertiesSet = new Set(extensionKeys);
    const [extensionProperties, baseProperties] = partition(keys(value), (key) =>
        extensionPropertiesSet.has(key as keyof PreTransformedExtension),
    );

    const transformedBase = transformBase(filterObject(value, baseProperties));
    const transformedExtension = transformExtension(filterObject(value, extensionProperties));

    if (transformedBase.ok && transformedExtension.ok) {
        return {
            ok: true,
            value: {
                ...transformedBase.value,
                ...transformedExtension.value,
            },
        };
    } else {
        return {
            ok: false,
            errors: [
                ...(transformedBase.ok ? [] : transformedBase.errors),
                ...(transformedExtension.ok ? [] : transformedExtension.errors),
            ],
        };
    }
}

function isSchemaRequired(schema: Schema<any, any>): boolean {
    return !isSchemaOptional(schema);
}

function isSchemaOptional(schema: Schema<any, any>): boolean {
    switch (schema.getType()) {
        case SchemaType.ANY:
        case SchemaType.UNKNOWN:
        case SchemaType.OPTIONAL:
        case SchemaType.OPTIONAL_NULLABLE:
            return true;
        default:
            return false;
    }
}
