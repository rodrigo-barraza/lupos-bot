const express = require('express');
const router = new express.Router();
// const WebHookService = require('./WebHookService/WebHookService');
const AIService = require('./AIService.js');

const routes = () => {
    // WebHookService(router);
    
    router.get('/transcribe/:audioUrl', async (req, res) => {
        try {
            console.log('hit');
            const audioUrl = decodeURIComponent(req.params.audioUrl);
            
            if (!audioUrl) {
                return res.status(400).json({ 
                    error: 'audioUrl is required' 
                });
            }
            
            const transcription = await AIService.transcribeSpeech(audioUrl);
            
            res.json({ 
                success: true,
                transcription: transcription 
            });
            
        } catch (error) {
            console.error('Transcription error:', error);
            res.status(500).json({ 
                error: error.message || 'Transcription failed',
                success: false
            });
        }
    });
    
    console.log('✅ /transcribe route registered');
    return router;
};

module.exports = routes;
