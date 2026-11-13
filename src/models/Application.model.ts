export interface RateLimit {
    /** Length of the rate limit window in seconds (default 60). */
    windowSeconds?: number;
    /** Maximum requests per client IP and window (default 60). */
    max?: number;
}

export interface Application {
    id: string;
    name?: string;
    key: string;
    characters?: string;
    maxLength?: number;
    url: string;
    /** Optional per-application rate limit. */
    rateLimit?: RateLimit;
    /** Accepted URI schemes (default http and https). */
    allowedSchemes?: string[];
    /** Optional allow list of hostnames that may be shortened (default: any public host). */
    allowDomains?: string[];
}
