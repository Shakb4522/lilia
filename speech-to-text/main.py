import os
import tempfile
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import whisper

app = FastAPI()

# Allow CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the whisper model when the server starts.
# We use the "tiny" model so it uses less RAM on Render.
print("Loading Whisper model (tiny)...")
model = whisper.load_model("tiny")
print("Model loaded.")

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    try:
        # Save the uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as temp_file:
            temp_file.write(await file.read())
            temp_path = temp_file.name

        print(f"Transcribing {file.filename}...")
        # Process the file with Whisper
        result = model.transcribe(temp_path)
        
        # Clean up
        os.remove(temp_path)
        print("Transcription complete.")

        return JSONResponse(content={"text": result["text"]})
    except Exception as e:
        print("Error during transcription:", str(e))
        return JSONResponse(content={"error": str(e)}, status_code=500)

# Serve the frontend files (index.html, styles.css, app.js)
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    # Render maps external port to this internal port
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
