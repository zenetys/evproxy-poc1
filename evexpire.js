#!/usr/bin/env node

"use strict";

const http = require('http');
const path = require('path');
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

function exitUsage(code) {
    var stream = code ? process.stderr : process.stdout;
    var progname = path.basename(process.argv[1]);
    stream.write(
        'Usage: ' + progname + ' [-f] AGE QUERY\n' +
        'Remove events older than AGE and matching QUERY.\n' +
        '\n' +
        'Available options:\n' +
        '   -f, --force         Disable dry mode\n' +
        '   -v, --verbose       Enable verbose mode\n' +
        '   -h, --help          Display this help\n' +
        '\n' +
        'AGE mut be given in seconds.\n' +
        'QUERY must be given in lucene syntax\n');
    process.exit(code);
}

function expireIndex(options) {
    var mode = options.force ? '_delete_by_query' : '_search';
    var maxDate = (new Date).getTime() - options.age * 1000;

    var post = {
        host: options.host,
        port: options.port,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        path: options.index + '/' + mode,
        timeout: 30000,
        data: {
            query: {
                bool: {
                    filter: [
                        {
                            range: {
                                datetime_received: {
                                    lte: maxDate,
                                    format: 'epoch_millis'
                                }
                            }
                        },
                        {
                            query_string: {
                                fuzziness: 0,
                                query: options.query
                            }
                        }
                    ]
                }
            }
        }
    };

    function postCallback(err, result) {
        if (err) {
            log.error('EP failed, ' + err.message);
            if (options.verbose >= 1 && err.opaque.body)
                log.error('EP reply', err.opaque.body);
            return;
        }

        var total = options.force ? result.decoded.total : '-';
        var deleted = options.force ? result.decoded.deleted : '-';
        var stats = result.res.statusCode + '/' + result.decoded.took + '/' +
            total + '/' + deleted;
        log.info('EP', stats);
        if (options.verbose >= 1)
            log.info('EP reply', util.inspect(result.decoded));
    }

    util.jsonRequest(post, postCallback);
}

process.on('unhandledRejection', onUnhandledRejection);
process.on('uncaughtException', onUncaughtException);

var options = {
    host: '127.0.0.1',
    port: 9200,
    index: '/monitoring/events',
    verbose: 0,
    force: 0
};

var narg = 0;

for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] == '-f' || process.argv[i] == '--force')
        options.force++;
    else if (process.argv[i] == '-v' || process.argv[i] == '--verbose')
        options.verbose++;
    else if (process.argv[i] == '-h' || process.argv[i] == '--help')
        exitUsage(0);
    else {
        narg++;
        if (narg == 1) {
            options.age = new Number(process.argv[i]);
            if (isNaN(options.age))
                exitUsage(1);
        }
        else if (narg == 2)
            options.query = process.argv[i];
        else
            exitUsage(1);
    }
}

if (narg != 2)
    exitUsage(1);

expireIndex(options);
