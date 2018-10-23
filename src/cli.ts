#!/usr/bin/env node

import * as process from "process";
import { BalenaSshAgent } from "./index";

const agent = new BalenaSshAgent({
  authApiEndpoint: process.env.RESINRC_RESIN_API || "https://api.resin.io/"
});

agent.on(BalenaSshAgent.EVENT_READY, () => {
  agent.listen();
});

agent.on(BalenaSshAgent.EVENT_LISTENING, () => {
  console.log(`Listening on UNIX socket: ${agent.config.sshAuthSockAddress}`);
  console.log(`Using API: ${agent.config.authApiEndpoint}`);
});

agent.on(
  BalenaSshAgent.EVENT_IDENTITY,
  (_id, cb: (apiKey: string, deviceUuid: string) => void) => {
    console.log("== Providing details...");
    cb("AgZf6yQWUpvAN5ZamE3obTL0mdqW1ETq", "97449521a1117713b9d81f51bd037c98");
  }
);
