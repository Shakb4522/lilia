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

# Get Groq API Key from Render Environment Variables
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    if not GROQ_API_KEY:
        return JSONResponse(
            content={"error": "GROQ_API_KEY is missing! Please go to your Render Dashboard -> Environment, and add your Groq API key."}, 
            status_code=500
        )

    try:
        # Read the uploaded file
        file_bytes = await file.read()

        print(f"Sending {file.filename} to Groq supercomputers...")
        
        # Call the Groq Whisper API
        url = "https://api.groq.com/openai/v1/audio/transcriptions"
        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}"
        }
        files = {
            "file": (file.filename, file_bytes, file.content_type or "audio/mpeg")
        }
        data = {
            "model": "whisper-large-v3-turbo",  # Groq's blazing fast model
            "response_format": "json"
        }
        
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
