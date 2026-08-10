import { base64Decode, base64Encode } from "../base64.js";

export interface BasicAuth {
    username?: string;
    password?: string;
}

const BASIC_AUTH_HEADER_PREFIX = /^Basic /i;

export const BasicAuth = {
    toAuthorizationHeader: (basicAuth: BasicAuth | undefined): string | undefined => {
        if (basicAuth == null) {
            return undefined;
        }
        const username = basicAuth.username ?? "";
        const password = basicAuth.password ?? "";
        if (username === "" && password === "") {
            return undefined;
        }
        const token = base64Encode(`${username}:${password}`);
        return `Basic ${token}`;
    },
    fromAuthorizationHeader: (header: string): BasicAuth => {
        const credentials = header.replace(BASIC_AUTH_HEADER_PREFIX, "");
        const decoded = base64Decode(credentials);
        const [username, ...passwordParts] = decoded.split(":");
        const password = passwordParts.length > 0 ? passwordParts.join(":") : undefined;

        if (username == null || password == null) {
            throw new Error("Invalid basic auth");
        }
        return {
            username,
            password,
        };
    },
};
