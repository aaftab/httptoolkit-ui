export declare function prepareDockerTunnel(): Promise<void>;
export declare function ensureDockerTunnelRunning(proxyPort: number): Promise<void>;
export declare function updateDockerTunnelledNetworks(proxyPort: number, interceptedNetworks: string[]): Promise<void>;
export declare function getDockerTunnelPort(proxyPort: number): Promise<number>;
export declare function refreshDockerTunnelPortCache(proxyPort: number, { force }?: {
    force: boolean;
}): Promise<number>;
export declare function stopDockerTunnel(proxyPort: number | 'all'): Promise<void>;
