import type { AuthProvider } from "./AuthProvider.js";
import type { AuthRequest } from "./AuthRequest.js";

export class NoOpAuthProvider implements AuthProvider {
    public getAuthRequest(): Promise<AuthRequest> {
        return Promise.resolve({ headers: {} });
    }
}
