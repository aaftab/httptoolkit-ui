"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopDnsServer = exports.getDnsServer = void 0;
const dns2 = require("dns2");
const DNS_SERVER_MAP = {};
function getDnsServer(mockServerPort) {
    if (!DNS_SERVER_MAP[mockServerPort]) {
        const serverPromise = (async () => {
            const server = new DnsServer();
            server.on('close', () => {
                delete DNS_SERVER_MAP[mockServerPort];
            });
            await server.start();
            return server;
        })();
        DNS_SERVER_MAP[mockServerPort] = serverPromise;
    }
    return DNS_SERVER_MAP[mockServerPort];
}
exports.getDnsServer = getDnsServer;
async function stopDnsServer(mockServerPort) {
    const dnsServer = await DNS_SERVER_MAP[mockServerPort];
    if (!dnsServer)
        return;
    delete DNS_SERVER_MAP[mockServerPort];
    dnsServer.stop();
}
exports.stopDnsServer = stopDnsServer;
const EMPTY_SET = new Set();
class DnsServer extends dns2.UDPServer {
    constructor() {
        super((req, sendResponse) => this.handleQuery(req, sendResponse));
        this.hosts = {};
    }
    setHosts(hosts) {
        this.hosts = hosts;
    }
    getHostAddresses(hostname) {
        var _a;
        return (_a = this.hosts[hostname]) !== null && _a !== void 0 ? _a : EMPTY_SET;
    }
    handleQuery(request, sendResponse) {
        const response = dns2.Packet.createResponseFromRequest(request);
        // Multiple questions are allowed in theory, but apparently nobody
        // supports it, so we don't either.
        const [question] = request.questions;
        const answers = this.getHostAddresses(question.name);
        if (answers.size > 1) {
            console.log(`Multiple hosts in internal DNS for hostname ${question.name}:`, answers);
        }
        if (answers) {
            answers.forEach((answer) => {
                response.answers.push({
                    name: question.name,
                    type: dns2.Packet.TYPE.A,
                    class: dns2.Packet.CLASS.IN,
                    ttl: 0,
                    address: answer
                });
            });
        }
        sendResponse(response);
    }
    start() {
        return new Promise((resolve, reject) => {
            // Only listens on localhost, only used by Mockttp itself.
            this.listen(0, '127.0.0.1');
            this.once('listening', () => resolve());
            this.once('error', reject);
        });
    }
    stop() {
        return new Promise((resolve) => {
            this.once('close', resolve);
            this.close();
        });
    }
}
//# sourceMappingURL=dns-server.js.map