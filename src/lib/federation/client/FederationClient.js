import tls from 'tls';
import {promises as fs} from 'fs';
import NodeRSA from 'node-rsa';
import EventEmitter from 'events';
import {readFileSync} from 'fs';

export default class FederationClient{
    constructor(oblecto, server) {
        this.oblecto = oblecto;
        this.host = oblecto.config.federation.servers[server].address;
        this.port = 9131;
        this.isSecure = false;
        this.authenticated = false;

        this.eventEmitter = new EventEmitter();

        this.dataRead = '';
    }

    async connect() {
        this.socket = tls.connect({
            host: this.host,
            port: this.port ,

            ca: [readFileSync('/etc/oblecto/keys/public-cert.pem')]
        });

        this.socket.on('data', chunk => this.dataHandler(chunk));
        this.socket.on('secureConnect', () => this.secureConnectHandler());
        this.socket.on('error', (error) => this.errorHandler(error));
        this.socket.on('close', () => this.closeHandler());

        if (this.isSecure) return;

        await this.waitForSecure();
        // We need to authenticate the client now

        this.socket.write(`IAM:${this.oblecto.config.federation.uuid}\n`);

        await this.waitForAuth();

        console.log('We are ready!');

    }

    write(header, content) {
        this.socket.write(`${header}:${content}\n`);
    }

    dataHandler (chunk) {
        this.dataRead += chunk.toString();
        let split = this.dataRead.split('\n');

        if (split.length < 2) return;

        for (let item of split) {
            if (item === '') continue;

            this.dataRead = this.dataRead.replace(item + '\n', '');
            this.headerHandler(item);
        }
    }

    headerHandler(data) {
        let split = data.split(':');

        //console.log(split);

        switch (split[0]) {
        case 'CHALLENGE':
            this.challengeHandler(split[1]);
            break;
        case 'AUTH':
            this.authAcceptHandler(split[1]);
            break;
        }
    }

    async challengeHandler(data) {
        const pemKey = await fs.readFile(this.oblecto.config.federation.key);
        const key = NodeRSA(pemKey);

        const decrypted = key.decrypt(data, 'ascii');

        this.write('CHALLENGE', decrypted);
    }

    async authAcceptHandler(data) {
        if (data === 'ACCEPTED') {
            this.authenticated = true;
            this.eventEmitter.emit('auth');
            return;
        }

        delete this;
    }

    secureConnectHandler() {
        this.isSecure = true;

        console.log('Secure Connection initiated');
    }

    errorHandler (error) {
        console.log('error', error);
    }

    closeHandler (_this) {
        console.log('Connection has closed');
    }

    waitForSecure() {
        return new Promise((resolve, reject) => {
            this.socket.once('secureConnect', resolve);
        });
    }

    waitForAuth() {
        return new Promise((resolve, reject) => {
            this.eventEmitter.once('auth', resolve);
        });
    }
}
