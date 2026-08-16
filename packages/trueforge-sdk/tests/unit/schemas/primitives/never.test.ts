import { never } from "../../../../src/core/schemas/builders";

describe("never", () => {
    it("always fails to parse", () => {
        const schema = never();
        const result = schema.parse("test");
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]?.message).toBe("Expected never");
        }
    });

    it("always fails to json", () => {
        const schema = never();
        const result = schema.json("test");
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]?.message).toBe("Expected never");
        }
    });

    it("fails with any value including undefined", () => {
        const schema = never();
        expect(schema.parse(undefined).ok).toBe(false);
        expect(schema.parse(null).ok).toBe(false);
        expect(schema.parse(0).ok).toBe(false);
        expect(schema.parse("").ok).toBe(false);
        expect(schema.parse({}).ok).toBe(false);
        expect(schema.parse([]).ok).toBe(false);
    });

    it("works when called without options parameter", () => {
        const schema = never();
        // This tests that the default = {} parameter works correctly
        const result = schema.parse("test");
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]?.message).toBe("Expected never");
            expect(result.errors[0]?.path).toEqual([]);
        }
    });

    it("succeeds with skipValidation", () => {
        const schema = never();
        const result = schema.parse("test", { skipValidation: true });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toBe("test");
        }
    });
});
