import { type BaseSchema, type MaybeValid, type Schema, SchemaType, type ValidationError } from "../../Schema.js";
import { getErrorMessageForIncorrectType } from "../../utils/getErrorMessageForIncorrectType.js";
import { maybeSkipValidation } from "../../utils/maybeSkipValidation.js";
import { getSchemaUtils } from "../schema-utils/index.js";

export function list<Raw, Parsed>(schema: Schema<Raw, Parsed>): Schema<Raw[], Parsed[]> {
    const baseSchema: BaseSchema<Raw[], Parsed[]> = {
        parse: (raw, opts) =>
            validateAndTransformArray(raw, (item, index) =>
                schema.parse(item, {
                    ...opts,
                    breadcrumbsPrefix: [...(opts?.breadcrumbsPrefix ?? []), `[${index}]`],
                }),
            ),
        json: (parsed, opts) =>
            validateAndTransformArray(parsed, (item, index) =>
                schema.json(item, {
                    ...opts,
                    breadcrumbsPrefix: [...(opts?.breadcrumbsPrefix ?? []), `[${index}]`],
                }),
            ),
        getType: () => SchemaType.LIST,
    };

    return {
        ...maybeSkipValidation(baseSchema),
        ...getSchemaUtils(baseSchema),
    };
}

function validateAndTransformArray<Raw, Parsed>(
    value: unknown,
    transformItem: (item: Raw, index: number) => MaybeValid<Parsed>,
): MaybeValid<Parsed[]> {
    if (!Array.isArray(value)) {
        return {
            ok: false,
            errors: [
                {
                    message: getErrorMessageForIncorrectType(value, "list"),
                    path: [],
                },
            ],
        };
    }

    const result: Parsed[] = [];
    const errors: ValidationError[] = [];

    for (let i = 0; i < value.length; i++) {
        const item = transformItem(value[i], i);
        if (item.ok) {
            result.push(item.value);
        } else {
            errors.push(...item.errors);
        }
    }

    if (errors.length === 0) {
        return { ok: true, value: result };
    }
    return { ok: false, errors };
}
