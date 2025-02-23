const WebHookService = (router) => {
    const resourceName = 'webhook-service';
    const postWebHook = require('./routes/PostWebHook')();

    router.post(`/${resourceName}/webhook`, postWebHook);
};

module.exports = WebHookService;