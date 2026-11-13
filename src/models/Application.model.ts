export interface RateLimit {
    /** Length of the rate limit window in seconds (default 60). */
    windowSeconds?: number;
    /** Maximum requests per client IP and window (default 60). */
    max?: number;
}

export interface IntegrityConfig {
    /** Enable Play Integrity verification (default false). */
    enabled: boolean;
    /** Android package name of the official app. */
    packageName: string;
    /** Accepted Play App Signing SHA-256 digests (recommended). */
    certificateDigests?: string[];
    /** Device verdicts of which at least one is required (default MEETS_DEVICE_INTEGRITY). */
    requiredDeviceVerdicts?: string[];
    /** Rate limit for verified requests; unverified requests use rateLimit. */
    verifiedRateLimit?: RateLimit;
    /** Maximum age of a verdict in seconds (default 120). */
    maxAgeSeconds?: number;
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
    /** Optional Play Integrity policy. */
    integrity?: IntegrityConfig;
}
