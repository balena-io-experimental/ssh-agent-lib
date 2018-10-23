/// <reference types="node" />
import { EventEmitter } from "events";
import { Server } from "net";
export interface Config {
    sshAuthSockAddress?: string;
    authApiEndpoint?: string;
    authApiPath?: string;
}
export interface RequestIdentity {
    apiKey: string;
    deviceUuid: string;
}
export declare class BalenaSshAgent extends EventEmitter {
    static readonly EVENT_READY = "ready";
    static readonly EVENT_LISTENING = "listening";
    static readonly EVENT_IDENTITY = "identity";
    config: Config;
    socket: Server;
    readyToListen: boolean;
    constructor(config?: Config);
    listen(): void;
    close(): void;
    private prepareUnixSocket;
    private readString;
    private replyToClient;
    private handleAgentRequest;
    private getKeysForClient;
    private provideKeysToClient;
    private signRequestWithApi;
}
