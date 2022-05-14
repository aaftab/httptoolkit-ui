import * as _ from 'lodash';
import * as Docker from 'dockerode';
import { Interceptor } from "..";
import { HtkConfig } from '../../config';
export declare class DockerContainerInterceptor implements Interceptor {
    private config;
    id: string;
    version: string;
    constructor(config: HtkConfig);
    private _docker;
    private getDocker;
    isActivable(): Promise<boolean>;
    private _containersPromise;
    getContainers(): Promise<Docker.ContainerInfo[]>;
    getMetadata(): Promise<{
        targets: _.Dictionary<{
            id: string;
            names: string[];
            command: string;
            labels: {
                [label: string]: string;
            };
            state: string;
            status: string;
            image: string;
            ips: string[];
        }>;
    } | undefined>;
    activate(proxyPort: number, options: {
        containerId: string;
    }): Promise<void | {}>;
    isActive(proxyPort: number): Promise<boolean>;
    deactivate(proxyPort: number): Promise<void | {}>;
    deactivateAll(): Promise<void | {}>;
}
