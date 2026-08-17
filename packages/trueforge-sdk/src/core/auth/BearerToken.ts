export type BearerToken = string;

const BEARER_AUTH_HEADER_PREFIX = /^Bearer /i;

function toAuthorizationHeader(token: string | undefined): string | undefined {
    if (token == null) {
        return undefined;
    }
    return `Bearer ${token}`;
}

export const BearerToken: {
    toAuthorizationHeader: typeof toAuthorizationHeader;
    fromAuthorizationHeader: (header: string) => BearerToken;
} = {
    toAuthorizationHeader: toAuthorizationHeader,
    fromAuthorizationHeader: (header: string): BearerToken => {
        return header.replace(BEARER_AUTH_HEADER_PREFIX, "").trim() as BearerToken;
    },
};
