#!/usr/bin/env node

"use strict";

const http = require('http');
const log = require(__dirname + '/log.js');
const Server = require(__dirname + '/server.js');
const HandlerNoop = require(__dirname + '/handler_noop.js');
const HandlerEsEvent = require(__dirname + '/handler_es_event.js');
const HandlerControl = require(__dirname + '/handler_control.js');

function onUnhandledRejection(e) {
    log.error('Abort due to unhandledRejection!');
    log.error(e);
    process.exit(99);
}

function onUncaughtException(e) {
    log.error('Abort due to uncaughtException!');
    log.error(e);
    process.exit(99);
}

function onTermSignal(control, signal) {
    log.info('Received ' + signal);
    control.do_stop();
}

process.on('unhandledRejection', onUnhandledRejection);
process.on('uncaughtException', onUncaughtException);

global.VERBOSE = new Number(process.env.VERBOSE);
if (isNaN(global.VERBOSE))
    global.VERBOSE = 2;

var srvOptions = {
    listenAddress: '127.0.0.1',
    listenPort: 56789,
    maxClientErrors: 3,
    clientTimeout: 20000,
    maxConnections: 20
};

var esOptions = {
    host: '127.0.0.1',
    port: 9200,
    index: '/monitoring/events',
    agent: new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 5000,
        maxSockets: 3,
        maxFreeSockets: 0
    })
};

var srv = new Server(srvOptions);

var reqHealth = new HandlerNoop(200);
var reqEvent = new HandlerEsEvent(esOptions);
var reqControl = new HandlerControl(srv, esOptions.agent);

srv.setHandler('GET /_cat/health', reqHealth);
srv.setHandler('POST ' + esOptions.index, reqEvent);
srv.setHandler('POST /control', reqControl);

srv.start();

process.once('SIGTERM', onTermSignal.bind(process, reqControl));
process.once('SIGINT', onTermSignal.bind(process, reqControl));
