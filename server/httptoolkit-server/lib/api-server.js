"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpToolkitServerApi = void 0;
const _ = require("lodash");
const os = require("os");
const events = require("events");
const express = require("express");
const cors = require("cors");
const corsGate = require("cors-gate");
const schema_1 = require("@graphql-tools/schema");
const graphql_1 = require("graphql");
const express_graphql_1 = require("express-graphql");
const mockttp_1 = require("mockttp");
const os_proxy_config_1 = require("os-proxy-config");
const error_tracking_1 = require("./error-tracking");
const interceptors_1 = require("./interceptors");
const constants_1 = require("./constants");
const promise_1 = require("./util/promise");
const dns_server_1 = require("./dns-server");
const shutdown_1 = require("./shutdown");
const ENABLE_PLAYGROUND = false;
const packageJson = require('../package.json');
/**
 * This file contains the core server API, used by the UI to query
 * machine state that isn't easily visible from the web (cert files,
 * network interfaces), and to launch intercepted applications
 * directly on this machine.
 *
 * This is a very powerful API! It's not far from remote code
 * execution. Because of that, access is tightly controlled:
 * - Only listens on 127.0.0.1
 * - All requests must include an acceptable Origin header, i.e.
 *   no browsers requests except from a strict whitelist of valid
 *   origins. In prod, that's just app.httptoolkit.tech.
 * - Optionally (always set in the HTK app) requires an auth
 *   token with every request, provided by $HTK_SERVER_TOKEN or
 *   --token at startup.
 */
