/// <reference types="node" />
import { EventEmitter } from "events";
import { Server } from "net";
export interface Config {
    sshAuthSockAddress: string;
    authApiEndpoint: string;
    authApiPath: string;
}
export interface RequestIdentity {
    apiKey: string;
    deviceUuid: string;
}
export declare class BalenaSshAgent extends EventEmitter {
    config: Config;
    socket: Server;
    constructor(config?: Config);
    close(): void;
    private prepareUnixSocket;
    private readString;
    private replyToClient;
    private handleAgentRequest;
    private getKeysForClient;
    private provideKeysToClient;
    private signRequestWithApi;
}
