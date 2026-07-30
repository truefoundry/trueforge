import { queryBuilder } from "../../../src/core/url/QueryStringBuilder";

describe("QueryStringBuilder", () => {
    describe("add() — default repeat format", () => {
        it("adds a scalar string value", () => {
            const qs = queryBuilder().add("key", "value").build();
            expect(qs).toBe("key=value");
        });

        it("adds a scalar number value", () => {
            const qs = queryBuilder().add("limit", 10).build();
            expect(qs).toBe("limit=10");
        });

        it("adds a boolean value", () => {
            const qs = queryBuilder().add("active", true).build();
            expect(qs).toBe("active=true");
        });

        it("skips undefined values", () => {
            const qs = queryBuilder().add("key", undefined).build();
            expect(qs).toBe("");
        });

        it("skips null values", () => {
            const qs = queryBuilder().add("key", null).build();
            expect(qs).toBe("");
        });

        it("repeats array elements as separate key=value pairs", () => {
            const qs = queryBuilder().add("color", ["red", "blue", "green"]).build();
            expect(qs).toBe("color=red&color=blue&color=green");
        });

        it("skips undefined items within arrays", () => {
            const qs = queryBuilder().add("color", ["red", undefined, "blue"]).build();
            expect(qs).toBe("color=red&color=blue");
        });

        it("returns empty string for empty array", () => {
            const qs = queryBuilder().add("color", []).build();
            expect(qs).toBe("");
        });

        it("encodes special characters in keys and values", () => {
            const qs = queryBuilder().add("my key", "hello world").build();
            expect(qs).toBe("my%20key=hello%20world");
        });

        it("handles nested objects", () => {
            const qs = queryBuilder().add("filter", { status: "active" }).build();
            expect(qs).toBe("filter%5Bstatus%5D=active");
        });
    });

    describe("add() — comma style", () => {
        it("joins array values with literal commas", () => {
            const qs = queryBuilder().add("tags", ["a", "b", "c"], { style: "comma" }).build();
            expect(qs).toBe("tags=a,b,c");
        });

        it("handles single-element array", () => {
            const qs = queryBuilder().add("tags", ["only"], { style: "comma" }).build();
            expect(qs).toBe("tags=only");
        });

        it("returns empty string for empty array", () => {
            const qs = queryBuilder().add("tags", [], { style: "comma" }).build();
            expect(qs).toBe("");
        });

        it("skips undefined values", () => {
            const qs = queryBuilder().add("tags", undefined, { style: "comma" }).build();
            expect(qs).toBe("");
        });

        it("skips null values", () => {
            const qs = queryBuilder().add("tags", null, { style: "comma" }).build();
            expect(qs).toBe("");
        });

        it("treats scalar values same as default add()", () => {
            const qs = queryBuilder().add("tag", "single", { style: "comma" }).build();
            expect(qs).toBe("tag=single");
        });

        it("encodes commas within individual values as %2C", () => {
            const qs = queryBuilder().add("items", ["a,b", "c"], { style: "comma" }).build();
            expect(qs).toBe("items=a%2Cb,c");
        });

        it("encodes special characters in values", () => {
            const qs = queryBuilder().add("tags", ["hello world", "foo&bar"], { style: "comma" }).build();
            expect(qs).toBe("tags=hello%20world,foo%26bar");
        });
    });

    describe("chaining", () => {
        it("chains multiple add() calls", () => {
            const qs = queryBuilder().add("limit", 10).add("offset", 20).build();
            expect(qs).toBe("limit=10&offset=20");
        });

        it("chains add() with default and comma styles", () => {
            const qs = queryBuilder()
                .add("limit", 10)
                .add("tags", ["ACCESS_GRANTED", "COPY", "DELETE"], { style: "comma" })
                .add("active", true)
                .build();
            expect(qs).toBe("limit=10&tags=ACCESS_GRANTED,COPY,DELETE&active=true");
        });

        it("skips undefined/null params in chain without breaking", () => {
            const qs = queryBuilder()
                .add("a", "1")
                .add("b", undefined)
                .add("c", null, { style: "comma" })
                .add("d", "4")
                .build();
            expect(qs).toBe("a=1&d=4");
        });
    });

    describe("addMany()", () => {
        it("adds all params from a record", () => {
            const qs = queryBuilder().addMany({ limit: 10, offset: 20, name: "test" }).build();
            expect(qs).toBe("limit=10&offset=20&name=test");
        });

        it("skips null and undefined values", () => {
            const qs = queryBuilder().addMany({ a: "1", b: null, c: undefined, d: "4" }).build();
            expect(qs).toBe("a=1&d=4");
        });

        it("handles empty record", () => {
            const qs = queryBuilder().addMany({}).build();
            expect(qs).toBe("");
        });

        it("works with comma-style override after addMany", () => {
            const params = { limit: 10, tags: ["a", "b"], active: true };
            const qs = queryBuilder().addMany(params).add("tags", params.tags, { style: "comma" }).build();
            expect(qs).toBe("limit=10&tags=a,b&active=true");
        });

        it("handles array values with default repeat format", () => {
            const qs = queryBuilder()
                .addMany({ ids: [1, 2, 3] })
                .build();
            expect(qs).toBe("ids=1&ids=2&ids=3");
        });
    });

    describe("mergeAdditional()", () => {
        it("appends additional params", () => {
            const qs = queryBuilder().add("limit", 10).mergeAdditional({ extra: "value" }).build();
            expect(qs).toBe("limit=10&extra=value");
        });

        it("overrides existing keys (last-write-wins)", () => {
            const qs = queryBuilder().add("limit", 10).mergeAdditional({ limit: 20 }).build();
            expect(qs).toBe("limit=20");
        });

        it("handles undefined additional params", () => {
            const qs = queryBuilder().add("limit", 10).mergeAdditional(undefined).build();
            expect(qs).toBe("limit=10");
        });

        it("skips undefined values in additional params", () => {
            const qs = queryBuilder().add("limit", 10).mergeAdditional({ extra: undefined }).build();
            expect(qs).toBe("limit=10");
        });

        it("skips null values in additional params", () => {
            const qs = queryBuilder().add("limit", 10).mergeAdditional({ extra: null }).build();
            expect(qs).toBe("limit=10");
        });

        it("handles array values in additional params using repeat format", () => {
            const qs = queryBuilder()
                .mergeAdditional({ ids: [1, 2, 3] })
                .build();
            expect(qs).toBe("ids=1&ids=2&ids=3");
        });

        it("overrides a comma-style param with repeat format", () => {
            const qs = queryBuilder()
                .add("tags", ["a", "b"], { style: "comma" })
                .mergeAdditional({ tags: ["x", "y"] })
                .build();
            expect(qs).toBe("tags=x&tags=y");
        });
    });

    describe("build()", () => {
        it("returns empty string when no params added", () => {
            const qs = queryBuilder().build();
            expect(qs).toBe("");
        });

        it("does not include leading ?", () => {
            const qs = queryBuilder().add("key", "value").build();
            expect(qs).not.toContain("?");
        });
    });

    describe("end-to-end scenarios", () => {
        it("matches expected query-parameters-openapi output pattern", () => {
            const params: Record<string, unknown> = {
                limit: 1,
                id: "d5e9c84f-c2b2-4bf4-b4b0-7ffd7a9ffc32",
                date: "2023-01-15",
                deadline: "2024-01-15T09:30:00.000Z",
                bytes: "SGVsbG8gd29ybGQh",
                user: "user",
                userList: ["user"],
                optionalString: "optionalString",
                nestedUser: "nestedUser",
                excludeUser: "excludeUser",
                filter: "filter",
                tags: ["tags"],
                optionalTags: undefined,
            };
            const qs = queryBuilder()
                .addMany(params)
                .add("tags", params.tags, { style: "comma" })
                .add("optionalTags", params.optionalTags, { style: "comma" })
                .mergeAdditional(undefined)
                .build();
            expect(qs).toContain("limit=1");
            expect(qs).toContain("tags=tags");
            expect(qs).not.toContain("optionalTags");
        });
    });
});
