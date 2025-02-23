'use strict';
const EventsEventEmitter = require('events').EventEmitter;
const ResponseClass = require.main.require('./classes/ResponseClass');
const RequestClass = require.main.require('./classes/RequestClass');
const EventController = require.main.require('./controllers/EventController');

const PostWebHook = () => {
    return (req, res) => {
        const EventEmitter = new EventsEventEmitter();
        const response = new ResponseClass(res);
        const request = new RequestClass(req);
        // const headers = {
        //     ip: request.headers('x-forwarded-for') || request.connection('remoteAddress'),
        //     session: request.headers('session'),
        //     local: request.headers('local'),
        // };

        const body = {
            text: request.body('text'),
        }

        function verifyParameters() {
            const hasRequiredParameters = body.text;
            if (hasRequiredParameters) {
                EventEmitter.emit('send-response');
            } else {
                return response.sendError('Missing required parameters.');
            }
        }

        function sendResponse() {
            EventController.sendResponse(body.category, body.action, body.label, body.value, headers)
            .then((eventResponse, responseError) => {
                return response.sendSuccessMessage('');
            });
        }

        EventEmitter.on('verify-parameters', verifyParameters);
        EventEmitter.on('send-response', sendResponse);
        EventEmitter.emit('verify-parameters');
    }
};

module.exports = PostWebHook;