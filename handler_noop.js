"use strict";

function HandlerNoop(httpCode) {
    if (!httpCode)
        httpCode = 200;

    function processRequest(req, res) {
        res.writeHead(httpCode);
        res.end();
    }

    /* Exposed methods */
    this.processRequest = processRequest;
}

module.exports = HandlerNoop;
