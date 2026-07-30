import { bigint } from "../../../../src/core/schemas/builders/bigint";
import { itJson, itParse, itSchema } from "../utils/itSchema";
import { itValidateJson, itValidateParse } from "../utils/itValidate";

describe("bigint", () => {
    itSchema("converts between raw bigint and parsed bigint", bigint(), {
        raw: BigInt("9007199254740992"),
        parsed: BigInt("9007199254740992"),
    });

    itParse("converts between raw number and parsed bigint", bigint(), {
        raw: 10,
        parsed: BigInt("10"),
    });

    itParse("converts between raw number and parsed bigint", bigint(), {
        raw: BigInt("10"),
        parsed: BigInt("10"),
    });

    itJson("converts raw bigint to parsed bigint", bigint(), {
        parsed: BigInt("10"),
        raw: BigInt("10"),
    });

    itValidateParse("string", bigint(), "42", [
        {
            message: 'Expected bigint | number. Received "42".',
            path: [],
        },
    ]);

    itValidateJson("number", bigint(), 42, [
        {
            message: "Expected bigint. Received 42.",
            path: [],
        },
    ]);

    itValidateJson("string", bigint(), "42", [
        {
            message: 'Expected bigint. Received "42".',
            path: [],
        },
    ]);
});
