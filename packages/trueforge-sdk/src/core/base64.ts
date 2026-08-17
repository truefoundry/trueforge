function base64ToBytes(base64: string): Uint8Array {
    const binString = atob(base64);
    return Uint8Array.from(binString, (m) => m.codePointAt(0)!);
}

function bytesToBase64(bytes: Uint8Array): string {
    const binString = String.fromCodePoint(...bytes);
    return btoa(binString);
}

export function base64Encode(input: string): string {
    if (typeof Buffer !== "undefined") {
        return Buffer.from(input, "utf8").toString("base64");
    }

    const bytes = new TextEncoder().encode(input);
    return bytesToBase64(bytes);
}

export function base64Decode(input: string): string {
    if (typeof Buffer !== "undefined") {
        return Buffer.from(input, "base64").toString("utf8");
    }

    const bytes = base64ToBytes(input);
    return new TextDecoder().decode(bytes);
}
