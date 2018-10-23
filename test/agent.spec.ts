import { BalenaSshAgent } from "../src/index";
import "mocha";
import { expect } from "chai";

describe("Basic agent operation", () => {
  let agent: BalenaSshAgent;

  after(() => {
    agent.close();
  });

  it("should instantiate and announce it is ready", done => {
    agent = new BalenaSshAgent();
    agent.on(BalenaSshAgent.EVENT_READY, () => {
      done();
    });
  });

  it("should instantiate and announce it is listening", done => {
    agent.on(BalenaSshAgent.EVENT_LISTENING, () => {
      done();
    });
    agent.listen();
  });

  
});
