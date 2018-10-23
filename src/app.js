const net = require('net');
const process = require('process');
const request = require("request");

const SSH_AUTH_SOCK = '/tmp/io.balena.ssh_Listeners';
const agentSocketPath = process.env.SSH_AUTH_SOCK;

const SSH_AGENTC_REQUEST_IDENTITIES = 11;
const SSH_AGENTC_SIGN_REQUEST = 13;
const SSH_AGENT_IDENTITIES_ANSWER = 12;
const SSH_AGENT_SIGN_RESPONSE = 14;

function buildString(value) {
    let buf = Buffer.alloc(4 + value.length);
    buf.writeUInt32BE(value.length);
    
    value_buf = Buffer.from(value, 'utf8');
    value_buf.copy(buf, 4);

    return Buffer.from(value, 'utf8');
}

function readString(buffer, offset, fn) {
    const len = buffer.readUInt32BE(offset);
    const str = Buffer.alloc(len);

    buffer.copy(str, 0, offset + 4, offset + 4 + len);

    fn(str);

    return offset + 4 + len;
}

function replyToClient(client, message, content) {

    const len = content.length + 1;
    let buf = Buffer.alloc(4 + len);
    buf.writeInt32BE(len, 0);
    buf.writeUInt8(message, 4);

    for(pos = 0; pos < content.length; pos++) {
        buf.writeUInt8(content[pos], 5 + pos);
    };

    client.write(buf);
    console.log('agent->client:\n', buf);
    console.log("Length: " + len);
    console.log("Message: " + message);
}

function provideKeysToClient(client) {

    request.get("https://api.resindev.io/auth/v1/ssh/abcde12345", { json: true }, (err, response, body) => {

        let keys = [];
        body.keys.forEach((key) => {
            keys.push(Buffer.from(key, "base64"));
        });

        let keyCount = keys.length;
    
        let keysLength = 0;
        keys.forEach((key) => {
            keysLength += key.length;
        });
    
        let message = Buffer.alloc(4 + keysLength + (keysLength * 4) + (keysLength * 4));
    
        message.writeUInt32BE(keyCount, 0);
        let keyOffset = 4;
        keys.forEach((key) => {

            // console.log("Key: " + key);
    
            // key blob...
            message.writeUInt32BE(key.length, keyOffset);
    
            for(pos = 0; pos < key.length; pos++) {
                message.writeUInt8(key[pos], keyOffset + 4 + pos);
            };
            keyOffset += key.length + 4;
    
            // key comment...
            message.writeUInt32BE(0, keyOffset);
    
            keyOffset += 4;
        });
    
        replyToClient(client, SSH_AGENT_IDENTITIES_ANSWER, message);
    }).auth(null, null, true, 'dkZZw6EOooC6XSyzF88JXpOSCETUYKst');
}

function signRequestWithApi(client, publicKey, data, flags) {

    request.post("https://api.resindev.io/auth/v1/ssh/97449521a1117713b9d81f51bd037c98", { 
        json: {
            data: data.toString("base64"),
            publicKey,
            flags
        }
    }, (err, resp, body) => {
        const signature = Buffer.from(body.signature, "base64");
        const response = Buffer.alloc(4 + signature.length);
        response.writeUInt32BE(signature.length, 0);
        signature.copy(response, 4);

        console.log('\nSignature: ' + response.length);
        console.log('Signature:\r\n', Buffer.concat([Buffer.alloc(5), response]));
        
        replyToClient(client, SSH_AGENT_SIGN_RESPONSE, response);
    }).auth(null, null, true, 'dkZZw6EOooC6XSyzF88JXpOSCETUYKst');
}

const srv = net.createServer((client) => {
    const agent = net.connect(agentSocketPath);
    console.log('CLIENT CONNECTED');
    client.on('end', () => console.log('CLIENT DISCONNECTED'));
    client.on('data', (d) => {
        console.log('client->agent\n', d);
        

        const messageLength = d.readUInt32BE(0);
        const messageNumber = d.readUInt8(4);

        switch(messageNumber) {
            case SSH_AGENTC_REQUEST_IDENTITIES: // request identities...
                provideKeysToClient(client);
                break;
            case SSH_AGENTC_SIGN_REQUEST:

                let publicKey = "";
                let data = "";
                let pos = 5;
                pos = readString(d, pos, (pkey) => {
                    // console.log('Public Key: ' + pkey.toString('utf8'));
                    publicKey = pkey;
                });

                pos = readString(d, pos, (sigData) => {
                    // console.log('Data: ' +  sigData);
                    data = sigData
                });

                const flags = d.readUInt32BE(pos);
                console.log('Flags: ' + flags);
                
                signRequestWithApi(client, publicKey, data, flags);
                break;
            default:
                // agent.write(d);
        }
    });
    agent.on('data', (d) => {
        console.log('agent->client:\n', d);
        client.write(d);

        console.log("Length: " + d.readUInt32BE(0));
        console.log("Message: " + d.readUInt8(4));
    });
});
srv.listen(SSH_AUTH_SOCK);


process.on('exit', function() {
    conn.destroy();
    srv.close();
});