import { setObjectProperty } from "../../../src/core/utils/setObjectProperty";

interface TestCase {
    description: string;
    giveObject: object;
    givePath: string;
    giveValue: any;
    wantObject: object;
}

describe("Test setObjectProperty", () => {
    const testCases: TestCase[] = [
        {
            description: "empty",
            giveObject: {},
            givePath: "",
            giveValue: 0,
            wantObject: { "": 0 },
        },
        {
            description: "top-level primitive",
            giveObject: {},
            givePath: "age",
            giveValue: 42,
            wantObject: { age: 42 },
        },
        {
            description: "top-level object",
            giveObject: {},
            givePath: "name",
            giveValue: { first: "John", last: "Doe" },
            wantObject: { name: { first: "John", last: "Doe" } },
        },
        {
            description: "top-level array",
            giveObject: {},
            givePath: "values",
            giveValue: [1, 2, 3],
            wantObject: { values: [1, 2, 3] },
        },
        {
            description: "nested object property",
            giveObject: {
                name: {
                    first: "John",
                },
            },
            givePath: "name.last",
            giveValue: "Doe",
            wantObject: { name: { first: "John", last: "Doe" } },
        },
        {
            description: "deeply nested object property",
            giveObject: {
                info: {
                    address: {
                        street: "123 Main St.",
                    },
                    age: 42,
                    name: {
                        last: "Doe",
                    },
                },
            },
            givePath: "info.name.first",
            giveValue: "John",
            wantObject: {
                info: { age: 42, address: { street: "123 Main St." }, name: { first: "John", last: "Doe" } },
            },
        },
    ];
    test.each(testCases)("$description", ({ giveObject, givePath, giveValue, wantObject }) => {
        const result = setObjectProperty(giveObject, givePath, giveValue);
        expect(result).toEqual(wantObject);
    });
});

describe("setObjectProperty does not modify its input", () => {
    test("top-level property", () => {
        const original = { cursor: "a", limit: 10 };
        const result = setObjectProperty(original, "cursor", "b");
        expect(result).toEqual({ cursor: "b", limit: 10 });
        expect(original).toEqual({ cursor: "a", limit: 10 });
    });

    test("nested property", () => {
        const options = { offset: 0, count: 2 };
        const original = { id: "x", options };
        const result = setObjectProperty(original, "options.offset", 2);
        expect(result).toEqual({ id: "x", options: { offset: 2, count: 2 } });
        expect(original).toEqual({ id: "x", options: { offset: 0, count: 2 } });
        expect(original.options).toBe(options);
        expect(result.options).not.toBe(options);
    });

    test("missing nested object", () => {
        const original: { id: string; options?: { offset?: number } } = { id: "x" };
        const result = setObjectProperty(original, "options.offset", 2);
        expect(result).toEqual({ id: "x", options: { offset: 2 } });
        expect(original).toEqual({ id: "x" });
    });

    test("array along the path stays an array", () => {
        const items = [{ name: "a" }];
        const original = { items };
        const result = setObjectProperty(original, "items.0", { name: "b" });
        expect(Array.isArray(result.items)).toBe(true);
        expect(result.items).toEqual([{ name: "b" }]);
        expect(original.items).toBe(items);
        expect(items).toEqual([{ name: "a" }]);
    });
});
