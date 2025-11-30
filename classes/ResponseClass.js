class ResponseClass {
    constructor(response) {
        this.response = response;
    }
    sendSuccessMessage(message, code) {
        const statusCode = code || 200;
        const successObject = {
            success: true,
            message: message
        }
        return this.response.status(statusCode).send(successObject);
    };
    sendSuccessHeartBeat(code) {
        const statusCode = code || 200;
        return this.response.status(statusCode).send('lub, dub');
    };
    sendSuccessData(object, code) {
        const statusCode = code || 200;
        const responseObject = {
            success: true,
            data: object
        }
        return this.response.status(statusCode).json(responseObject);
    };
    sendError(message, code) {
        const statusCode = code || 400;
        const errorObject = {
            error: true,
            message: message
        }
        return this.response.status(statusCode).json(errorObject);
    };
    sendErrors(errors, code) {
        const statusCode = code || 400;
        const errorObject = {
            error: true,
            data: errors
        }
        return this.response.status(statusCode).json(errorObject);
    };
};

module.exports = ResponseClass;
