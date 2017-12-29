"use strict";

module.exports.pad02dPositive = function (number) {
    if (number < 10)
        return '0' + number.toString();
    return number.toString();
}

module.exports.pad03dPositive = function (number) {
    if (number < 10)
        return '00' + number.toString();
    if (number < 100)
        return '0' + number.toString();
    return number.toString();
}

module.exports.index = function (input) {
    return input.toLowerCase().replace(/\W/g, '_');
}
