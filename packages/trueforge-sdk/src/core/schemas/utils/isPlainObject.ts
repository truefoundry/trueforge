// borrowed from https://github.com/lodash/lodash/blob/master/isPlainObject.js
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const proto = Object.getPrototypeOf(value);
    if (proto === null) {
        return true;
    }

    // Check that the prototype chain has exactly one level (i.e., proto is Object.prototype)
    return Object.getPrototypeOf(proto) === null;
}
