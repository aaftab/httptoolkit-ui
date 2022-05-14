import * as dns2 from 'dns2';
export declare function getDnsServer(mockServerPort: number): Promise<DnsServer>;
export declare function stopDnsServer(mockServerPort: number): Promise<void>;
declare class DnsServer extends dns2.UDPServer {
    constructor();
    private hosts;
    setHosts(hosts: {
        [hostname: string]: ReadonlySet<string>;
    }): void;
    private getHostAddresses;
    handleQuery(request: dns2.DnsRequest, sendResponse: (response: dns2.DnsResponse) => void): void;
    start(): Promise<void>;
    stop(): Promise<void>;
}
export {};
