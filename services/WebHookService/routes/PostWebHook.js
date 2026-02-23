'use strict';
import { EventEmitter as EventsEventEmitter } from 'events';
import ResponseClass from '#root/classes/ResponseClass.js';
import RequestClass from '#root/classes/RequestClass.js';
import MessageQueueService from '#root/services/MessageQueueService.js';

const PostWebHook = () => {
    return (req, res) => {
        console.log('fire')
        const EventEmitter = new EventsEventEmitter();
        const response = new ResponseClass(res);
        const request = new RequestClass(req);

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

export default PostWebHook;