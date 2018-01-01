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

module.exports = {
    OError: OError,
    index: index,
    pad02dPositive: pad02dPositive,
    pad03dPositive: pad03dPositive,
    request: request,
    jsonRequest: jsonRequest,
    esSearch: esSearch
};
