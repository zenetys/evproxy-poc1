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

    function loadCache(callback) {
        var loadOptions = {
            host: options.host,
            port: options.port,
            agent: options.agent,
            method: 'POST',
            path:  options.index + '/_search',
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
            data: {
                query: { match_all: {} },
                size: 100,
                _source: [ 'state', 'state_count' ]
            },
            scroll: '1m'
        };

        var count = 0;
        var calls = 0;

        var cbSearch = function (err, result) {
            if (err)
                log.error('EV cache load failed, ' + err.message);
            else if (result.hits.hits.length == 0) {
                log.info(`EV cache load done ${calls}/${count}`);
                callback();
            }
            else {
                calls++;
                count += result.hits.hits.length;
                for (let i = 0; i < result.hits.hits.length; i++)
                    cache.set(result.hits.hits[i]._id,
                              result.hits.hits[i]._source);
            }
        }

        util.esSearch(loadOptions, cbSearch);
    }

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

        evCtx.rm = [];
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
            path: options.index + '/_bulk',
            agent: options.agent,
            timeout: 10000,
            data: ''
        };

        var update = [];

        update.push(JSON.stringify({
            doc: evCtx.ev,
            doc_as_upsert: true
        }));

        if (evCtx.rm.length)
            update.push(JSON.stringify({
                script: {
                    source: 'for (def i : params.keys) ctx._source.remove(i);',
                    lang: 'painless',
                    params: { keys: evCtx.rm }
                }
            }));

        for (let u of update)
            postOptions.data += `{"update":{"_id":"${evCtx.id}","routing":1},\
"retry_on_conflict":1}\n${u}\n`;

        util.jsonRequest(postOptions,
            (e, r) => postCallback(evCtx, postOptions, e, r));
    }

    function postCallback(evCtx, postOptions, err, result) {
        if (err) {
            log.error('EV index failed, ' + err.message);
            if (global.VERBOSE >= 3 && err.opaque.body)
                log.error('EV reply', err.opaque.body);
            return;
        }

        var total = result.decoded.items.length;
        var errors = 0;
        result.decoded.items.forEach(
            e => { e.update.error && errors++ });
        var pool = postOptions.agent.getName(postOptions);
        var queue = postOptions.agent.requests[pool] ?
            postOptions.agent.requests[pool].length : 0;
        var receivedLatency = result.resDate -
            new Date(evCtx.ev.datetime_received);
        var reportedLatency = evCtx.ev.datetime_reported ?
            result.resDate - new Date(evCtx.ev.datetime_reported) : '-';

        var logString = 'EV ' +
            result.res.statusCode + '/' + /* ES HTTP status code */
            result.decoded.took + '/' + /* ES process time */
            total + '/' + /* number of update items */
            errors + ' ' + /* number of update items in error */
            queue + '/' + /* queue length */
            receivedLatency + '/' + /* datetime_received latency */
            reportedLatency + ' ' + /* datetime_reported latency */
            evCtx.name; /* device[/indicator] */

        if (errors) {
            log.error(logString);
            if (global.VERBOSE >= 3)
                log.error('EV reply', util.inspect(result.decoded));
        }
        else if (global.VERBOSE >= 1)
            log.info(logString);
    }

    /* Exposed methods */
    this.loadCache = loadCache;
    this.processRequest = processRequest;
}

module.exports = HandlerEsEvent;
