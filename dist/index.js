"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    }
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
var _ = __importStar(require("lodash"));
var fs = __importStar(require("fs"));
var request = __importStar(require("request-promise"));
var Bluebird = __importStar(require("bluebird"));
var events_1 = require("events");
var net_1 = require("net");
var AgentMessageType;
(function (AgentMessageType) {
    AgentMessageType[AgentMessageType["SSH_AGENTC_REQUEST_IDENTITIES"] = 11] = "SSH_AGENTC_REQUEST_IDENTITIES";
    AgentMessageType[AgentMessageType["SSH_AGENTC_SIGN_REQUEST"] = 13] = "SSH_AGENTC_SIGN_REQUEST";
    AgentMessageType[AgentMessageType["SSH_AGENT_IDENTITIES_ANSWER"] = 12] = "SSH_AGENT_IDENTITIES_ANSWER";
    AgentMessageType[AgentMessageType["SSH_AGENT_SIGN_RESPONSE"] = 14] = "SSH_AGENT_SIGN_RESPONSE";
})(AgentMessageType || (AgentMessageType = {}));
var BalenaSshAgent = /** @class */ (function (_super) {
    __extends(BalenaSshAgent, _super);
    function BalenaSshAgent(config) {
        var _this = _super.call(this) || this;
        _this.config = {
            sshAuthSockAddress: "/tmp/io.balena.ssh_Listeners",
            authApiEndpoint: "https://api.resindev.io",
            authApiPath: "/auth/v1/ssh/"
        };
        _this.socket = new net_1.Server();
        _.extend(_this.config, config);
        _this.prepareUnixSocket(function () {
            _this.socket = net_1.createServer(_this.handleAgentRequest);
            _this.socket.listen(_this.config.sshAuthSockAddress);
        });
        return _this;
    }
    BalenaSshAgent.prototype.close = function () {
        this.socket.close();
    };
    BalenaSshAgent.prototype.prepareUnixSocket = function (doStartFn) {
        var unixSocket = this.config.sshAuthSockAddress;
        fs.stat(unixSocket, function (err) {
            if (err) {
                // start server
                doStartFn();
                return;
            }
            // remove file then start server
            fs.unlink(unixSocket, function (err) {
                if (err) {
                    // This should never happen.
                    process.exit(0);
                }
                doStartFn();
                return;
            });
        });
    };
    BalenaSshAgent.prototype.readString = function (buffer, offset) {
        return new Bluebird.Promise(function (resolve, reject) {
            var len = buffer.readUInt32BE(offset);
            var str = Buffer.alloc(len);
            buffer.copy(str, 0, offset + 4, offset + 4 + len);
            resolve({ value: str, offset: offset + 4 + len });
        });
    };
    BalenaSshAgent.prototype.replyToClient = function (client, message, content) {
        var len = content.length + 1;
        var buf = Buffer.alloc(4 + len);
        buf.writeInt32BE(len, 0);
        buf.writeUInt8(message, 4);
        for (var pos = 0; pos < content.length; pos++) {
            buf.writeUInt8(content[pos], 5 + pos);
        }
        client.write(buf);
    };
    BalenaSshAgent.prototype.handleAgentRequest = function (client) {
        var _this = this;
        client.on("data", function (d) {
            var messageLength = d.readUInt32BE(0);
            var messageNumber = d.readUInt8(4);
            switch (messageNumber) {
                case AgentMessageType.SSH_AGENTC_REQUEST_IDENTITIES: // request identities...
                    _this.getKeysForClient().then(function (keys) {
                        return _this.provideKeysToClient(keys, client);
                    });
                    break;
                case AgentMessageType.SSH_AGENTC_SIGN_REQUEST:
                    var publicKey_1 = "";
                    var data_1;
                    var pos_1 = 5;
                    _this.readString(d, pos_1)
                        .then(function (_a) {
                        var value = _a.value, offset = _a.offset;
                        publicKey_1 = value.toString("utf8");
                        pos_1 = offset;
                        return _this.readString(d, offset);
                    })
                        .then(function (_a) {
                        var value = _a.value, offset = _a.offset;
                        data_1 = Buffer.alloc(value.length, value);
                        pos_1 = offset;
                        return _this.readString(d, offset);
                    })
                        .then(function () {
                        var flags = d.readUInt32BE(pos_1);
                        return _this.signRequestWithApi(publicKey_1, data_1, flags);
                    })
                        .then(function (signature) {
                        _this.replyToClient(client, AgentMessageType.SSH_AGENT_SIGN_RESPONSE, signature);
                    });
                    break;
            }
        });
    };
    BalenaSshAgent.prototype.getKeysForClient = function () {
        var _this = this;
        return new Bluebird.Promise(function (resolve, reject) {
            var result = _this.emit("identity", {}, function (apiKey, deviceUuid) {
                resolve({
                    apiKey: apiKey,
                    deviceUuid: deviceUuid
                });
            });
            if (!result) {
                reject();
            }
        })
            .then(function (_a) {
            var apiKey = _a.apiKey, deviceUuid = _a.deviceUuid;
            return request
                .get("" + _this.config.authApiEndpoint + _this.config.authApiPath + deviceUuid, { json: true, auth: { bearer: apiKey } })
                .then(function (body) {
                var keys = [];
                body.keys.forEach(function (key) {
                    keys.push(Buffer.from(key, "base64"));
                });
                return keys;
            });
        })
            .catch(function () {
            return new Array(0);
        });
    };
    BalenaSshAgent.prototype.provideKeysToClient = function (keys, client) {
        var keyCount = keys.length;
        var keysLength = 0;
        keys.forEach(function (key) {
            keysLength += key.length;
        });
        var message = Buffer.alloc(4 + keysLength + keysLength * 4 + keysLength * 4);
        message.writeUInt32BE(keyCount, 0);
        var keyOffset = 4;
        keys.forEach(function (key) {
            // key blob...
            message.writeUInt32BE(key.length, keyOffset);
            for (var pos = 0; pos < key.length; pos++) {
                message.writeUInt8(key[pos], keyOffset + 4 + pos);
            }
            keyOffset += key.length + 4;
            // key comment...
            message.writeUInt32BE(0, keyOffset);
            keyOffset += 4;
        });
        this.replyToClient(client, AgentMessageType.SSH_AGENT_IDENTITIES_ANSWER, message);
    };
    BalenaSshAgent.prototype.signRequestWithApi = function (publicKey, data, flags) {
        var _this = this;
        return new Bluebird.Promise(function (resolve, reject) {
            var result = _this.emit("identity", {}, function (apiKey, deviceUuid) {
                resolve({
                    apiKey: apiKey,
                    deviceUuid: deviceUuid
                });
            });
            if (!result) {
                reject();
            }
        }).then(function (_a) {
            var apiKey = _a.apiKey, deviceUuid = _a.deviceUuid;
            return request
                .post("" + _this.config.authApiEndpoint + _this.config.authApiPath + deviceUuid, {
                json: {
                    data: data.toString("base64"),
                    publicKey: publicKey,
                    flags: flags
                },
                auth: {
                    bearer: apiKey
                }
            })
                .then(function (body) {
                var signature = Buffer.from(body.signature, "base64");
                var response = Buffer.alloc(4 + signature.length);
                response.writeUInt32BE(signature.length, 0);
                signature.copy(response, 4);
                return response;
            });
        });
    };
    return BalenaSshAgent;
}(events_1.EventEmitter));
exports.BalenaSshAgent = BalenaSshAgent;
