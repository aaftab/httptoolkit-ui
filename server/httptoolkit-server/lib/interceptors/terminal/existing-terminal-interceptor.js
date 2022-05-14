"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExistingTerminalInterceptor = void 0;
const mockttp_1 = require("mockttp");
const terminal_env_overrides_1 = require("./terminal-env-overrides");
const terminal_scripts_1 = require("./terminal-scripts");
class ExistingTerminalInterceptor {
    constructor(config) {
        this.config = config;
        this.servers = {};
        this.id = 'existing-terminal';
        this.version = '1.0.0';
    }
    isActivable() {
        // Not supported on Windows, for now. Doesn't work in cmd or powershell of course (needs bash),
        // and doesn't work in git bash/WSL due to path transforms. Fixable, I think, but not easily.
        return Promise.resolve(process.platform !== 'win32');
    }
    isActive(proxyPort) {
        const serverState = this.servers[proxyPort];
        return !!serverState && serverState.isActive;
    }
    async activate(proxyPort) {
        if (this.servers[proxyPort]) {
            // Reset isActive, so we wait again for a new request
            this.servers[proxyPort].isActive = false;
            return { port: this.servers[proxyPort].server.port };
        }
        const server = (0, mockttp_1.getLocal)();
        await server.start({ startPort: proxyPort + 1, endPort: 65535 });
        const envVars = (0, terminal_env_overrides_1.getTerminalEnvVars)(proxyPort, this.config.https, 'runtime-inherit', {});
        const setupScript = (0, terminal_scripts_1.getShellScript)(server.urlFor('/success'), envVars);
        const serverState = { server, isActive: false };
        await server.get('/setup').thenCallback(() => {
            return {
                status: 200,
                headers: { "content-type": "text/x-shellscript" },
                body: setupScript
            };
        });
        await server.post('/success').thenCallback(() => {
            serverState.isActive = true;
            return { status: 200 };
        });
        this.servers[proxyPort] = serverState;
        return { port: server.port };
    }
    async deactivate(proxyPort) {
        if (this.servers[proxyPort]) {
            await this.servers[proxyPort].server.stop();
            delete this.servers[proxyPort];
        }
    }
    deactivateAll() {
        return Promise.all(Object.keys(this.servers).map((port) => this.deactivate(parseInt(port, 10)))).then(() => { });
    }
}
exports.ExistingTerminalInterceptor = ExistingTerminalInterceptor;
//# sourceMappingURL=existing-terminal-interceptor.js.map