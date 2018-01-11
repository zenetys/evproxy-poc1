#!/usr/bin/env node

"use strict";

const readline = require('readline');
const fs = require('fs');
const http = require('http');
const util = require(__dirname + '/util.js');
const log = require(__dirname + '/log.js');

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

function readIndexIds(esOptions, callback) {
    var searchOptions = {
        host: esOptions.host,
        port: esOptions.port,
        agent: esOptions.agent,
        method: 'POST',
        path:  esOptions.index + '/_search',
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
        data: {
            query: { match_all: {} },
            size: 100,
            _source: [ 'device', 'indicator', 'device_indicator_join' ]
        },
        scroll: '1m'
    };

    var count = 0;
    var data = {};

    function cbSearch(err, result) {
        if (err)
            callback(new util.OError('XR index ids read failed', { source: err }));
        else if (result.hits.hits.length == 0) {
            log.info('XR index ids read done');
            callback(null, data);
        }
        else {
            count += result.hits.hits.length;
            log.info(`XR index ids read ${count} of ${result.hits.total}`);
            for (let i = 0; i < result.hits.hits.length; i++) {
                let o = result.hits.hits[i];
                if (!data[o._source.device]) {
                    let deviceId = o._source.indicator ?
                        o._source.device_indicator_join.parent : o._id;
                    data[o._source.device] = { id: deviceId,
                        name: o._source.device, children: {} };
                }
                if (o._source.indicator)
                    data[o._source.device].children[o._source.indicator] = o._id;
            }
        }
    }

    util.esSearch(searchOptions, cbSearch);
}

function updateIndexData(mdOptions, esOptions, indexIds) {
    var iface = { input: fs.createReadStream(mdOptions.tsv) };
    var reader = readline.createInterface(iface);
    var headers = [];
    var first = true;

    function onLine(line) {
        line = line.split('\t');

        if (first) {
            headers = line.map((e) => util.index(e));
            first = false;
        }
        else {
            if (line[0] === undefined)
                return; /* missing device name */
            if (!indexIds[line[0]])
                return; /* device not in index */

            let add = {};
            let remove = [];

            for (let i = 1; i < headers.length; i++) {
                if (line[i] === undefined)
                    continue;
                let key = mdOptions.tr && mdOptions.tr[headers[i]] ?
                    mdOptions.tr[headers[i]] : headers[i];
                if (line[i].length)
                    add[key] = line[i];
                else
                    remove.push(key);
            }

            updateIndex(line[0], add, remove);
        }
    }

    function updateIndex(device, add, remove) {
        var deviceIds = indexIds[device];
        var postOptions = {
            host: esOptions.host,
            port: esOptions.port,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-ndjson' },
            path: esOptions.index + '/_bulk',
            agent: esOptions.agent,
            timeout: 30000,
            data: ''
        };

        var data = [];
        if (!util.isEmptyObject(add))
            data.push(JSON.stringify({
                doc: add,
                doc_as_upsert: true,
                retry_on_conflict: 1
            }));
        if (remove.length)
            data.push(JSON.stringify({
                script: {
                    source: 'for (def i : params.keys) ctx._source.remove(i);',
                    lang: 'painless',
                    params: { keys: remove }
                },
                retry_on_conflict: 1
            }));

        for (let d of data) {
            postOptions.data += '{"update":{"_id":"' + deviceIds.id +
                '"}}\n' + d + '\n';
            for (let c in deviceIds.children)
                postOptions.data += '{"update":{"_id":"' + deviceIds.children[c] +
                    '"}}\n' + d + '\n';
        }

        util.jsonRequest(postOptions,
            (e, r) => postCallback(deviceIds, e, r));
    }

    function postCallback(deviceIds, err, result) {
        if (err) {
            log.error('XU index update failed, ' + err.message);
            if (global.VERBOSE >= 1 && err.opaque.body)
                log.error('XU reply', err.opaque.body);
        }
        else {
            let total = result.decoded.items.length;
            let errors = 0;
            result.decoded.items.forEach(
                e => { e.update.error && errors++ });
            let logString = 'XU ' + result.res.statusCode + '/' +
                result.decoded.took + '/' + total + '/' + errors + ' ' +
                deviceIds.name;

            if (errors) {
                log.error(logString);
                if (global.VERBOSE >= 1)
                    log.error('XU reply', util.inspect(result.decoded));
            }
            else
                log.info(logString);
        }
    }

    reader.on('line', onLine);
}

process.on('unhandledRejection', onUnhandledRejection);
process.on('uncaughtException', onUncaughtException);

global.VERBOSE = new Number(process.env.VERBOSE);
if (isNaN(global.VERBOSE))
    global.VERBOSE = 0;

var mdOptions = {
    tsv: '/dev/shm/monitoring-metadata.tsv',
    tr: {
        // The 1st column of the TSV file is always device name.
        // Translations are defined as:
        // tsv_lowercase_underscored_name1: es_name1,
        // tsv_lowercase_underscored_name2: es_name2,
        // tsv_lowercase_underscored_name3: es_name3,
        // ...
    }
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

util.promisify(readIndexIds)(esOptions)
.then((ids) => {
    updateIndexData(mdOptions, esOptions, ids);
})
.catch((err) => {
    log.error(err)
});
