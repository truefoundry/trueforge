import { createRequestUrl } from "../../../src/core/fetcher/createRequestUrl";

describe("Test createRequestUrl", () => {
    const BASE_URL = "https://api.example.com";

    interface TestCase {
        description: string;
        baseUrl: string;
        queryParams?: Record<string, any>;
        expected: string;
    }

    const testCases: TestCase[] = [
        {
            description: "should return the base URL when no query parameters are provided",
            baseUrl: BASE_URL,
            expected: BASE_URL,
        },
        {
            description: "should append simple query parameters",
            baseUrl: BASE_URL,
            queryParams: { key: "value", another: "param" },
            expected: "https://api.example.com?key=value&another=param",
        },
        {
            description: "should handle array query parameters",
            baseUrl: BASE_URL,
            queryParams: { items: ["a", "b", "c"] },
            expected: "https://api.example.com?items=a&items=b&items=c",
        },
        {
            description: "should handle object query parameters",
            baseUrl: BASE_URL,
            queryParams: { filter: { name: "John", age: 30 } },
            expected: "https://api.example.com?filter%5Bname%5D=John&filter%5Bage%5D=30",
        },
        {
            description: "should handle mixed types of query parameters",
            baseUrl: BASE_URL,
            queryParams: {
                simple: "value",
                array: ["x", "y"],
                object: { key: "value" },
            },
            expected: "https://api.example.com?simple=value&array=x&array=y&object%5Bkey%5D=value",
        },
        {
            description: "should handle empty query parameters object",
            baseUrl: BASE_URL,
            queryParams: {},
            expected: BASE_URL,
        },
        {
            description: "should encode special characters in query parameters",
            baseUrl: BASE_URL,
            queryParams: { special: "a&b=c d" },
            expected: "https://api.example.com?special=a%26b%3Dc%20d",
        },
        {
            description: "should handle numeric values",
            baseUrl: BASE_URL,
            queryParams: { count: 42, price: 19.99, active: 1, inactive: 0 },
            expected: "https://api.example.com?count=42&price=19.99&active=1&inactive=0",
        },
        {
            description: "should handle boolean values",
            baseUrl: BASE_URL,
            queryParams: { enabled: true, disabled: false },
            expected: "https://api.example.com?enabled=true&disabled=false",
        },
        {
            description: "should handle null and undefined values",
            baseUrl: BASE_URL,
            queryParams: {
                valid: "value",
                nullValue: null,
                undefinedValue: undefined,
                emptyString: "",
            },
            expected: "https://api.example.com?valid=value&emptyString=",
        },
        {
            description: "should handle deeply nested objects",
            baseUrl: BASE_URL,
            queryParams: {
                user: {
                    profile: {
                        name: "John",
                        settings: { theme: "dark" },
                    },
                },
            },
            expected:
                "https://api.example.com?user%5Bprofile%5D%5Bname%5D=John&user%5Bprofile%5D%5Bsettings%5D%5Btheme%5D=dark",
        },
        {
            description: "should handle arrays of objects",
            baseUrl: BASE_URL,
            queryParams: {
                users: [
                    { name: "John", age: 30 },
                    { name: "Jane", age: 25 },
                ],
            },
            expected:
                "https://api.example.com?users%5Bname%5D=John&users%5Bage%5D=30&users%5Bname%5D=Jane&users%5Bage%5D=25",
        },
        {
            description: "should handle mixed arrays",
            baseUrl: BASE_URL,
            queryParams: {
                mixed: ["string", 42, true, { key: "value" }],
            },
            expected: "https://api.example.com?mixed=string&mixed=42&mixed=true&mixed%5Bkey%5D=value",
        },
        {
            description: "should handle empty arrays",
            baseUrl: BASE_URL,
            queryParams: { emptyArray: [] },
            expected: BASE_URL,
        },
        {
            description: "should handle empty objects",
            baseUrl: BASE_URL,
            queryParams: { emptyObject: {} },
            expected: BASE_URL,
        },
        {
            description: "should handle special characters in keys",
            baseUrl: BASE_URL,
            queryParams: { "key with spaces": "value", "key[with]brackets": "value" },
            expected: "https://api.example.com?key%20with%20spaces=value&key%5Bwith%5Dbrackets=value",
        },
        {
            description: "should handle URL with existing query parameters",
            baseUrl: "https://api.example.com?existing=param",
            queryParams: { new: "value" },
            expected: "https://api.example.com?existing=param?new=value",
        },
        {
            description: "should handle complex nested structures",
            baseUrl: BASE_URL,
            queryParams: {
                filters: {
                    status: ["active", "pending"],
                    category: {
                        type: "electronics",
                        subcategories: ["phones", "laptops"],
                    },
                },
                sort: { field: "name", direction: "asc" },
            },
            expected:
                "https://api.example.com?filters%5Bstatus%5D=active&filters%5Bstatus%5D=pending&filters%5Bcategory%5D%5Btype%5D=electronics&filters%5Bcategory%5D%5Bsubcategories%5D=phones&filters%5Bcategory%5D%5Bsubcategories%5D=laptops&sort%5Bfield%5D=name&sort%5Bdirection%5D=asc",
        },
    ];

    testCases.forEach(({ description, baseUrl, queryParams, expected }) => {
        it(description, () => {
            expect(createRequestUrl(baseUrl, queryParams)).toBe(expected);
        });
    });

    it("should default to repeat format for arrays", () => {
        expect(createRequestUrl(BASE_URL, { items: ["a", "b"] })).toBe("https://api.example.com?items=a&items=b");
    });
});
