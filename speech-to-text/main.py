import os
import requests
import uuid
from datetime import datetime
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Optional
from pymongo import MongoClient

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

# Global HTTP Session for Keep-Alive Connection Pooling
http_session = requests.Session()

# MongoDB Connection
MONGO_URI = os.environ.get("MONGO_URI", "mongodb+srv://chakib:chakib@cluster0.7zvmvse.mongodb.net/?appName=Cluster0")
try:
    client = MongoClient(MONGO_URI)
    # Warm up MongoDB TCP & SSL pool on boot
    client.admin.command('ping')
    db = client["lilia_db"]
    chats_col = db["chats"]
    print("Successfully connected to MongoDB and pre-warmed connection pool!")
except Exception as mongo_err:
    print(f"MongoDB connection failed: {mongo_err}")
    chats_col = None

# Chat Models
class ChatRequest(BaseModel):
    transcript: str
    messages: List[Dict[str, str]]

class UpdateChatRequest(BaseModel):
    title: str
    items: List[Dict]
    chatHistory: List[Dict]

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
            response = http_session.post(url, headers=headers, data=file_bytes)
            
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
            
            response = http_session.post(url, headers=headers, files=files, data=data)
            
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
    # Safety guard: Truncate transcript to prevent TPM limit errors on free/on-demand Groq tiers
    max_transcript_chars = 12000
    safe_transcript = req.transcript or ""
    if len(safe_transcript) > max_transcript_chars:
        print(f"Transcript length ({len(safe_transcript)} chars) exceeds rate limit safety margin. Truncating.")
        safe_transcript = safe_transcript[:max_transcript_chars] + "\n\n[... Transcript truncated here to fit Groq rate limits ...]"

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    system_prompt = {
        "role": "system",
        "content": (
            "You are Lilia's personal AI Assistant. "
            "You help answer questions. If there is transcribed audio text provided below, use it as your primary context to answer. "
            "If no text is provided, just act as a highly intelligent, helpful general AI assistant.\n\n"
            f"<TRANSCRIPT>\n{safe_transcript}\n</TRANSCRIPT>\n\n"
            "Be concise, highly accurate, and friendly."
        )
    }
    
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [system_prompt] + req.messages,
        "temperature": 0.5
    }
    
    try:
        response = http_session.post(url, headers=headers, json=payload)
        
        if response.status_code != 200:
            err_data = response.json()
            raise Exception(f"Groq Chat API Error: {err_data.get('error', {}).get('message', 'Unknown Error')}")
            
        result = response.json()
        reply = result["choices"][0]["message"]["content"]
        
        return JSONResponse(content={"reply": reply})
    except Exception as e:
        print("Chat Error:", str(e))
        return JSONResponse(content={"error": str(e)}, status_code=500)


# -----------------------------------------------------
# MongoDB Chat Persistence REST APIs
# -----------------------------------------------------
@app.post("/api/chats")
async def create_chat():
    if chats_col is None:
        return JSONResponse(status_code=500, content={"error": "Database not connected"})
    chat_id = str(uuid.uuid4())
    new_chat = {
        "_id": chat_id,
        "title": "New Chat",
        "created_at": datetime.utcnow().isoformat(),
        "items": [],
        "chatHistory": []
    }
    chats_col.insert_one(new_chat)
    return {"chat_id": chat_id}

@app.get("/api/chats")
async def get_chats_list():
    if chats_col is None:
        return []
    try:
        chats = list(chats_col.find({}, {"_id": 1, "title": 1, "created_at": 1}).sort("created_at", -1))
        # Map _id to id for client convenience
        for c in chats:
            c["id"] = str(c["_id"])
            del c["_id"]
        return chats
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/chats/{chat_id}")
async def get_chat_session(chat_id: str):
    if chats_col is None:
        return JSONResponse(status_code=500, content={"error": "Database not connected"})
    chat = chats_col.find_one({"_id": chat_id})
    if not chat:
        return JSONResponse(status_code=404, content={"error": "Chat not found"})
    chat["id"] = str(chat["_id"])
    del chat["_id"]
    return chat

@app.put("/api/chats/{chat_id}")
async def update_chat_session(chat_id: str, req: UpdateChatRequest):
    if chats_col is None:
        return JSONResponse(status_code=500, content={"error": "Database not connected"})
    result = chats_col.update_one(
        {"_id": chat_id},
        {"$set": {
            "title": req.title,
            "items": req.items,
            "chatHistory": req.chatHistory
        }}
    )
    if result.matched_count == 0:
        return JSONResponse(status_code=404, content={"error": "Chat not found"})
    return {"success": True}

@app.delete("/api/chats/{chat_id}")
async def delete_chat_session(chat_id: str):
    if chats_col is None:
        return JSONResponse(status_code=500, content={"error": "Database not connected"})
    chats_col.delete_one({"_id": chat_id})
    return {"success": True}


# Dynamic routing: serve index.html for chat IDs
@app.get("/chat/{chat_id}")
async def serve_chat_page(chat_id: str):
    return FileResponse("index.html")

# Serve the static files
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
