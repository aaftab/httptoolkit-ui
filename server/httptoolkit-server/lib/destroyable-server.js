"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.destroyable = void 0;
// Mostly from https://github.com/isaacs/server-destroy (which seems to be unmaintained)
function destroyable(server) {
    const connections = {};
    server.on('connection', function (conn) {
        const key = conn.remoteAddress + ':' + conn.remotePort;
        connections[key] = conn;
        conn.on('close', function () {
            delete connections[key];
        });
    });
    return Object.assign(server, {
        destroy: () => {
            return new Promise((resolve, reject) => {
                server.close((err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
                for (let key in connections) {
                    connections[key].destroy();
                }
            });
        }
    });
}
exports.destroyable = destroyable;
//# sourceMappingURL=destroyable-server.js.map