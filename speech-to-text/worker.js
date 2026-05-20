import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.0';

// We fetch models from HuggingFace hub (cached in browser)
env.allowLocalModels = false;

let transcriber = null;

self.addEventListener('message', async (e) => {
    const { type, audio } = e.data;
    
    if (type === 'transcribe') {
        try {
            if (!transcriber) {
                self.postMessage({ status: 'loading', message: 'Downloading local Whisper AI model (takes ~50MB, only happens once)...' });
                // We use the tiny english model for speed in the browser
                transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
            }
            
            self.postMessage({ status: 'processing', message: 'Model loaded. Transcribing audio locally...' });
            
            const result = await transcriber(audio, {
                chunk_length_s: 30,
                stride_length_s: 5,
            });
            
            self.postMessage({ status: 'complete', text: result.text });
            
        } catch (error) {
            self.postMessage({ status: 'error', message: error.message });
        }
    }
});
