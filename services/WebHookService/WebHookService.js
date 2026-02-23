const WebHookService = async (router) => {
    const resourceName = 'webhook-service';
    const { default: PostWebHook } = await import('./routes/PostWebHook.js');
    const postWebHook = PostWebHook();

    router.post(`/${resourceName}/webhook`, postWebHook);
};

export default WebHookService;