import os
import requests
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# Allow CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# You can use Deepgram OR Groq depending on what key is set
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    if not DEEPGRAM_API_KEY and not GROQ_API_KEY:
        return JSONResponse(
            content={"error": "No API Key found! Please add DEEPGRAM_API_KEY or GROQ_API_KEY in Render Environment Variables."}, 
            status_code=500
        )

    try:
        # Read the uploaded file
        file_bytes = await file.read()

        if DEEPGRAM_API_KEY:
            print(f"Sending {file.filename} to Deepgram Nova-2...")
            # Deepgram's Nova-2 model handles multiple languages dynamically
            url = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true"
            headers = {
                "Authorization": f"Token {DEEPGRAM_API_KEY}",
            }
            response = requests.post(url, headers=headers, data=file_bytes)
            
            if response.status_code != 200:
                raise Exception(f"Deepgram API Error: {response.text}")
                
            result = response.json()
            # Parse Deepgram's specific JSON structure
            text = result.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0].get("transcript", "")
            print("Transcription complete via Deepgram.")
            return JSONResponse(content={"text": text})

        elif GROQ_API_KEY:
            print(f"Sending {file.filename} to Groq supercomputers...")
            url = "https://api.groq.com/openai/v1/audio/transcriptions"
            headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
            files = {"file": (file.filename, file_bytes, file.content_type or "audio/mpeg")}
            data = {"model": "whisper-large-v3-turbo", "response_format": "json"}
            
            response = requests.post(url, headers=headers, files=files, data=data)
            
            if response.status_code != 200:
                err_data = response.json()
                raise Exception(f"Groq API Error: {err_data.get('error', {}).get('message', 'Unknown Error')}")
                
            result = response.json()
            print("Transcription complete via Groq.")
            return JSONResponse(content={"text": result["text"]})

    except Exception as e:
        print("Error during transcription:", str(e))
        return JSONResponse(content={"error": str(e)}, status_code=500)

# Serve the frontend files
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
