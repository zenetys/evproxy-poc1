#!/usr/bin/env node

"use strict";

const util = require(__dirname + '/util.js');
const log = require(__dirname + '/log.js');
const http = require('http');
const url = require('url');

const LISTEN_ADDR = '127.0.0.1';
const LISTEN_PORT = 56789;
const ES_HOST = '127.0.0.1';
const ES_PORT = 9200;
const ES_INDEX = '/monitoring/events';

function onUnhandledRejection(e) {
    log.error('UnhandledRejection!');
    log.error(e);
}

function onUncaughtException(e) {
    log.error('UncaughtException!');
    log.error(e);
}

function onHttpListening() {
    var addr = this.address();
    log.info('HTTP server listening on ' + addr.family + ':' +
        addr.address + ':' + addr.port);
}

function onHttpRequest(req, res) {
    log.info('I ' + req.socket.remoteAddress + ':' + req.socket.remotePort +
        ' ' + req.socket.localAddress + ':' + req.socket.localPort +
        ' ' + req.method + ' ' + req.url);

    if (req.url == '/_cat/health')
        return onHttpRequestHealth(req, res);
    if (req.url == ES_INDEX)
        return onHttpRequestMonitoringEvent(req, res);

    res.writeHead(400);
    res.end('Unsupported request to ' + req.url);
}

function onHttpRequestHealth(req, res) {
    res.writeHead(200);
    res.end();
}

function onHttpRequestMonitoringEvent(req, res) {
    var data = '';
    var processor = function () {
        try {
            data = JSON.parse(data);
            data = modifyMonitoringEvent(data);
            indexMonitoringEvent(data);
        }
        catch (e) {
            log.error(e);
            res.writeHead(400);
            res.end();
            return;
        }

        res.writeHead(201);
        res.end('{}');
    }

    req.on('data', (chunk) => data += chunk);
    req.on('end', processor);
}

function modifyMonitoringEvent(data) {
    if (process.env.DEBUG == 1)
        log.info(data);
    if (data.rawmsg)
        delete data.rawmsg;
    return data;
}

function indexMonitoringEvent(data) {
    if (!data.device)
        throw new Error('Missing device property');

    var id = util.index(data.device);
    if (data.service)
        id += '_' + util.index(data.service);

    var postData = JSON.stringify({
        doc: data,
        doc_as_upsert: true,
        retry_on_conflict: 1
    });

    var options = {
        host: ES_HOST,
        port: ES_PORT,
        method: 'POST',
        path: ES_INDEX + '/' + id + '/_update',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 1000,
        agent: AGENT
    };

    var onResponseData = function (chunk) {
        // noop required to flush socket
    };

    var onResponse = function (res) {
        res.on('data', onResponseData);

        var pool = AGENT.getName(options);
        var now = new Date();
        var stats = [];
        /* http status */
        stats.push(res.statusCode);
        /* queue length */
        stats.push(AGENT.requests[pool] ? AGENT.requests[pool].length : 0);
        /* datetime_received latency */
        stats.push(data.datetime_received ? now - new Date(data.datetime_received) : '-');
        /* datetime_reported latency */
        stats.push(data.datetime_reported ? now - new Date(data.datetime_reported) : '-');

        log.info('O ' + res.socket.localAddress + ':' + res.socket.localPort +
            ' ' + res.socket.remoteAddress + ':' + res.socket.remotePort +
            ' ' + options.method + ' ' + ES_INDEX + ' ' + stats.join('/'));
    };

    var req = http.request(options);
    req.on('response', onResponse);
    req.write(postData);
    req.end();
}

process.on('unhandledRejection', onUnhandledRejection);
process.on('uncaughtException', onUncaughtException);

var AGENT = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 5000,
    maxSockets: 3,
    maxFreeSockets: 0
});

var server = http.createServer();
server.on('listening', onHttpListening);
server.on('request', onHttpRequest);
server.listen(LISTEN_PORT, LISTEN_ADDR);
