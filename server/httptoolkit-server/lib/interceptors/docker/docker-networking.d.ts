/// <reference types="node" />
import * as stream from 'stream';
import * as Docker from 'dockerode';
interface DockerEvent {
    Type: string;
    Action: string;
    Actor: {
        ID: string;
        Attributes: unknown;
    };
}
/**
 * Activate the network monitor for this proxy port, which will subscribe to Docker events,
 * track the aliases for Docker containers that our intercepted containers might want to
 * talk to, and ensure the DNS & tunnel for this proxy port are configured correctly for each
 * network where we need to route & tunnel that traffic.
 *
 * This method has no effect (and no downside) if the monitor is already running, so it's
 * expected that this will be called whenever a user interacts with Docker in a way related
 * to HTTP Toolkit interception for this port. It's useful to call this often, because its
 * dependent on the events stream connection from Docker that may be fragile and need resetting,
 * in a way that other background services (like the proxy or tunnel container) are not.
 *
 * Network monitors are cached and run in the background, staying alive until either the
 * the Docker event stream shuts down (i.e. Docker engine disappears or similar) or it's
 * explicitly shut down with stopMonitoringDockerNetworkAliases for this proxy port.
 */
export declare function monitorDockerNetworkAliases(proxyPort: number): Promise<DockerNetworkMonitor | undefined>;
export declare function stopMonitoringDockerNetworkAliases(proxyPort: number): void;
/**
 * Network monitors tracks which networks the intercepted containers are connected to, and
 * monitors the network aliases & IPs accessible on those networks.
 */
declare class DockerNetworkMonitor {
    private docker;
    private proxyPort;
    private dockerEventStream;
    constructor(docker: Docker, proxyPort: number, dockerEventStream: stream.Stream);
    stop(): Promise<void>;
    private readonly networkTargets;
    get interceptedNetworks(): string[];
    get dockerRoutedAliases(): ReadonlySet<string>;
    get aliasIpMap(): {
        [host: string]: ReadonlySet<string>;
    };
    onEvent: (event: DockerEvent) => Promise<void>;
    private refreshAllNetworks;
    private isInterceptedContainer;
    private getNetworkAliases;
}
export {};
