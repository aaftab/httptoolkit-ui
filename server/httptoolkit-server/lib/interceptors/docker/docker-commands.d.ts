/// <reference types="node" />
import * as Docker from 'dockerode';
export declare const DOCKER_CONTAINER_LABEL = "tech.httptoolkit.docker.proxy";
/**
 * The hostname that resolves to the host OS (i.e. generally: where HTTP Toolkit is running)
 * from inside containers.
 *
 * In Docker for Windows & Mac, host.docker.internal is supported automatically:
 * https://docs.docker.com/docker-for-windows/networking/#use-cases-and-workarounds
 * https://docs.docker.com/docker-for-mac/networking/#use-cases-and-workarounds
 *
 * On Linux this is _not_ supported, so we add it ourselves with (--add-host).
 */
export declare const DOCKER_HOST_HOSTNAME = "host.docker.internal";
/**
 * To make the above hostname work on Linux, where it's not supported by default, we need to map it to the
 * host ip. This method works out the host IP to use to do so.
 */
export declare const getDockerHostIp: (platform: NodeJS.Platform, dockerVersion: {
    apiVersion: string;
} | {
    engineVersion: string;
}, containerMetadata?: Docker.ContainerInspectInfo | undefined) => string;
export declare function isImageAvailable(docker: Docker, name: string): Promise<boolean>;
export declare function isInterceptedContainer(container: Docker.ContainerInspectInfo, port: string | number): boolean;
/**
 * Takes the config for a container, and returns the config to create the
 * same container, but fully intercepted.
 *
 * To hook the creation of any container, we need to get the full config of
 * the container (to make sure we get *all* env vars, for example) and then
 * combine that with the inter
 */
export declare function transformContainerCreationConfig(containerConfig: Docker.ContainerCreateOptions, baseImageConfig: Docker.ImageInspectInfo | undefined, { proxyPort, proxyHost, certPath }: {
    proxyPort: number;
    proxyHost: string;
    certPath: string;
}): Docker.ContainerCreateOptions;
export declare function restartAndInjectContainer(docker: Docker, containerId: string, { proxyPort, certContent, certPath }: {
    proxyPort: number;
    certContent: string;
    certPath: string;
}): Promise<void>;
