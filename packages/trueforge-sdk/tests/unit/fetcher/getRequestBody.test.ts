import { getRequestBody } from "../../../src/core/fetcher/getRequestBody";
import { RUNTIME } from "../../../src/core/runtime";

describe("Test getRequestBody", () => {
    interface TestCase {
        description: string;
        input: any;
        type: "json" | "form" | "file" | "bytes" | "other";
        expected: any;
        skipCondition?: () => boolean;
    }

    const testCases: TestCase[] = [
        {
            description: "should stringify body if not FormData in Node environment",
            input: { key: "value" },
            type: "json",
            expected: '{"key":"value"}',
            skipCondition: () => RUNTIME.type !== "node",
        },
        {
            description: "should stringify body if not FormData in browser environment",
            input: { key: "value" },
            type: "json",
            expected: '{"key":"value"}',
            skipCondition: () => RUNTIME.type !== "browser",
        },
        {
            description: "should return the Uint8Array",
            input: new Uint8Array([1, 2, 3]),
            type: "bytes",
            expected: new Uint8Array([1, 2, 3]),
        },
        {
            description: "should serialize objects for form-urlencoded content type",
            input: { username: "johndoe", email: "john@example.com" },
            type: "form",
            expected: "username=johndoe&email=john%40example.com",
        },
        {
            description: "should serialize complex nested objects and arrays for form-urlencoded content type",
            input: {
                user: {
                    profile: {
                        name: "John Doe",
                        settings: {
                            theme: "dark",
                            notifications: true,
                        },
                    },
                    tags: ["admin", "user"],
                    contacts: [
                        { type: "email", value: "john@example.com" },
                        { type: "phone", value: "+1234567890" },
                    ],
                },
                filters: {
                    status: ["active", "pending"],
                    metadata: {
                        created: "2024-01-01",
                        categories: ["electronics", "books"],
                    },
                },
                preferences: ["notifications", "updates"],
            },
            type: "form",
            expected:
                "user%5Bprofile%5D%5Bname%5D=John%20Doe&" +
                "user%5Bprofile%5D%5Bsettings%5D%5Btheme%5D=dark&" +
                "user%5Bprofile%5D%5Bsettings%5D%5Bnotifications%5D=true&" +
                "user%5Btags%5D=admin&" +
                "user%5Btags%5D=user&" +
                "user%5Bcontacts%5D%5Btype%5D=email&" +
                "user%5Bcontacts%5D%5Bvalue%5D=john%40example.com&" +
                "user%5Bcontacts%5D%5Btype%5D=phone&" +
                "user%5Bcontacts%5D%5Bvalue%5D=%2B1234567890&" +
                "filters%5Bstatus%5D=active&" +
                "filters%5Bstatus%5D=pending&" +
                "filters%5Bmetadata%5D%5Bcreated%5D=2024-01-01&" +
                "filters%5Bmetadata%5D%5Bcategories%5D=electronics&" +
                "filters%5Bmetadata%5D%5Bcategories%5D=books&" +
                "preferences=notifications&" +
                "preferences=updates",
        },
        {
            description: "should return the input for pre-serialized form-urlencoded strings",
            input: "key=value&another=param",
            type: "other",
            expected: "key=value&another=param",
        },
        {
            description: "should JSON stringify objects",
            input: { key: "value" },
            type: "json",
            expected: '{"key":"value"}',
        },
    ];

    testCases.forEach(({ description, input, type, expected, skipCondition }) => {
        it(description, async () => {
            if (skipCondition?.()) {
                return;
            }

            const result = await getRequestBody({
                body: input,
                type,
            });

            if (input instanceof Uint8Array) {
                expect(result).toBe(input);
            } else {
                expect(result).toBe(expected);
            }
        });
    });

    it("should return FormData in browser environment", async () => {
        if (RUNTIME.type === "browser") {
            const formData = new FormData();
            formData.append("key", "value");
            const result = await getRequestBody({
                body: formData,
                type: "file",
            });
            expect(result).toBe(formData);
        }
    });
});
