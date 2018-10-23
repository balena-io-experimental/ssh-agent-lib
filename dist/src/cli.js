#!/usr/bin/env node
"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
var process = __importStar(require("process"));
var index_1 = require("./index");
var agent = new index_1.BalenaSshAgent({
    authApiEndpoint: process.env.RESINRC_RESIN_API || "https://api.resin.io/"
});
agent.on(index_1.BalenaSshAgent.EVENT_READY, function () {
    agent.listen();
});
agent.on(index_1.BalenaSshAgent.EVENT_LISTENING, function () {
    console.log("Listening on UNIX socket: " + agent.config.sshAuthSockAddress);
    console.log("Using API: " + agent.config.authApiEndpoint);
});
agent.on(index_1.BalenaSshAgent.EVENT_IDENTITY, function (_id, cb) {
    console.log("== Providing details...");
    cb("AgZf6yQWUpvAN5ZamE3obTL0mdqW1ETq", "97449521a1117713b9d81f51bd037c98");
});
