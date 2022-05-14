"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopMonitoringDockerNetworkAliases = exports.monitorDockerNetworkAliases = void 0;
const _ = require("lodash");
const Docker = require("dockerode");
const EventStream = require("event-stream");
const mobx = require("mobx");
const error_tracking_1 = require("../../error-tracking");
const docker_commands_1 = require("./docker-commands");
const docker_interception_services_1 = require("./docker-interception-services");
const docker_tunnel_proxy_1 = require("./docker-tunnel-proxy");
const dns_server_1 = require("../../dns-server");
let dockerEventStream;
/**
 * Get a stream of events from Docker. Although Dockerode will only give us the raw event buffers,
 * this creates a stream of parsed object data so we can easily process everything.
 *
 * The resulting stream is created on demand and cached. If there's any issues (errors or close
 * from docker itself) then the cache is dropped, so the next usage will recreate it.
 */
function getDockerEventStream(docker) {
    if (!dockerEventStream) {
        const dockerEventParsingStream = EventStream.pipeline(EventStream.split(), EventStream.mapSync((buffer) => buffer.toString('utf8')), EventStream.filterSync((line) => line.length > 0), EventStream.mapSync((rawLine) => JSON.parse(rawLine)));
        // We expose the stream immediately, even though no data is coming yet
        dockerEventStream = dockerEventParsingStream;
        // This gives us a stream of raw Buffer data. Inside, it contains
        // JSON strings, newline separated, which we parse above.
        docker.getEvents().then((rawEventStream) => {
            rawEventStream.pipe(dockerEventParsingStream);
            rawEventStream.on('error', (e) => {
                dockerEventParsingStream === null || dockerEventParsingStream === void 0 ? void 0 : dockerEventParsingStream.emit('error', e);
            });
            rawEventStream.on('close', () => {
                dockerEventParsingStream === null || dockerEventParsingStream === void 0 ? void 0 : dockerEventParsingStream.end();
                dockerEventStream = undefined;
            });
        }).catch((e) => {
            dockerEventParsingStream === null || dockerEventParsingStream === void 0 ? void 0 : dockerEventParsingStream.emit('error', e);
            dockerEventStream = undefined;
        });
    }
    return dockerEventStream;
}
const dockerNetworkMonitors = {};
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
async function monitorDockerNetworkAliases(proxyPort) {
    if (!await (0, docker_interception_services_1.isDockerAvailable)())
        return undefined;
    if (!dockerNetworkMonitors[proxyPort]) {
        const docker = new Docker();
        const stream = getDockerEventStream(docker);
        stream.on('error', (e) => {
            console.log(`Docker stream for port ${proxyPort} hit an error`);
            (0, error_tracking_1.reportError)(e);
        });
        const dnsServer = await (0, dns_server_1.getDnsServer)(proxyPort);
        const networkMonitor = new DockerNetworkMonitor(docker, proxyPort, stream);
        // We update DNS immediately, and on all changes:
        mobx.autorun(() => dnsServer.setHosts(networkMonitor.aliasIpMap));
        // We update tunnel _only_ once something is actually intercepted - once interceptedNetworks changes.
        // We don't want to create the tunnel container unless Docker interception is actually used.
        mobx.reaction(() => networkMonitor.interceptedNetworks, (interceptedNetworks) => (0, docker_tunnel_proxy_1.updateDockerTunnelledNetworks)(proxyPort, interceptedNetworks)
            .catch(console.warn));
        dockerNetworkMonitors[proxyPort] = networkMonitor;
        // If the stream is dead, this network monitor is no longer working - drop it.
        stream.on('close', async () => {
            if (dockerNetworkMonitors[proxyPort] === networkMonitor) {
                // We remove the registration in this case. If somebody calls this method later,
                // become some intercepted Docker activity has happened, then this will
                // reactivate (any hopefully the Docker stream will be usable again then)
                delete dockerNetworkMonitors[proxyPort];
                // We don't touch the tunnel container - that needs to be shut down separately.
                // Unsubscribe from all events
                networkMonitor.stop();
            }
        });
    }
    return dockerNetworkMonitors[proxyPort];
}
exports.monitorDockerNetworkAliases = monitorDockerNetworkAliases;
function stopMonitoringDockerNetworkAliases(proxyPort) {
    const monitor = dockerNetworkMonitors[proxyPort];
    if (!monitor)
        return;
    delete dockerNetworkMonitors[proxyPort];
    monitor.stop();
}
exports.stopMonitoringDockerNetworkAliases = stopMonitoringDockerNetworkAliases;
function combineSets(...sets) {
    const result = [];
    for (let set of sets) {
        result.push(...set);
    }
    return new Set(result);
}
function combineSetMaps(...setMaps) {
    const keys = _.uniq(_.flatMap(setMaps, (mapping) => Object.keys(mapping)));
    return _.fromPairs(keys.map((key) => [key, combineSets(...setMaps.map((mapping) => mapping[key]).filter(set => !!set))]));
}
/**
 * Network monitors tracks which networks the intercepted containers are connected to, and
 * monitors the network aliases & IPs accessible on those networks.
 */
