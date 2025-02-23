'use strict';
class RequestClass {
    constructor(request) {
        this.request = request;
    }
    body(parameter) {
        return this.request.body[parameter] || '';
    }
    query(parameter) {
        return this.request.query[parameter] || '';
    }
    headers(parameter) {
        return this.request.headers[parameter] || '';
    }
    connection(parameter) {
        return this.request.connection[parameter] || '';
    }
    params(parameter) {
        return this.request.params[parameter] || '';
    }
    accepts() {
        return this.request.accepts();
    }
};

module.exports = RequestClass;
