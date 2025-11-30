'use strict';
const EventsEventEmitter = require('events').EventEmitter;
const ResponseClass = require.main.require('./classes/ResponseClass');
const RequestClass = require.main.require('./classes/RequestClass');
const MessageQueueService = require.main.require('./services/MessageQueueService');

const PostWebHook = () => {
    return (req, res) => {
        console.log('fire')
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

        async function sendResponse() {
            const res = await MessageQueueService.assembleCurrentVoiceConversation(body.text);
            return response.sendSuccessMessage(res);
        }

        EventEmitter.on('verify-parameters', verifyParameters);
        EventEmitter.on('send-response', sendResponse);
        EventEmitter.emit('verify-parameters');
    }
};

module.exports = PostWebHook;