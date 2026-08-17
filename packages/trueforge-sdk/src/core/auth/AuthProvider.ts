import type { EndpointMetadata } from "../fetcher/EndpointMetadata.js";
import type { AuthRequest } from "./AuthRequest.js";

export interface AuthProvider {
    getAuthRequest(arg?: { endpointMetadata?: EndpointMetadata }): Promise<AuthRequest>;
}

export function isAuthProvider(value: unknown): value is AuthProvider {
    return (
        typeof value === "object" &&
        value !== null &&
        "getAuthRequest" in value &&
        typeof value.getAuthRequest === "function"
    );
}
