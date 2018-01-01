"use strict";

const http = require('http');
const log = require(__dirname + '/log.js');

const DEFAULTS = {
    listenAddress: '127.0.0.1',
    listenPort: 56789,
    requestHandlers: {},
    maxClientErrors: 3,
    clientTimeout: 20000,
    maxConnections: 20
}

/* These are custom property symbols added to the client socket objects.
 * ES6 Symbols are used to avoid naming conflicts. */
const SOCK_NAME = Symbol('srvClientName');
const SOCK_ERR = Symbol('srvClientErrors');

function Server(options) {
    options = Object.assign({}, DEFAULTS, options);

    var self = this;
    var server = http.createServer();
    var sockets = {};
    var connections = 0;

    function onError(err) {
        log.error('SR server error', err.message);
        self.stop();
    }

    function onListening() {
        var addr = this.address();
        log.info(`SR server listening on ${addr.address}:${addr.port}`);
    }

    function onConnection(sock) {
        /* Name the socket, for shortcut in logs and mostly because the local
         * information isn't available anymore after close. */
        sock[SOCK_NAME] = sock.remoteAddress + ':' + sock.remotePort + ' ' +
            sock.localAddress + ':' + sock.localPort;
        sock[SOCK_ERR] = 0;

        connections++;
        sockets[sock[SOCK_NAME]] = sock;
        sock.on('close', onConnectionClose);

        if (global.VERBOSE >= 3)
            log.info(`SR ${sock[SOCK_NAME]} connection ${connections}/\
${options.maxConnections}`);
    }

    function onConnectionClose() {
        if (global.VERBOSE >= 3)
            log.info(`SR ${this[SOCK_NAME]} close`);

        connections--;
        delete sockets[this[SOCK_NAME]];
    }

    function onClientError(err, sock) {
        if (global.VERBOSE >= 1)
            log.error(`SR ${sock[SOCK_NAME]} error ${err.code} \
${sock[SOCK_ERR]}/${options.maxClientErrors}`);

        sock[SOCK_ERR]++;
        if (sock[SOCK_ERR] >= options.maxClientErrors)
            sock.destroy();
    }

    function onTimeout(sock) {
        if (global.VERBOSE >= 3)
            log.info(`SR ${sock[SOCK_NAME]} timeout ${options.clientTimeout}`);

        sock.destroy();
    }

    function onRequest(req, res) {
        /* This is very basic but enough for the requirements.
         * Assume request handlers are proper objets. */
        let reqId = req.method + ' ' + req.url;
        if (options.requestHandlers[reqId]) {
            if (global.VERBOSE >= 2)
                log.info(`SR ${req.socket[SOCK_NAME]} handler ${reqId}`);
            options.requestHandlers[reqId].processRequest(req, res);
            return;
        }

        if (global.VERBOSE >= 1)
            log.error(`SR ${req.socket[SOCK_NAME]} unsupported ${reqId}`);
        res.writeHead(501);
        res.end();
    }

    function onClose() {
        log.info('SR server close');
    }

    function start() {
        if (!server.listening)
            server.listen(options.listenPort, options.listenAddress);
    }

    function stop() {
        if (!server.listening)
            return;

        for (let i in sockets)
            sockets[i].destroy();
        server.close();
    }

    function setHandler(reqId, handler) {
        options.requestHandlers[reqId] = handler;
    }

    server.on('error', onError);
    server.on('connection', onConnection);
    server.on('listening', onListening);
    server.on('request', onRequest);
    server.on('clientError', onClientError);
    server.on('timeout', onTimeout);
    server.on('close', onClose);

    server.timeout = options.clientTimeout;
    server.keepAliveTimeout = options.clientTimeout;
    server.maxConnections = options.maxConnections;

    /* Exposed methods */
    this.start = start;
    this.stop = stop;
    this.setHandler = setHandler;
}

module.exports = Server;
