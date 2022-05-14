/// <reference types="node" />
export declare const OVERRIDES_DIR: string;
export declare const OVERRIDE_BIN_PATH: string;
export declare const OVERRIDE_JAVA_AGENT: string;
export declare function getTerminalEnvVars(proxyPort: number, httpsConfig: {
    certPath: string;
}, currentEnv: {
    [key: string]: string | undefined;
} | 'runtime-inherit', targetEnvConfig?: {
    httpToolkitIp?: string;
    overridePath?: string;
    targetPlatform?: NodeJS.Platform;
}): {
    [key: string]: string;
};
