import { type MaybeValid, type Schema, SchemaType, type ValidationError } from "../../Schema.js";
import { getErrorMessageForIncorrectType } from "../../utils/getErrorMessageForIncorrectType.js";
import { isPlainObject } from "../../utils/isPlainObject.js";
import { maybeSkipValidation } from "../../utils/maybeSkipValidation.js";
import { getSchemaUtils } from "../schema-utils/index.js";
import type { BasePartialRecordSchema, BaseRecordSchema, PartialRecordSchema, RecordSchema } from "./types.js";

// eslint-disable-next-line @typescript-eslint/unbound-method
const _hasOwn = Object.prototype.hasOwnProperty;

export function record<RawKey extends string | number, RawValue, ParsedValue, ParsedKey extends string | number>(
    keySchema: Schema<RawKey, ParsedKey>,
    valueSchema: Schema<RawValue, ParsedValue>,
): RecordSchema<RawKey, RawValue, ParsedKey, ParsedValue> {
    const baseSchema: BaseRecordSchema<RawKey, RawValue, ParsedKey, ParsedValue> = {
        parse: (raw, opts) => {
            return validateAndTransformRecord({
                value: raw,
                isKeyNumeric: keySchema.getType() === SchemaType.NUMBER,
                transformKey: (key) =>
                    keySchema.parse(key, {
                        ...opts,
                        breadcrumbsPrefix: [...(opts?.breadcrumbsPrefix ?? []), `${key} (key)`],
                    }),
                transformValue: (value, key) =>
                    valueSchema.parse(value, {
                        ...opts,
                        breadcrumbsPrefix: [...(opts?.breadcrumbsPrefix ?? []), `${key}`],
                    }),
                breadcrumbsPrefix: opts?.breadcrumbsPrefix,
            });
        },
        json: (parsed, opts) => {
            return validateAndTransformRecord({
                value: parsed,
                isKeyNumeric: keySchema.getType() === SchemaType.NUMBER,
                transformKey: (key) =>
                    keySchema.json(key, {
                        ...opts,
                        breadcrumbsPrefix: [...(opts?.breadcrumbsPrefix ?? []), `${key} (key)`],
                    }),
                transformValue: (value, key) =>
                    valueSchema.json(value, {
                        ...opts,
                        breadcrumbsPrefix: [...(opts?.breadcrumbsPrefix ?? []), `${key}`],
                    }),
                breadcrumbsPrefix: opts?.breadcrumbsPrefix,
            });
        },
        getType: () => SchemaType.RECORD,
    };

    return {
        ...maybeSkipValidation(baseSchema),
        ...getSchemaUtils(baseSchema),
    };
}

export function partialRecord<RawKey extends string | number, RawValue, ParsedValue, ParsedKey extends string | number>(
    keySchema: Schema<RawKey, ParsedKey>,
    valueSchema: Schema<RawValue, ParsedValue>,
): PartialRecordSchema<RawKey, RawValue, ParsedKey, ParsedValue> {
    const baseSchema: BasePartialRecordSchema<RawKey, RawValue, ParsedKey, ParsedValue> = {
        parse: (raw, opts) => {
            return validateAndTransformRecord({
                value: raw,
                isKeyNumeric: keySchema.getType() === SchemaType.NUMBER,
                transformKey: (key) =>
                    keySchema.parse(key, {
                        ...opts,
                        breadcrumbsPrefix: [...(opts?.breadcrumbsPrefix ?? []), `${key} (key)`],
                    }),
                transformValue: (value, key) =>
                    valueSchema.parse(value, {
                        ...opts,
                        breadcrumbsPrefix: [...(opts?.breadcrumbsPrefix ?? []), `${key}`],
                    }),
                breadcrumbsPrefix: opts?.breadcrumbsPrefix,
            });
        },
        json: (parsed, opts) => {
            return validateAndTransformRecord({
                value: parsed,
                isKeyNumeric: keySchema.getType() === SchemaType.NUMBER,
                transformKey: (key) =>
                    keySchema.json(key, {
                        ...opts,
                        breadcrumbsPrefix: [...(opts?.breadcrumbsPrefix ?? []), `${key} (key)`],
                    }),
                transformValue: (value, key) =>
                    valueSchema.json(value, {
                        ...opts,
                        breadcrumbsPrefix: [...(opts?.breadcrumbsPrefix ?? []), `${key}`],
                    }),
                breadcrumbsPrefix: opts?.breadcrumbsPrefix,
            });
        },
        getType: () => SchemaType.RECORD,
    };

    return {
        ...maybeSkipValidation(baseSchema),
        ...getSchemaUtils(baseSchema),
    };
}

function validateAndTransformRecord<TransformedKey extends string | number, TransformedValue>({
    value,
    isKeyNumeric,
    transformKey,
    transformValue,
    breadcrumbsPrefix = [],
}: {
    value: unknown;
    isKeyNumeric: boolean;
    transformKey: (key: string | number) => MaybeValid<TransformedKey>;
    transformValue: (value: unknown, key: string | number) => MaybeValid<TransformedValue>;
    breadcrumbsPrefix: string[] | undefined;
}): MaybeValid<Record<TransformedKey, TransformedValue>> {
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

    const result = {} as Record<TransformedKey, TransformedValue>;
    const errors: ValidationError[] = [];

    for (const stringKey in value) {
        if (!_hasOwn.call(value, stringKey)) {
            continue;
        }
        const entryValue = (value as Record<string, unknown>)[stringKey];
        if (entryValue === undefined) {
            continue;
        }

        let key: string | number = stringKey;
        if (isKeyNumeric) {
            const numberKey = stringKey.length > 0 ? Number(stringKey) : NaN;
            if (!Number.isNaN(numberKey)) {
                key = numberKey;
            }
        }
        const transformedKey = transformKey(key);
        const transformedValue = transformValue(entryValue, key);

        if (transformedKey.ok && transformedValue.ok) {
            result[transformedKey.value] = transformedValue.value;
        } else {
            if (!transformedKey.ok) {
                errors.push(...transformedKey.errors);
            }
            if (!transformedValue.ok) {
                errors.push(...transformedValue.errors);
            }
        }
    }

    if (errors.length === 0) {
        return { ok: true, value: result };
    }
    return { ok: false, errors };
}
