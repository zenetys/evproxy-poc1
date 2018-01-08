"use strict";

const http = require('http');
const log = require(__dirname + '/log.js');
const util = require(__dirname + '/util.js');

const DEFAULTS = {
    host: '127.0.0.1',
    port: 9200,
    index: '/monitoring/events',
    agent: http.globalAgent
};

const MANDATORY_FIELDS = [
    'device',
    'datetime_received',
    'state'
];

function Cache() {
    var cache = {};

    function get(id) {
        if (cache[id])
            return cache[id];
        return null;
    }

    function set(id, data) {
        cache[id] = data;
    }

    this.get = get;
    this.set = set;
}

function HandlerEsEvent(options) {
    options = Object.assign({}, DEFAULTS, options);
    var cache = new Cache(options);


    function processRequest(req, res) {
        var data = '';
        req.on('data', (chunk) => data += chunk);
        req.on('end', () => parseJson(data, req, res));
    }

    function parseJson(data, req, res) {
        try { var ev = JSON.parse(data); }
        catch (err) {
            log.error('EV JSON parse error', err.message);
            res.writeHead(400);
            res.end();
            return;
        }
        /* FIXME: We should move the success/failure response in the POST
         * callback processing the answer we got from elasticsearch. */
        res.writeHead(200);
        res.end('{}');
        processEvent({ ev: ev });
    }

    function processEvent(evCtx) {
        var missing = [];
        for (let i of MANDATORY_FIELDS) {
            if (evCtx.ev[i] === undefined)
                missing.push(i);
        }
        if (missing.length) {
            log.error('EV field missing', missing);
            if (global.VERBOSE >= 3)
                log.error('EV input', util.inspect(evCtx.ev));
            return;
        }

        evCtx.name = evCtx.ev.indicator ?
            evCtx.ev.device + '/' + evCtx.ev.indicator :
            evCtx.ev.device;
        evCtx.id = util.index(evCtx.name);

        handleJoin(evCtx);
        beSmart(evCtx);

        if (global.VERBOSE >= 3)
            log.info('EV ctx', evCtx);

        if (evCtx.ev.rawmsg)
            delete evCtx.ev.rawmsg;

        postUpdate(evCtx);
    }

    function handleJoin(evCtx) {
        if (evCtx.ev.indicator) {
            let parentId = util.index(evCtx.ev.device);
            evCtx.ev.device_indicator_join = {
                name: 'indicator',
                parent: parentId
            };
        }
        else {
            evCtx.ev.device_indicator_join = {
                name: 'device'
            };
        }
    }

    function beSmart(evCtx) {
        var cacheData = cache.get(evCtx.id);

        if (!cacheData) {
            /* new device/indicator, not seen yet */
            cacheData = {
                state: evCtx.ev.state,
                state_count: 1
            };
            evCtx.ev.state_count = 1;
            evCtx.ev.last_received_state_change = evCtx.ev.datetime_received;
        }
        else if (cacheData.state === evCtx.ev.state) {
            /* no state change */
            cacheData.state_count++;
            evCtx.ev.state_count = cacheData.state_count;
        }
        else {
            /* state change */
            log.info('EV state change',
                evCtx.ev.datetime_received + '/' + evCtx.ev.state,
                evCtx.name);

            cacheData.state = evCtx.ev.state;
            cacheData.state_count = 1;
            evCtx.ev.state_count = 1;
            evCtx.ev.last_received_state_change = evCtx.ev.datetime_received;
        }

        cache.set(evCtx.id, cacheData);
    }

    function postUpdate(evCtx) {
        var postOptions = {
            host: options.host,
            port: options.port,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-ndjson' },
            path: options.index + '/' + evCtx.id + '/_update?routing=1',
            agent: options.agent,
            timeout: 10000,
            data: {
                doc: evCtx.ev,
                doc_as_upsert: true,
                retry_on_conflict: 1
            }
        };

        var cbResult = function (err, result) {
            if (err) {
                log.error('EV index failed ' + err.message);
                if (global.VERBOSE >= 3 && err.opaque.body)
                    log.error('EV reply', err.opaque.body);
                return;
            }

            var pool = postOptions.agent.getName(postOptions);
            var stats = [];
            /* http status */
            stats.push(result.res.statusCode);
            /* queue length */
            stats.push(postOptions.agent.requests[pool] ?
                postOptions.agent.requests[pool].length : 0);
            /* datetime_received latency */
            stats.push(result.resDate - new Date(evCtx.ev.datetime_received));
            /* datetime_reported latency */
            stats.push(evCtx.ev.datetime_reported ?
                result.resDate - new Date(evCtx.ev.datetime_reported) : '-');

            if (global.VERBOSE >= 1)
                log.info('EV ' + stats.join('/') + ' ' + evCtx.name);
            if (global.VERBOSE >= 3 && result.body)
                log.info('EV reply', result.body);
        }

        util.request(postOptions, cbResult);
    }

    /* Exposed methods */
    this.processRequest = processRequest;
}

module.exports = HandlerEsEvent;