const typeDefs = `
    type Query {
        version: String!
        config: InterceptionConfig!
        interceptors: [Interceptor!]!
        interceptor(id: ID!): Interceptor!
        networkInterfaces: Json
        systemProxy: Proxy
        dnsServers(proxyPort: Int!): [String!]!
        ruleParameterKeys: [String!]!
    }

    type Mutation {
        activateInterceptor(
            id: ID!,
            proxyPort: Int!,
            options: Json
        ): Json
        deactivateInterceptor(
            id: ID!,
            proxyPort: Int!
        ): Boolean!
        triggerUpdate: Void
        shutdown: Void
    }

    type InterceptionConfig {
        certificatePath: String!
        certificateContent: String!
        certificateFingerprint: String!
    }

    type Interceptor {
        id: ID!
        version: String!
        metadata(type: MetadataType): Json

        isActivable: Boolean!
        isActive(proxyPort: Int!): Boolean!
    }

    type Proxy {
        proxyUrl: String!
        noProxy: [String!]
    }

    enum MetadataType {
        SUMMARY,
        DETAILED
    }

    scalar Json
    scalar Error
    scalar Void
`;
// Wait for a promise, falling back to defaultValue on error or timeout
const withFallback = (p, timeoutMs, defaultValue) => Promise.race([
    p.catch((error) => {
        (0, error_tracking_1.reportError)(error);
        return defaultValue;
    }),
    (0, promise_1.delay)(timeoutMs).then(() => defaultValue)
]);
const isActivationError = (value) => _.isError(value);
const INTERCEPTOR_TIMEOUT = 1000;
const buildResolvers = (config, interceptors, mockttpStandalone, eventEmitter) => {
    return {
        Query: {
            version: () => packageJson.version,
            interceptors: () => _.values(interceptors),
            interceptor: (_, { id }) => interceptors[id],
            config: () => ({
                certificatePath: config.https.certPath,
                certificateContent: config.https.certContent,
                // We could calculate this client side, but it normally requires node-forge or
                // some other heavyweight crypto lib, and we already have that here, so it's
                // convenient to do it up front.
                certificateFingerprint: (0, mockttp_1.generateSPKIFingerprint)(config.https.certContent)
            }),
            networkInterfaces: () => os.networkInterfaces(),
            systemProxy: () => (0, os_proxy_config_1.getSystemProxy)().catch((e) => {
                (0, error_tracking_1.reportError)(e);
                return undefined;
            }),
            dnsServers: async (__, { proxyPort }) => {
                const dnsServer = await (0, dns_server_1.getDnsServer)(proxyPort);
                return [`127.0.0.1:${dnsServer.address().port}`];
            },
            ruleParameterKeys: async () => {
                return mockttpStandalone.ruleParameterKeys;
            }
        },
        Mutation: {
            activateInterceptor: async (__, { id, proxyPort, options }) => {
                (0, error_tracking_1.addBreadcrumb)(`Activating ${id}`, { category: 'interceptor', data: { id, options } });
                const interceptor = interceptors[id];
                if (!interceptor)
                    throw new Error(`Unknown interceptor ${id}`);
                // After 30s, don't stop activating, but report an error if we're not done yet
                let activationDone = false;
                (0, promise_1.delay)(30000).then(() => {
                    if (!activationDone)
                        (0, error_tracking_1.reportError)(`Timeout activating ${id}`);
                });
                const result = await interceptor.activate(proxyPort, options).catch((e) => e);
                activationDone = true;
                if (isActivationError(result)) {
                    if (result.reportable !== false)
                        (0, error_tracking_1.reportError)(result);
                    return { success: false, metadata: result.metadata };
                }
                else {
                    (0, error_tracking_1.addBreadcrumb)(`Successfully activated ${id}`, { category: 'interceptor' });
                    return { success: true, metadata: result };
                }
            },
            deactivateInterceptor: async (__, { id, proxyPort, options }) => {
                const interceptor = interceptors[id];
                if (!interceptor)
                    throw new Error(`Unknown interceptor ${id}`);
                await interceptor.deactivate(proxyPort, options).catch(error_tracking_1.reportError);
                return { success: !interceptor.isActive(proxyPort) };
            },
            triggerUpdate: () => {
                eventEmitter.emit('update-requested');
            },
            // On Windows, there's no clean way to send signals between processes to trigger graceful
            // shutdown. To handle that, we use HTTP from the desktop shell, instead of inter-process
            // signals. This completely shuts down the server, not just a single proxy endpoint, and
            // should only be called once the app is fully exiting.
            shutdown: () => {
                (0, shutdown_1.shutdown)('API call');
            }
        },
        Interceptor: {
            isActivable: (interceptor) => {
                return withFallback(interceptor.isActivable(), interceptor.activableTimeout || INTERCEPTOR_TIMEOUT, false);
            },
            isActive: async (interceptor, { proxyPort }) => {
                try {
                    return await interceptor.isActive(proxyPort);
                }
                catch (e) {
                    (0, error_tracking_1.reportError)(e);
                    return false;
                }
            },
            metadata: async function (interceptor, { type }) {
                if (!interceptor.getMetadata)
                    return undefined;
                const metadataType = type
                    ? type.toLowerCase()
                    : 'summary';
                const timeout = metadataType === 'summary'
                    ? INTERCEPTOR_TIMEOUT
                    : INTERCEPTOR_TIMEOUT * 10; // Longer timeout for detailed metadata
                try {
                    return await withFallback(interceptor.getMetadata(metadataType), timeout, undefined);
                }
                catch (e) {
                    (0, error_tracking_1.reportError)(e);
                    return undefined;
                }
            }
        },
        Json: new graphql_1.GraphQLScalarType({
            name: 'Json',
            description: 'A JSON entity, serialized as a raw object',
            serialize: (value) => value,
            parseValue: (input) => input,
            parseLiteral: () => { throw new Error('JSON literals are not supported'); }
        }),
        Void: new graphql_1.GraphQLScalarType({
            name: 'Void',
            description: 'Nothing at all',
            serialize: (value) => null,
            parseValue: (input) => null,
            parseLiteral: () => { throw new Error('Void literals are not supported'); }
        }),
        Error: new graphql_1.GraphQLScalarType({
            name: 'Error',
            description: 'An error',
            serialize: (value) => JSON.stringify({
                name: value.name,
                message: value.message,
                stack: value.stack
            }),
            parseValue: (input) => {
                let data = JSON.parse(input);
                let error = new Error();
                error.name = data.name;
                error.message = data.message;
                error.stack = data.stack;
                throw error;
            },
            parseLiteral: () => { throw new Error('Error literals are not supported'); }
        }),
    };
};
class HttpToolkitServerApi extends events.EventEmitter {
    constructor(config, mockttpStandalone) {
        super();
        let interceptors = (0, interceptors_1.buildInterceptors)(config);
        const schema = (0, schema_1.makeExecutableSchema)({
            typeDefs,
            resolvers: buildResolvers(config, interceptors, mockttpStandalone, this)
        });
        this.server = express();
        this.server.disable('x-powered-by');
        this.server.use(cors({
            origin: constants_1.ALLOWED_ORIGINS,
            maxAge: 86400 // Cache this result for as long as possible
        }));
        var serverUrl = 'http://' + process.env.APP_SERVER_LOCALHOST;
        this.server.use(corsGate(ENABLE_PLAYGROUND
            // When the debugging playground is enabled, we're slightly more lax
            ? {
                strict: true,
                allowSafe: true,
                origin: serverUrl
            }
            : {
                strict: true,
                allowSafe: false,
                origin: '' // No origin - we accept *no* same-origin requests
            }));
        this.server.use((req, res, next) => {
            if (req.method !== 'POST' && !ENABLE_PLAYGROUND) {
                // We allow only POST, because that's all we expect for GraphQL queries,
                // and this helps derisk some (admittedly unlikely) XSRF possibilities.
                res.status(405).send('Only POST requests are supported');
            }
            else {
                next();
            }
        });
        if (config.authToken) {
            // Optional auth token. This allows us to lock down UI/server communication further
            // when started together. The desktop generates a token every run and passes it to both.
            this.server.use((req, res, next) => {
                const authHeader = req.headers['authorization'] || '';
                const tokenMatch = authHeader.match(/Bearer (\S+)/) || [];
                const token = tokenMatch[1];
                if (token !== config.authToken) {
                    res.status(403).send('Valid token required');
                }
                else {
                    next();
                }
            });
        }
        this.server.use((0, express_graphql_1.graphqlHTTP)({
            schema,
            graphiql: ENABLE_PLAYGROUND
        }));
    }
    start() {
        return new Promise((resolve, reject) => {
            this.server.listen(process.env.APP_SERVER_PORT, process.env.APP_HOST, resolve); // Localhost only
            this.server.once('error', reject);
        });
    }
}
exports.HttpToolkitServerApi = HttpToolkitServerApi;
;
//# sourceMappingURL=api-server.js.map