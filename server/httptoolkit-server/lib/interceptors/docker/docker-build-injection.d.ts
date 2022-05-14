/// <reference types="node" />
import * as stream from 'stream';
import * as EventStream from 'event-stream';
import * as tarStream from 'tar-stream';
export declare const DOCKER_BUILD_LABEL = "tech.httptoolkit.docker.build-proxy";
/**
 * Take a build context stream, and transform it to inject into the build itself via
 * the Dockerfile. Supports gzipped & raw tarballs.
 */
export declare function injectIntoBuildStream(dockerfileName: string, buildStream: stream.Readable, config: {
    proxyPort: number;
    certContent: string;
}): {
    injectedStream: tarStream.Pack;
    totalCommandsAddedPromise: Promise<number>;
};
export declare function injectIntoDockerfile(dockerfileContents: string, config: {
    proxyPort: number;
    envVars: {
        [key: string]: string;
    };
}): {
    dockerfile: string;
    commandsAdded: number;
};
/**
 * Takes a response stream of a Docker build (i.e. build output) and transforms it to simplify all the
 * HTTP Toolkit interception noise down to a single clear line, and normalize the step count text
 * to match.
 */
export declare function getBuildOutputPipeline(extraDockerCommandCount: number): EventStream.MapStream;
