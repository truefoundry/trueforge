import { encodePathParam, join } from "../../../src/core/url/index";

class InvalidPathParameterError extends Error {
    constructor({ message }: { message: string }) {
        super(message);
        this.name = "InvalidPathParameterError";
    }
}

describe("encodePathParam", () => {
    it.each([
        ["usr_123", "usr_123"],
        ["a/b", "a%2Fb"],
        ["a b", "a%20b"],
        ["a?b#c", "a%3Fb%23c"],
        ["...", "..."],
        [".a", ".a"],
        ["a..b", "a..b"],
        ["%2E%2E", "%252E%252E"],
        ["", ""],
        [42, "42"],
        [true, "true"],
        [null, "null"],
        [undefined, "undefined"],
    ])("encodes %j as %j", (input, expected) => {
        expect(encodePathParam(input)).toBe(expected);
    });

    it.each([".", ".."])("rejects the dot segment %j", (input) => {
        expect(() => encodePathParam(input)).toThrow(`Invalid path parameter "${input}"`);
    });

    it("throws the provided error class", () => {
        expect(() => encodePathParam("..", InvalidPathParameterError)).toThrow(InvalidPathParameterError);
    });

    it("does not throw the provided error class for valid values", () => {
        expect(encodePathParam("usr_123", InvalidPathParameterError)).toBe("usr_123");
    });

    it("keeps encoded values in the path when joined with a base URL", () => {
        expect(join("https://api.example.com/api/v2", `/users/${encodePathParam("...")}/roles`)).toBe(
            "https://api.example.com/api/v2/users/.../roles",
        );
    });
});
