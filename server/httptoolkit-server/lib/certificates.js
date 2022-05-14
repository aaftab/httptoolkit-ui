"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCertificateFingerprint = exports.getCertificateSubjectHash = exports.getTimeToCertExpiry = exports.parseCert = void 0;
const crypto = require("crypto");
const forge = require("node-forge");
exports.parseCert = forge.pki.certificateFromPem;
function getTimeToCertExpiry(cert) {
    const expiry = cert.validity.notAfter.valueOf();
    return expiry - Date.now();
}
exports.getTimeToCertExpiry = getTimeToCertExpiry;
// A series of magic incantations that matches the behaviour of openssl's
// -subject_hash_old output, as expected by Android's cert store.
function getCertificateSubjectHash(cert) {
    const derBytes = forge.asn1.toDer(forge.pki.distinguishedNameToAsn1(cert.subject)).getBytes();
    return crypto.createHash('md5')
        .update(derBytes)
        .digest()
        .readUInt32LE(0)
        .toString(16);
}
exports.getCertificateSubjectHash = getCertificateSubjectHash;
// Get a full SHA1 hash of the certificate
function getCertificateFingerprint(cert) {
    return forge.md.sha1.create()
        .update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())
        .digest()
        .toHex();
}
exports.getCertificateFingerprint = getCertificateFingerprint;
//# sourceMappingURL=certificates.js.map