class DockerNetworkMonitor {
    constructor(docker, proxyPort, dockerEventStream) {
        this.docker = docker;
        this.proxyPort = proxyPort;
        this.dockerEventStream = dockerEventStream;
        this.networkTargets = mobx.observable({});
        this.onEvent = async (event) => {
            if (event.Type !== 'network')
                return;
            if (event.Action === 'destroy') {
                // If the network is deleted, we definitely don't need its aliases anymore.
                const networkId = event.Actor.ID;
                if (networkId in this.networkTargets) {
                    mobx.runInAction(() => {
                        delete this.networkTargets[event.Actor.ID];
                    });
                }
            }
            else if (event.Action === 'connect' || event.Action === 'disconnect') {
                console.log(`Updating Docker aliases for network ${event.Actor.ID}...`);
                // If any containers are attached to the network, or removed from the network
                // then we just update all aliases. Exact changes are a little unpredictable,
                // and this is cheap enough to do every time:
                const networkAliases = await this.getNetworkAliases(event.Actor.ID);
                mobx.runInAction(() => {
                    if (networkAliases) {
                        this.networkTargets[event.Actor.ID] = networkAliases;
                    }
                    else {
                        delete this.networkTargets[event.Actor.ID];
                    }
                });
            }
        };
        // We use mobx here to automatically propagate updates whilst avoiding
        // unnecessary updates when nothing changes.
        mobx.makeObservable(this, {
            'interceptedNetworks': mobx.computed.struct,
            'dockerRoutedAliases': mobx.computed.struct,
            'aliasIpMap': mobx.computed.struct
        });
        dockerEventStream.on('data', this.onEvent);
        this.refreshAllNetworks();
    }
    async stop() {
        this.dockerEventStream.removeListener('data', this.onEvent);
    }
    // The list of networks where interception is currently active:
    get interceptedNetworks() {
        return Object.keys(this.networkTargets);
    }
    // The list of aliases that should be resolvable by intercepted containers:
    get dockerRoutedAliases() {
        return new Set([
            ..._.flatten(Object.values(this.networkTargets)
                .map((networkMap) => Object.keys(networkMap))).filter((host) => 
            // We don't reroute the host hostname - the host is accessible from the host already
            host !== docker_commands_1.DOCKER_HOST_HOSTNAME)
        ]);
    }
    // The list of mappings per-network, binding aliases to their (0+) target IPs
    get aliasIpMap() {
        return combineSetMaps(...Object.values(this.networkTargets), {
            // The Docker hostname always maps to the host's localhost, and it's not automatically included
            // on platforms (Windows & Mac) where Docker resolves it implicitly.
            [docker_commands_1.DOCKER_HOST_HOSTNAME]: new Set(['127.0.0.1'])
        });
    }
    async refreshAllNetworks() {
        console.log('Updating all Docker network aliases...');
        const networks = await this.docker.listNetworks();
        const networkMap = await Promise.all(networks.map(async (network) => {
            const aliases = await this.getNetworkAliases(network.Id);
            return [network.Id, aliases];
        }));
        // We update the network targets in a batch action, to avoid churn in updating
        // the tunnel configuration later.
        mobx.runInAction(() => {
            networkMap.forEach(([networkId, networkAliases]) => {
                if (networkAliases) {
                    this.networkTargets[networkId] = networkAliases;
                }
                else {
                    delete this.networkTargets[networkId];
                }
            });
        });
    }
    isInterceptedContainer(container) {
        // Is this one of the containers we're supposed to be monitoring?
        return (0, docker_commands_1.isInterceptedContainer)(container, this.proxyPort);
    }
    async getNetworkAliases(networkId) {
        var _a, _b;
        const networkDetails = await this.docker.getNetwork(networkId).inspect();
        const isDefaultBridge = ((_a = networkDetails.Options) === null || _a === void 0 ? void 0 : _a['com.docker.network.bridge.default_bridge']) === 'true';
        if (networkDetails.Driver === 'null' || networkDetails.Driver === 'host') {
            // We can't (and shouldn't - it's inaccessible) join and route into the null 'none' network
            // We can't (and don't need to - it's always host-accessible) join and route into the 'host' network
            return undefined;
        }
        const networkContainers = (await Promise.all(Object.values((_b = networkDetails.Containers) !== null && _b !== void 0 ? _b : {}).map((networkContainer) => this.docker.getContainer(networkContainer.Name)
            .inspect()
            .catch(() => undefined) // There's a race condition here - skip any now-missing containers
        ))).filter((container) => !!container);
        if (!networkContainers.find((container) => this.isInterceptedContainer(container))) {
            // If we're not tracking any containers in this network, we don't need its aliases.
            return undefined;
        }
        const aliases = [];
        /*
         * So, what names are resolveable on a network?
         *
         * On a default bridge network: hostnames are self-resolveable,
         * and that's it unless links are used. No aliases are defined by default.
         *
         * On a custom bridge network: hostnames are fully resolveable, as are container
         * ids, plus any custom aliases defined in network config. All defined in Aliases.
         *
         * On a host network: everything resolves as on the host (so we do nothing). Since
         * there's no actual network involved, we never get here anyway.
         *
         * On any network: linked containers can be referenced by their real name, their
         * their link alias name (if different), and their hostname.
         *
         * Overlay etc out of scope for now.
         */
        // Get each containers aliases, and the mapping for each containers custom-mapping
        // targets (links & ExtraHosts config)
        await Promise.all(networkContainers.map(async (container) => {
            var _a;
            const networkConfig = _.find(container.NetworkSettings.Networks, { NetworkID: networkId });
            const containerIp = networkConfig === null || networkConfig === void 0 ? void 0 : networkConfig.IPAddress;
            // If this container somehow isn't connected, we don't care about it - drop it
            if (!networkConfig || !containerIp)
                return;
            // Every container can be accessed by its IP address directly:
            aliases.push([containerIp, containerIp]);
            // Every container can be accessed (at least by itself) by its hostname:
            if (isDefaultBridge) {
                // On the default bridge, that's only true for traffic coming from that same container:
                if (this.isInterceptedContainer(container)) {
                    aliases.push([container.Config.Hostname, containerIp]);
                }
            }
            else {
                // Elsewhere it's true for *all* traffic:
                aliases.push([container.Config.Hostname, containerIp]);
            }
            // Every container can be accessed by any configured aliases on this network:
            aliases.push(...(networkConfig.Aliases || []).map((alias) => [alias, containerIp]));
            if (this.isInterceptedContainer(container)) {
                // Containers may have hosts configured via --add-host=host:ip, which adds them to
                // /etc/hosts. Note that we ignore conflicts here, and just pick the first result,
                // which seems to match how resolution against /etc/hosts works in general.
                aliases.push(..._((_a = container.HostConfig.ExtraHosts) !== null && _a !== void 0 ? _a : [])
                    .reverse() // We want first conflict to win, not last
                    .map((hostPair) => {
                    const hostParts = hostPair.split(':');
                    const alias = hostParts[0];
                    const target = hostParts.slice(1).join(':');
                    const targetIp = target === 'host-gateway'
                        ? '127.0.0.1'
                        : target;
                    return [alias, targetIp];
                })
                    // Drop all but the first result for each ExtraHosts alias:
                    .uniqBy(([alias]) => alias)
                    .valueOf());
                // Containers also may have links configured (legacy, but still supported & used I think):
                const linkStrings = container.HostConfig.Links || [];
                const linkAliases = await Promise.all(linkStrings.map(async (link) => {
                    var _a, _b;
                    // Aliases are of the form:
                    // /compose_default-service-a_1:/compose_linked-service-b_1/a
                    // I.e. service-a is linked by service-b with alias 'a'.
                    const endOfContainerName = link.indexOf(':/');
                    const aliasIndex = link.lastIndexOf('/');
                    const linkedContainerName = link.slice(1, endOfContainerName);
                    const linkAlias = link.slice(aliasIndex + 1); // +1 to drop leading slash
                    const linkedContainer = (_a = networkContainers.find(c => c.Name === linkedContainerName)) !== null && _a !== void 0 ? _a : await this.docker.getContainer(linkedContainerName)
                        .inspect()
                        .catch(() => undefined); // There's a race condition here - skip any now missing containers
                    if (!linkedContainer)
                        return [];
                    const linkedContainerIp = ((_b = linkedContainer.NetworkSettings.Networks[networkId]) === null || _b === void 0 ? void 0 : _b.IPAddress) ||
                        linkedContainer.NetworkSettings.IPAddress;
                    return [
                        [linkAlias, linkedContainerIp],
                        [linkedContainer.Name, linkedContainerIp],
                        [linkedContainer.Config.Hostname, linkedContainerIp]
                    ];
                }));
                aliases.push(..._.flatten(linkAliases));
            }
        }));
        return aliases.reduce((aliasMap, [alias, target]) => {
            if (!aliasMap[alias])
                aliasMap[alias] = new Set();
            aliasMap[alias].add(target);
            return aliasMap;
        }, {});
    }
}
//# sourceMappingURL=docker-networking.js.map