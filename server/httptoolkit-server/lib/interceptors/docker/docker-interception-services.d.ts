import { ProxySettingCallback } from 'mockttp';
export declare const isDockerAvailable: () => Promise<boolean>;
export declare function startDockerInterceptionServices(proxyPort: number, httpsConfig: {
    certPath: string;
    certContent: string;
}, ruleParameters: {
    [key: `docker-tunnel-proxy-${number}`]: ProxySettingCallback;
}): Promise<void>;
export declare function ensureDockerServicesRunning(proxyPort: number): Promise<void>;
export declare function stopDockerInterceptionServices(proxyPort: number, ruleParameters: {
    [key: `docker-tunnel-proxy-${number}`]: ProxySettingCallback;
}): Promise<void>;
export declare function deleteAllInterceptedDockerData(proxyPort: number | 'all'): Promise<void>;
