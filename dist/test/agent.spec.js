"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var index_1 = require("../src/index");
require("mocha");
describe("Basic agent operation", function () {
    var agent;
    after(function () {
        agent.close();
    });
    it("should instantiate and announce it is ready", function (done) {
        agent = new index_1.BalenaSshAgent();
        agent.on(index_1.BalenaSshAgent.EVENT_READY, function () {
            done();
        });
    });
    it("should instantiate and announce it is listening", function (done) {
        agent.on(index_1.BalenaSshAgent.EVENT_LISTENING, function () {
            done();
        });
        agent.listen();
    });
});
