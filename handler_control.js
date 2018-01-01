"use strict";

const log = require(__dirname + '/log.js');

function HandlerControl(srv, agent) {
    var self = this;

    function processRequest(req, res) {
        var data = '';
        req.on('data', (chunk) => data += chunk);
        req.on('end', () => parseJson(data, req, res));
    }

    function parseJson(data, req, res) {
        try { var ct = JSON.parse(data); }
        catch (err) {
            log.error('CT JSON parse error', err.message);
            res.writeHead(400);
            res.end();
            return;
        }
        processControl(ct, res);
    }

    function processControl(ct, res) {
        var error = 0;
        for (let key in ct) {
            let fn = 'do_' + key;
            if (typeof(self[fn]) != 'function' || !self[fn](ct[key]))
                error++;
        }
        res.writeHead(error ? 400 : 200);
        res.end();
    }

    function do_verbose(value) {
        if (typeof(value) != 'number')
            return false;
        if (global.VERBOSE >= 1)
            log.info('CT verbose, value ' + value)
        global.VERBOSE = value;
        return true;
    }

    function do_stop() {
        if (global.VERBOSE >= 1)
            log.info('CT stop, terminating')
        srv.stop();
        for (let i in agent.requests) {
            for (let j = 0; j < agent.requests[i].length; j++)
                agent.requests[i][j].abort();
        }
        return true;
    }

    /* Exposed methods */
    this.processRequest = processRequest;
    this.do_verbose = do_verbose;
    this.do_stop = do_stop;
}

module.exports = HandlerControl;
