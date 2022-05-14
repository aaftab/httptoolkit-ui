import * as forge from 'node-forge';
export declare const parseCert: typeof forge.pki.certificateFromPem;
export declare function getTimeToCertExpiry(cert: forge.pki.Certificate): number;
export declare function getCertificateSubjectHash(cert: forge.pki.Certificate): string;
export declare function getCertificateFingerprint(cert: forge.pki.Certificate): string;
