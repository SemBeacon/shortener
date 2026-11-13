import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalPayload, evaluateVerdict, hashPayload } from '../../dist/esm/integrity.js';

const now = 1700000000000;
const apiKey = 'Y5Y2SRZ2zo';
const uri = 'https://example.com/profile#me';
const timestamp = String(now);
const expectedPayload = [ 'sembeacon-shorten-v1', apiKey, uri, timestamp ].join('\n');
const expectedHash = 'XuSHw6PaYh5caTd9AkF-UNePyCTnf59QjiCCpQsYm9A';

const config = {
    enabled: true,
    packageName: 'org.sembeacon',
    certificateDigests: ['AB:CD:EF'],
    requiredDeviceVerdicts: ['MEETS_DEVICE_INTEGRITY'],
    maxAgeSeconds: 120,
};

function payload(overrides = {}) {
    return {
        requestDetails: {
            requestPackageName: 'org.sembeacon',
            requestHash: expectedHash,
            timestampMillis: String(now - 1000),
        },
        appIntegrity: {
            appRecognitionVerdict: 'PLAY_RECOGNIZED',
            certificateSha256Digest: ['ab:cd:ef'],
        },
        deviceIntegrity: {
            deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
        },
        accountDetails: {
            appLicensingVerdict: 'LICENSED',
        },
        ...overrides,
    };
}

describe('canonicalPayload', () => {
    it('matches the shared client fixture', () => {
        assert.equal(canonicalPayload(apiKey, uri, timestamp), expectedPayload);
        assert.equal(hashPayload(expectedPayload), expectedHash);
    });
});

describe('evaluateVerdict', () => {
    it('accepts a valid verdict', () => {
        const result = evaluateVerdict(payload(), expectedHash, config, now);
        assert.equal(result.verified, true);
        assert.deepEqual(result.deviceVerdicts, ['MEETS_DEVICE_INTEGRITY']);
    });

    it('accepts digests regardless of case and separators', () => {
        assert.equal(evaluateVerdict(payload(), expectedHash, config, now).verified, true);
    });

    it('rejects a different request hash', () => {
        assert.equal(evaluateVerdict(payload(), 'other', config, now).verified, false);
    });

    it('rejects a different package name', () => {
        const result = evaluateVerdict(
            payload({ requestDetails: { ...payload().requestDetails, requestPackageName: 'org.example' } }),
            expectedHash,
            config,
            now,
        );
        assert.equal(result.reason, 'package name mismatch');
    });

    it('rejects stale and future verdicts', () => {
        const stale = payload({ requestDetails: { ...payload().requestDetails, timestampMillis: now - 121000 } });
        assert.equal(evaluateVerdict(stale, expectedHash, config, now).reason, 'stale verdict');
        const future = payload({ requestDetails: { ...payload().requestDetails, timestampMillis: now + 61000 } });
        assert.equal(evaluateVerdict(future, expectedHash, config, now).reason, 'stale verdict');
    });

    it('rejects a modified app', () => {
        const result = evaluateVerdict(
            payload({ appIntegrity: { ...payload().appIntegrity, appRecognitionVerdict: 'UNRECOGNIZED_VERSION' } }),
            expectedHash,
            config,
            now,
        );
        assert.equal(result.reason, 'app not recognized');
    });

    it('rejects another signing certificate', () => {
        const result = evaluateVerdict(
            payload({ appIntegrity: { ...payload().appIntegrity, certificateSha256Digest: ['00:11:22'] } }),
            expectedHash,
            config,
            now,
        );
        assert.equal(result.reason, 'certificate mismatch');
    });

    it('rejects an unlicensed install', () => {
        const result = evaluateVerdict(
            payload({ accountDetails: { appLicensingVerdict: 'UNLICENSED' } }),
            expectedHash,
            config,
            now,
        );
        assert.equal(result.reason, 'app not licensed');
    });

    it('rejects a weaker device verdict', () => {
        const result = evaluateVerdict(
            payload({ deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } }),
            expectedHash,
            config,
            now,
        );
        assert.equal(result.reason, 'device integrity too low');
    });

    it('requires MEETS_DEVICE_INTEGRITY by default', () => {
        const result = evaluateVerdict(
            payload(),
            expectedHash,
            { ...config, requiredDeviceVerdicts: undefined },
            now,
        );
        assert.equal(result.verified, true);
    });

    it('rejects a missing payload', () => {
        assert.equal(evaluateVerdict(undefined, expectedHash, config, now).verified, false);
    });
});
