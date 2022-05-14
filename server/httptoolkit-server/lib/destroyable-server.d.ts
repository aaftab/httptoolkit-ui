/// <reference types="node" />
import * as net from "net";
export interface DestroyableServer extends net.Server {
    destroy(): Promise<void>;
}
export declare function destroyable(server: net.Server): DestroyableServer;
