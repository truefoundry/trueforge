import type { BaseSchema } from "../../Schema.js";
import type { SchemaUtils } from "../schema-utils/index.js";

export type RecordSchema<
    RawKey extends string | number,
    RawValue,
    ParsedKey extends string | number,
    ParsedValue,
> = BaseRecordSchema<RawKey, RawValue, ParsedKey, ParsedValue> &
    SchemaUtils<Record<RawKey, RawValue>, Record<ParsedKey, ParsedValue>>;

export type BaseRecordSchema<
    RawKey extends string | number,
    RawValue,
    ParsedKey extends string | number,
    ParsedValue,
> = BaseSchema<Record<RawKey, RawValue>, Record<ParsedKey, ParsedValue>>;

export type PartialRecordSchema<
    RawKey extends string | number,
    RawValue,
    ParsedKey extends string | number,
    ParsedValue,
> = BasePartialRecordSchema<RawKey, RawValue, ParsedKey, ParsedValue> &
    SchemaUtils<Record<RawKey, RawValue>, Partial<Record<ParsedKey, ParsedValue>>>;

export type BasePartialRecordSchema<
    RawKey extends string | number,
    RawValue,
    ParsedKey extends string | number,
    ParsedValue,
> = BaseSchema<Record<RawKey, RawValue>, Partial<Record<ParsedKey, ParsedValue>>>;
