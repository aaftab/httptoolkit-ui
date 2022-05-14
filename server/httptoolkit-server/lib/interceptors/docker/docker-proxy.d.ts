/// <reference types="node" />
/// <reference types="mocha" />
export declare const getDockerPipePath: (proxyPort: number, targetPlatform?: NodeJS.Platform) => string;
export declare function ensureDockerProxyRunning(proxyPort: number, httpsConfig: {
    certPath: string;
    certContent: string;
}): Promise<void>;
export declare function stopDockerProxy(proxyPort: number): Promise<void>;
