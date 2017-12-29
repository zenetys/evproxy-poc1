"use strict";

const util = require(__dirname + '/util.js');

function formatDate() {
    var now = new Date();
    var out = now.getFullYear() +
        '-' + util.pad02dPositive(now.getMonth() + 1) +
        '-' + util.pad02dPositive(now.getDate()) +
        'T' + util.pad02dPositive(now.getHours()) +
        ':' + util.pad02dPositive(now.getMinutes()) +
        ':' + util.pad02dPositive(now.getSeconds()) +
        '.' + util.pad03dPositive(now.getMilliseconds());

    var tzOffset = now.getTimezoneOffset() * -1;
    if (tzOffset == 0) {
        out += 'Z'
    }
    else {
        var tzOffsetHours = Math.floor(tzOffset / 60);
        var tzOffsetMinutes = tzOffset % 60;
        out += (tzOffset >= 0 ? '+' : '-') + util.pad02dPositive(tzOffsetHours) +
            ':' + util.pad02dPositive(tzOffsetMinutes);
    }

    return out;
}

module.exports.info = function (...args) {
    console.info(formatDate() + ' INFO:', ...args);
}

module.exports.warn = function (...args) {
    console.warn(formatDate() + ' WARNING:', ...args);
}

module.exports.error = function (...args) {
    console.error(formatDate() + ' ERROR:', ...args);
}
