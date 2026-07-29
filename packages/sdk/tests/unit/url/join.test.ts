import { join } from "../../../src/core/url/index";

describe("join", () => {
    interface TestCase {
        description: string;
        base: string;
        segments: string[];
        expected: string;
    }

    describe("basic functionality", () => {
        const basicTests: TestCase[] = [
            { description: "should return empty string for empty base", base: "", segments: [], expected: "" },
            {
                description: "should return empty string for empty base with path",
                base: "",
                segments: ["path"],
                expected: "",
            },
            {
                description: "should handle single segment",
                base: "base",
                segments: ["segment"],
                expected: "base/segment",
            },
            {
                description: "should handle single segment with trailing slash on base",
                base: "base/",
                segments: ["segment"],
                expected: "base/segment",
            },
            {
                description: "should handle single segment with leading slash",
                base: "base",
                segments: ["/segment"],
                expected: "base/segment",
            },
            {
                description: "should handle single segment with both slashes",
                base: "base/",
                segments: ["/segment"],
                expected: "base/segment",
            },
            {
                description: "should handle multiple segments",
                base: "base",
                segments: ["path1", "path2", "path3"],
                expected: "base/path1/path2/path3",
            },
            {
                description: "should handle multiple segments with slashes",
                base: "base/",
                segments: ["/path1/", "/path2/", "/path3/"],
                expected: "base/path1/path2/path3/",
            },
        ];

        basicTests.forEach(({ description, base, segments, expected }) => {
            it(description, () => {
                expect(join(base, ...segments)).toBe(expected);
            });
        });
    });

    describe("URL handling", () => {
        const urlTests: TestCase[] = [
            {
                description: "should handle absolute URLs",
                base: "https://example.com",
                segments: ["api", "v1"],
                expected: "https://example.com/api/v1",
            },
            {
                description: "should handle absolute URLs with slashes",
                base: "https://example.com/",
                segments: ["/api/", "/v1/"],
                expected: "https://example.com/api/v1/",
            },
            {
                description: "should handle absolute URLs with base path",
                base: "https://example.com/base",
                segments: ["api", "v1"],
                expected: "https://example.com/base/api/v1",
            },
            {
                description: "should preserve URL query parameters",
                base: "https://example.com?query=1",
                segments: ["api"],
                expected: "https://example.com/api?query=1",
            },
            {
                description: "should preserve URL fragments",
                base: "https://example.com#fragment",
                segments: ["api"],
                expected: "https://example.com/api#fragment",
            },
            {
                description: "should preserve URL query and fragments",
                base: "https://example.com?query=1#fragment",
                segments: ["api"],
                expected: "https://example.com/api?query=1#fragment",
            },
            {
                description: "should handle http protocol",
                base: "http://example.com",
                segments: ["api"],
                expected: "http://example.com/api",
            },
            {
                description: "should handle ftp protocol",
                base: "ftp://example.com",
                segments: ["files"],
                expected: "ftp://example.com/files",
            },
            {
                description: "should handle ws protocol",
                base: "ws://example.com",
                segments: ["socket"],
                expected: "ws://example.com/socket",
            },
            {
                description: "should fallback to path joining for malformed URLs",
                base: "not-a-url://",
                segments: ["path"],
                expected: "not-a-url:///path",
            },
        ];

        urlTests.forEach(({ description, base, segments, expected }) => {
            it(description, () => {
                expect(join(base, ...segments)).toBe(expected);
            });
        });
    });

    describe("edge cases", () => {
        const edgeCaseTests: TestCase[] = [
            {
                description: "should handle empty segments",
                base: "base",
                segments: ["", "path"],
                expected: "base/path",
            },
            {
                description: "should handle null segments",
                base: "base",
                segments: [null as any, "path"],
                expected: "base/path",
            },
            {
                description: "should handle undefined segments",
                base: "base",
                segments: [undefined as any, "path"],
                expected: "base/path",
            },
            {
                description: "should handle segments with only single slash",
                base: "base",
                segments: ["/", "path"],
                expected: "base/path",
            },
            {
                description: "should handle segments with only double slash",
                base: "base",
                segments: ["//", "path"],
                expected: "base/path",
            },
            {
                description: "should handle base paths with trailing slashes",
                base: "base/",
                segments: ["path"],
                expected: "base/path",
            },
            {
                description: "should handle complex nested paths",
                base: "api/v1/",
                segments: ["/users/", "/123/", "/profile"],
                expected: "api/v1/users/123/profile",
            },
        ];

        edgeCaseTests.forEach(({ description, base, segments, expected }) => {
            it(description, () => {
                expect(join(base, ...segments)).toBe(expected);
            });
        });
    });

    describe("real-world scenarios", () => {
        const realWorldTests: TestCase[] = [
            {
                description: "should handle API endpoint construction",
                base: "https://api.example.com/v1",
                segments: ["users", "123", "posts"],
                expected: "https://api.example.com/v1/users/123/posts",
            },
            {
                description: "should handle file path construction",
                base: "/var/www",
                segments: ["html", "assets", "images"],
                expected: "/var/www/html/assets/images",
            },
            {
                description: "should handle relative path construction",
                base: "../parent",
                segments: ["child", "grandchild"],
                expected: "../parent/child/grandchild",
            },
            {
                description: "should handle Windows-style paths",
                base: "C:\\Users",
                segments: ["Documents", "file.txt"],
                expected: "C:\\Users/Documents/file.txt",
            },
        ];

        realWorldTests.forEach(({ description, base, segments, expected }) => {
            it(description, () => {
                expect(join(base, ...segments)).toBe(expected);
            });
        });
    });

    describe("performance scenarios", () => {
        it("should handle many segments efficiently", () => {
            const segments = Array(100).fill("segment");
            const result = join("base", ...segments);
            expect(result).toBe(`base/${segments.join("/")}`);
        });

        it("should handle long URLs", () => {
            const longPath = "a".repeat(1000);
            expect(join("https://example.com", longPath)).toBe(`https://example.com/${longPath}`);
        });
    });

    describe("trailing slash preservation", () => {
        const trailingSlashTests: TestCase[] = [
            {
                description:
                    "should preserve trailing slash on final result when base has trailing slash and no segments",
                base: "https://api.example.com/",
                segments: [],
                expected: "https://api.example.com/",
            },
            {
                description: "should preserve trailing slash on v1 path",
                base: "https://api.example.com/v1/",
                segments: [],
                expected: "https://api.example.com/v1/",
            },
            {
                description: "should preserve trailing slash when last segment has trailing slash",
                base: "https://api.example.com",
                segments: ["users/"],
                expected: "https://api.example.com/users/",
            },
            {
                description: "should preserve trailing slash with relative path",
                base: "api/v1",
                segments: ["users/"],
                expected: "api/v1/users/",
            },
            {
                description: "should preserve trailing slash with multiple segments",
                base: "https://api.example.com",
                segments: ["v1", "collections/"],
                expected: "https://api.example.com/v1/collections/",
            },
            {
                description: "should preserve trailing slash with base path",
                base: "base",
                segments: ["path1", "path2/"],
                expected: "base/path1/path2/",
            },
        ];

        trailingSlashTests.forEach(({ description, base, segments, expected }) => {
            it(description, () => {
                expect(join(base, ...segments)).toBe(expected);
            });
        });
    });
});
