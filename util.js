"use strict";

const http = require('http');

/* Reference:
 * https://gist.github.com/slavafomin/b164e3e710a6fc9352c934b9073e7216
 */
class OError extends Error {
    constructor(message, opaque) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
        this.opaque = Object.assign({}, opaque);
    }
};

function index(input) {
    return input.toLowerCase().replace(/\W/g, '_');
}

function pad02dPositive(number) {
    if (number < 10)
        return '0' + number.toString();
    return number.toString();
}

function pad03dPositive(number) {
    if (number < 10)
        return '00' + number.toString();
    if (number < 100)
        return '0' + number.toString();
    return number.toString();
}

function request(options, callback) {
    var req;
    var result = {};

    function onTimeout() {
        let type = this.socket.connecting ? 'connect' : 'request';
        callback(new OError('HTTP ' + type + ' timeout'));
        this.abort();
    }

    function onError(err) {
        if (this.aborted)
            return;
        callback(new OError('HTTP request error ' + err.message));
    }

    function onResponse(res) {
        result.resDate = new Date();
        result.body = '';
        result.res = res;
        res.on('data', (chunk) => result.body += chunk);
        res.on('end', onEnd);
    }

    function onEnd() {
        if (result.res.statusCode >= 200 && result.res.statusCode < 300)
            callback(null, result);
        else
            callback(new OError('HTTP status code ' + result.res.statusCode, result));
    }

    if (options.data !== undefined) {
        if (typeof(options.data) != 'string')
            options.data = JSON.stringify(options.data);
        options.headers['Content-Length'] = Buffer.byteLength(options.data);
    }

    req = http.request(options);
    req.on('response', onResponse);
    req.on('error', onError);
    req.on('timeout', onTimeout);
    req.end(options.data);
}

function jsonRequest(options, callback) {
    function onResult(err, result) {
        if (err) {
            callback(err);
            return;
        }

        try { result.decoded = JSON.parse(result.body); }
        catch (err) {
            callback(new OError('JSON parse error ' + err.message, result));
            return;
        }
        callback(null, result);
    }

    request(options, onResult);
}

const ES_SEARCH_DEFAULTS = {
    host: '127.0.0.1',
    port: 9200,
    agent: http.globalAgent,
    method: 'POST',
    path: '/_search',
    headers: {
        'Content-Type': 'application/json'
    },
    timeout: 1000,
    data: {
        query: {
            match_all: {}
        },
        size: 10
    }
};

function esSearch(options, callback) {
    function onResult(err, result) {
        if (err) {
            callback(err);
            return;
        }
        if (!result.decoded.hits || !result.decoded.hits.hits) {
            callback(new OError('ES invalid search response', result));
            return;
        }
        if (!options.scroll) {
            callback(null, result.decoded);
            return;
        }
        if (!result.decoded._scroll_id) {
            callback(new OError('ES missing response scroll id', result));
            return;
        }

        callback(null, result.decoded);
        options.path = '/_search/scroll';
        options.data = { scroll_id: result.decoded._scroll_id };

        if (result.decoded.hits.hits.length) {
            options.data.scroll = options.scroll;
            jsonRequest(options, onResult);
        }
        else {
            options.method = 'DELETE';
            request(options, () => {} /* noop */);
        }
    }

    options = Object.assign({}, ES_SEARCH_DEFAULTS, options);

    if (options.scroll)
        options.path += (options.path.indexOf('?') > -1 ? '&' : '?') +
            'scroll=' + options.scroll;

    jsonRequest(options, onResult);
}

module.exports = {
    OError: OError,
    index: index,
    pad02dPositive: pad02dPositive,
    pad03dPositive: pad03dPositive,
    request: request,
    jsonRequest: jsonRequest,
    esSearch: esSearch
};
