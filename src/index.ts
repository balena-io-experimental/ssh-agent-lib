import * as _ from "lodash";
import * as fs from "fs";
import * as request from "request-promise";
import * as Bluebird from "bluebird";
import { EventEmitter } from "events";
import { createServer, Server, Socket } from "net";
import * as winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json()
});

//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
//
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple()
    })
  );
}

enum AgentMessageType {
  SSH_AGENTC_REQUEST_IDENTITIES = 11,
  SSH_AGENTC_SIGN_REQUEST = 13,
  SSH_AGENT_IDENTITIES_ANSWER = 12,
  SSH_AGENT_SIGN_RESPONSE = 14
}

export interface Config {
  sshAuthSockAddress?: string;
  authApiEndpoint?: string;
  authApiPath?: string;
}

export interface RequestIdentity {
  apiKey: string;
  deviceUuid: string;
}

export class BalenaSshAgent extends EventEmitter {
  static readonly EVENT_READY = "ready";
  static readonly EVENT_LISTENING = "listening";
  static readonly EVENT_IDENTITY = "identity";

  config: Config = {
    sshAuthSockAddress: "/tmp/io.balena.ssh_Listeners",
    authApiEndpoint: "https://api.resin.io",
    authApiPath: "/auth/v1/ssh/"
  };

  socket: Server = new Server();
  readyToListen: boolean = false;

  constructor(config?: Config) {
    super();
    _.extend(this.config, config);

    this.prepareUnixSocket(() => {
      this.readyToListen = true;
      this.emit(BalenaSshAgent.EVENT_READY, this);
    });
  }

  public listen() {
    if (!this.readyToListen) {
      throw new Error("Unable to listen at this time.");
    }

    this.socket = createServer(this.handleAgentRequest);
    this.socket.listen(this.config.sshAuthSockAddress);
    this.emit(BalenaSshAgent.EVENT_LISTENING, this);
  }

  public close() {
    this.socket.close();
  }

  private prepareUnixSocket(doStartFn: () => void) {
    const unixSocket = this.config.sshAuthSockAddress || "";
    fs.stat(unixSocket, function(err) {
      if (err) {
        // start server
        doStartFn();
        return;
      }
      // remove file then start server
      fs.unlink(unixSocket, function(err) {
        if (err) {
          // This should never happen.
          process.exit(0);
        }
        doStartFn();
        return;
      });
    });
  }

  private readString(buffer: Buffer, offset: number) {
    return new Bluebird.Promise<{
      value: Buffer;
      offset: number;
    }>((resolve, reject) => {
      const len = buffer.readUInt32BE(offset);
      const str = Buffer.alloc(len);

      buffer.copy(str, 0, offset + 4, offset + 4 + len);
      resolve({ value: str, offset: offset + 4 + len });
    });
  }

  private replyToClient(
    client: Socket,
    message: AgentMessageType,
    content: Buffer
  ) {
    return new Bluebird.Promise(resolve => {
      const len = content.length + 1;
      let buf = Buffer.alloc(4 + len);
      buf.writeInt32BE(len, 0);
      buf.writeUInt8(message, 4);

      for (let pos = 0; pos < content.length; pos++) {
        buf.writeUInt8(content[pos], 5 + pos);
      }

      client.write(buf, () => {
        logger.log({
          level: "info",
          message: "->",
          info: buf.toString("hex").replace(/(.{2})/g, "$1 ")
        });
        resolve();
      });
    });
  }

  private handleAgentRequest = (client: Socket) => {
    // const self = this;
    client.on("data", d => {
      const messageLength = d.readUInt32BE(0);
      const messageNumber = d.readUInt8(4);

      switch (messageNumber) {
        case AgentMessageType.SSH_AGENTC_REQUEST_IDENTITIES: // request identities...
          this.getKeysForClient().then(keys => {
            console.log(`== Keys: ${keys.length}`);
            return this.provideKeysToClient(keys, client);
          });
          break;
        case AgentMessageType.SSH_AGENTC_SIGN_REQUEST:
          let publicKey = "";
          let data: Buffer;
          let pos = 5;
          this.readString(d, pos)
            .then(({ value, offset }) => {
              publicKey = value.toString("utf8");
              pos = offset;
              return this.readString(d, offset);
            })
            .then(({ value, offset }) => {
              data = Buffer.alloc(value.length, value);
              pos = offset;
              return this.readString(d, offset);
            })
            .then(() => {
              const flags = d.readUInt32BE(pos);

              return this.signRequestWithApi(publicKey, data, flags);
            })
            .then(signature => {
              return this.replyToClient(
                client,
                AgentMessageType.SSH_AGENT_SIGN_RESPONSE,
                signature
              );
            });
          break;
      }
    });
  };

  private getKeysForClient = () => {
    return new Bluebird.Promise<RequestIdentity>((resolve, reject) => {
      this.emit(
        BalenaSshAgent.EVENT_IDENTITY,
        {},
        (apiKey: string, deviceUuid: string) => {
          resolve({
            apiKey,
            deviceUuid
          });
        }
      );
    })
      .then(({ apiKey, deviceUuid }) => {
        console.log(`== Details: ${JSON.stringify({ apiKey, deviceUuid })}`);
        return request
          .get(
            `${this.config.authApiEndpoint}${
              this.config.authApiPath
            }${deviceUuid}`,
            { json: true, auth: { bearer: apiKey } }
          )
          .then(body => {
            let keys: Buffer[] = [];
            body.keys.forEach((key: string) => {
              keys.push(Buffer.from(key, "base64"));
            });

            return keys;
          });
      })
      .catch(err => {
        console.error(err);
        return new Array<Buffer>(0);
      });
  };

  private provideKeysToClient = (keys: Buffer[], client: Socket) => {
    let keyCount = keys.length;

    let keysLength = 0;
    keys.forEach(key => {
      keysLength += key.length;
    });

    let message = Buffer.alloc(
      4 + keysLength + keysLength * 4 + keysLength * 4
    );

    message.writeUInt32BE(keyCount, 0);
    let keyOffset = 4;
    keys.forEach(key => {
      // key blob...
      message.writeUInt32BE(key.length, keyOffset);

      for (let pos = 0; pos < key.length; pos++) {
        message.writeUInt8(key[pos], keyOffset + 4 + pos);
      }
      keyOffset += key.length + 4;

      // key comment...
      message.writeUInt32BE(0, keyOffset);

      keyOffset += 4;
    });

    return this.replyToClient(
      client,
      AgentMessageType.SSH_AGENT_IDENTITIES_ANSWER,
      message
    );
  };

  private signRequestWithApi = (
    publicKey: string,
    data: Buffer,
    flags: number
  ) => {
    return new Bluebird.Promise<RequestIdentity>((resolve, reject) => {
      const result = this.emit(
        BalenaSshAgent.EVENT_IDENTITY,
        {},
        (apiKey: string, deviceUuid: string) => {
          resolve({
            apiKey,
            deviceUuid
          });
        }
      );

      if (!result) {
        reject();
      }
    })
      .then(({ apiKey, deviceUuid }) => {
        return request.post(
          `${this.config.authApiEndpoint}${
            this.config.authApiPath
          }${deviceUuid}`,
          {
            json: {
              data: data.toString("base64"),
              //   publicKey,
              flags
            },
            auth: {
              bearer: apiKey
            }
          }
        );
      })
      .then(body => {
        const signature = Buffer.from(body.signature, "base64");
        const response = Buffer.alloc(4 + signature.length);
        response.writeUInt32BE(signature.length, 0);
        signature.copy(response, 4);

        return response;
      });
  };
}
