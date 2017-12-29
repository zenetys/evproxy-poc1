"use strict";

const http = require('http');
const log = require(__dirname + '/log.js');

const DEFAULTS = {
    listenAddress: '127.0.0.1',
    listenPort: 56789,
    requestHandlers: {},
    maxClientErrors: 3,
    clientTimeout: 20000,
    maxConnections: 50
}

/* These are custom property symbols added to the client socket objects.
 * ES6 Symbols are used to avoid naming conflicts. */
const SOCK_NAME = Symbol('evrxName');
const SOCK_ERR = Symbol('evrxClientErrors');

function EventsRX(options) {
    var self = this;
    var options = Object.assign({}, DEFAULTS, options);
    var server = http.createServer();
    var sockets = {};
    var connections = 0;

    function onListening() {
        var addr = this.address();
        log.info('RX server listening on ' + addr.address + ':' + addr.port);
    }

    function onConnection(sock) {
        /* Name the socket, for shortcut in logs and mostly because the local
         * information isn't available anymore after close. */
        sock[SOCK_NAME] = sock.remoteAddress + ':' + sock.remotePort + ' ' +
            sock.localAddress + ':' + sock.localPort;
        sock[SOCK_ERR] = 0;
        sockets[sock[SOCK_NAME]] = sock;
        connections++;
        log.info('RX ' + sock[SOCK_NAME] + ' connection ' + connections +
            '/' + options.maxConnections);
        sock.on('close', onConnectionClose);
    }

    function onConnectionClose() {
        global.VERBOSE && log.info('RX ' + this[SOCK_NAME] + ' close');
        connections--;
        delete sockets[this[SOCK_NAME]];
    }

    function onClientError(err, sock) {
        sock[SOCK_ERR]++;
        log.error('RX ' + sock[SOCK_NAME] + ' error ' + err.code + ' ' +
            sock[SOCK_ERR] + '/' + options.maxClientErrors);
        if (sock[SOCK_ERR] >= options.maxClientErrors)
            sock.destroy();
    }

    function onTimeout(sock) {
        global.VERBOSE && log.info('RX ' + sock[SOCK_NAME] + ' timeout ' +
            options.clientTimeout);
        sock.destroy();
    }

    function onRequest(req, res) {
        /* This is very basic but enough for the requirements. */
        let reqId = req.method + ' ' + req.url;
        if (options.requestHandlers[reqId]) {
            log.info('RX ' + req.socket[SOCK_NAME] + ' handler ' + reqId);
            options.requestHandlers[reqId](req, res);
            return;
        }
        log.error('RX ' + req.socket[SOCK_NAME] + ' unsupported ' + reqId);
        res.writeHead(400);
        res.end();
    }

    function onClose() {
        log.info('RX server close');
    }

    function start() {
        if (server.listening)
            return;

        server.on('connection', onConnection);
        server.on('listening', onListening);
        server.on('request', onRequest);
        server.on('clientError', onClientError);
        server.on('timeout', onTimeout);
        server.on('close', onClose);

        server.timeout = options.clientTimeout;
        server.keepAliveTimeout = options.clientTimeout;
        server.maxConnections = options.maxConnections;

        server.listen(options.listenPort, options.listenAddress);
    }

    function stop() {
        if (!server.listening)
            return;

        server.removeListener('connection', onConnection);
        server.removeListener('listening', onListening);
        server.removeListener('request', onRequest);
        server.removeListener('clientError', onClientError);
        server.removeListener('timeout', onTimeout);

        for (let i in sockets)
            sockets[i].destroy();

        var finalize = function () {
            server.removeListener('close', onClose);
        };

        server.close(finalize);
    }

    /* Exposed methods, these are not prototype'd on purpose because that
     * object is not ment to be called plenty of times. */
    this.start = start;
    this.stop = stop;
}

module.exports = EventsRX;
