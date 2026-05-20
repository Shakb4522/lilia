import os
import requests
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict

app = FastAPI()

# Allow CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Keys
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

# Chat Models
class ChatRequest(BaseModel):
    transcript: str
    messages: List[Dict[str, str]]

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    if not DEEPGRAM_API_KEY and not GROQ_API_KEY:
        return JSONResponse(
            content={"error": "No API Key found! Please add DEEPGRAM_API_KEY or GROQ_API_KEY in Render Environment Variables."}, 
            status_code=500
        )

    try:
        file_bytes = await file.read()

        if DEEPGRAM_API_KEY:
            print(f"Sending {file.filename} to Deepgram Nova-2...")
            url = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true"
            headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}
            response = requests.post(url, headers=headers, data=file_bytes)
            
            if response.status_code != 200:
                raise Exception(f"Deepgram API Error: {response.text}")
                
            result = response.json()
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


@app.post("/chat")
async def chat_with_ai(req: ChatRequest):
    if not GROQ_API_KEY:
        return JSONResponse(
            content={"error": "GROQ_API_KEY is missing! It is required to power the AI Chat assistant. Please add it to Render Environment Variables."}, 
            status_code=500
        )
        
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    # Provide the AI with the transcript as its system context
    system_prompt = {
        "role": "system",
        "content": (
            "You are Lilia's personal AI Assistant. "
            "Your primary job is to answer questions based strictly on the transcribed audio text provided below. "
            f"\n\n<TRANSCRIPT>\n{req.transcript}\n</TRANSCRIPT>\n\n"
            "If the user asks a question that cannot be answered using the transcript, politely inform them that the information is not present in the audio. "
            "Be concise, highly accurate, and friendly."
        )
    }
    
    payload = {
        "model": "llama3-8b-8192",  # Fast and reliable Groq LLM model
        "messages": [system_prompt] + req.messages,
        "temperature": 0.5
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code != 200:
            err_data = response.json()
            raise Exception(f"Groq Chat API Error: {err_data.get('error', {}).get('message', 'Unknown Error')}")
            
        result = response.json()
        reply = result["choices"][0]["message"]["content"]
        
        return JSONResponse(content={"reply": reply})
    except Exception as e:
        print("Chat Error:", str(e))
        return JSONResponse(content={"error": str(e)}, status_code=500)


# Serve the frontend files
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
