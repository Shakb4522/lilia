import os
import requests
import uuid
import json
import shutil
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, Form
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

# -----------------------------------------------------
# Offline / Fallback Local JSON Collection class
# -----------------------------------------------------
class JSONCursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction=-1):
        def get_sort_key(doc):
            return doc.get(key, "")
        self.docs.sort(key=get_sort_key, reverse=(direction == -1))
        return self

    def __iter__(self):
        return iter(self.docs)

class JSONUpdateResult:
    def __init__(self, matched_count=1):
        self.matched_count = matched_count

class JSONCollection:
    def __init__(self, filepath="chats.json"):
        self.filepath = filepath
        if not os.path.exists(self.filepath):
            with open(self.filepath, "w") as f:
                json.dump({}, f)

    def _read(self):
        try:
            with open(self.filepath, "r") as f:
                return json.load(f)
        except Exception:
            return {}

    def _write(self, data):
        try:
            with open(self.filepath, "w") as f:
                json.dump(data, f, indent=4)
        except Exception as e:
            print("Failed to write local database:", e)

    def insert_one(self, document):
        data = self._read()
        doc_id = document.get("_id")
        data[doc_id] = document
        self._write(data)
        return True

    def find_one(self, filter):
        data = self._read()
        doc_id = filter.get("_id")
        if doc_id in data:
            return data[doc_id]
        return None

    def find(self, filter=None, projection=None):
        data = self._read()
        docs = list(data.values())
        return JSONCursor(docs)

    def delete_one(self, filter):
        data = self._read()
        doc_id = filter.get("_id")
        if doc_id in data:
            del data[doc_id]
            self._write(data)
        return True

    def update_one(self, filter, update):
        data = self._read()
        doc_id = filter.get("_id")
        if doc_id in data:
            doc = data[doc_id]
            set_ops = update.get("$set", {})
            for k, v in set_ops.items():
                doc[k] = v
            data[doc_id] = doc
            self._write(data)
            return JSONUpdateResult(1)
        return JSONUpdateResult(0)

# MongoDB Connection
MONGO_URI = os.environ.get("MONGO_URI", "mongodb+srv://chakib:chakib@cluster0.7zvmvse.mongodb.net/?appName=Cluster0")
try:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
    # Warm up MongoDB TCP & SSL pool on boot
    client.admin.command('ping')
    db = client["lilia_db"]
    chats_col = db["chats"]
    print("Successfully connected to MongoDB and pre-warmed connection pool!")
except Exception as mongo_err:
    print(f"MongoDB connection failed: {mongo_err}. Falling back to dynamic JSON local database.")
    chats_col = JSONCollection()

# Chat Models
class ChatRequest(BaseModel):
    chat_id: Optional[str] = None
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
    
    prompt = ""
    if req.messages:
        prompt = req.messages[-1].get("content", "").strip()

    # Check MongoDB if we have an associated file for this chat session
    associated_file_path = None
    associated_file_name = None
    transcribed_text = None
    
    if req.chat_id and chats_col:
        chat = chats_col.find_one({"_id": req.chat_id})
        if chat:
            associated_file_path = chat.get("associated_file_path")
            associated_file_name = chat.get("associated_file_name")
            transcribed_text = chat.get("transcribed_text")

    # If we have an associated file but it has not been transcribed yet,
    # and the user typed a prompt that asks us to do something with it:
    newly_transcribed = False
    if associated_file_path and not transcribed_text and prompt:
        transcribe_keywords = ["transcribe", "translate", "summarize", "explain", "read", "écris", "traduire", "analyse", "what is in this", "what is this audio"]
        needs_transcribe = False
        for kw in transcribe_keywords:
            if kw in prompt.lower():
                needs_transcribe = True
                break
                
        if needs_transcribe:
            try:
                # Perform lazy transcription
                with open(associated_file_path, "rb") as f:
                    file_bytes = f.read()
                    
                print(f"Lazy transcribing {associated_file_name}...")
                if DEEPGRAM_API_KEY:
                    tg_url = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true"
                    headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}
                    response = http_session.post(tg_url, headers=headers, data=file_bytes)
                    if response.status_code == 200:
                        result = response.json()
                        transcribed_text = result.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0].get("transcript", "")
                elif GROQ_API_KEY:
                    tg_url = "https://api.groq.com/openai/v1/audio/transcriptions"
                    headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
                    files = {"file": (associated_file_name, file_bytes, "audio/mpeg")}
                    data = {"model": "whisper-large-v3-turbo", "response_format": "json"}
                    response = http_session.post(tg_url, headers=headers, files=files, data=data)
                    if response.status_code == 200:
                        result = response.json()
                        transcribed_text = result.get("text", "")
                        
                if transcribed_text:
                    newly_transcribed = True
                    # Update MongoDB with cached transcript text
                    chats_col.update_one(
                        {"_id": req.chat_id},
                        {"$set": {"transcribed_text": transcribed_text}}
                    )
            except Exception as tr_err:
                print(f"Lazy transcription failed: {tr_err}")

    # Build the transcript context for the LLM
    active_transcript = transcribed_text or req.transcript or ""

    # Safety guard: Truncate transcript to prevent TPM limit errors on free/on-demand Groq tiers
    max_transcript_chars = 12000
    safe_transcript = active_transcript
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
        
        resp_data = {"reply": reply}
        if newly_transcribed:
            resp_data["transcript"] = transcribed_text
            resp_data["filename"] = associated_file_name
            
        return JSONResponse(content=resp_data)
    except Exception as e:
        print("Chat Error:", str(e))
        return JSONResponse(content={"error": str(e)}, status_code=500)


@app.post("/chat_file")
async def chat_with_file(
    chat_id: Optional[str] = Form(None),
    prompt: Optional[str] = Form(""),
    history: str = Form("[]"),
    file: UploadFile = File(...)
):
    # Parse history
    try:
        messages = json.loads(history)
    except Exception:
        messages = []

    # Save the uploaded file inside a directory named "uploads"
    uploads_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    
    unique_filename = f"{uuid.uuid4()}_{file.filename}"
    saved_path = os.path.join(uploads_dir, unique_filename)
    
    with open(saved_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    print(f"Saved audio file to {saved_path}")

    prompt_stripped = prompt.strip()
    
    # Define keywords to detect if the user is asking to transcribe/translate/summarize
    transcribe_keywords = ["transcribe", "translate", "summarize", "explain", "read", "écris", "traduire", "analyse", "what is in this", "what is this audio"]
    needs_transcribe = False
    for kw in transcribe_keywords:
        if kw in prompt_stripped.lower():
            needs_transcribe = True
            break
            
    # If prompt is empty or doesn't ask to transcribe:
    if not prompt_stripped or not needs_transcribe:
        # Save file info in MongoDB associated with the chat session
        if chat_id and chats_col:
            chats_col.update_one(
                {"_id": chat_id},
                {"$set": {
                    "associated_file_path": saved_path,
                    "associated_file_name": file.filename,
                    "transcribed_text": None
                }}
            )
            
        reply = f"I have successfully received your audio file **{file.filename}**! 🎵 What would you like me to do with it? (e.g. 'Transcribe it', 'Translate to Arabic', 'Summarize it')"
        return JSONResponse(content={
            "reply": reply, 
            "filename": file.filename, 
            "has_file": True,
            "chat_id": chat_id
        })

    # If prompt explicitly asks to transcribe/process immediately:
    try:
        with open(saved_path, "rb") as f:
            file_bytes = f.read()
            
        transcribed_text = ""
        if DEEPGRAM_API_KEY:
            print(f"Sending {file.filename} to Deepgram Nova-2...")
            tg_url = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true"
            headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}
            response = http_session.post(tg_url, headers=headers, data=file_bytes)
            if response.status_code == 200:
                result = response.json()
                transcribed_text = result.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0].get("transcript", "")
        elif GROQ_API_KEY:
            print(f"Sending {file.filename} to Groq whisper...")
            tg_url = "https://api.groq.com/openai/v1/audio/transcriptions"
            headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
            files = {"file": (file.filename, file_bytes, file.content_type or "audio/mpeg")}
            data = {"model": "whisper-large-v3-turbo", "response_format": "json"}
            response = http_session.post(tg_url, headers=headers, files=files, data=data)
            if response.status_code == 200:
                result = response.json()
                transcribed_text = result.get("text", "")

        if not transcribed_text:
            raise Exception("Failed to generate transcription from audio file.")

        # Save to database
        if chat_id and chats_col:
            chats_col.update_one(
                {"_id": chat_id},
                {"$set": {
                    "associated_file_path": saved_path,
                    "associated_file_name": file.filename,
                    "transcribed_text": transcribed_text
                }}
            )

        # Call Groq LLM with safe truncated transcript context
        url = "https://api.groq.com/openai/v1/chat/completions"
        max_transcript_chars = 12000
        safe_transcript = transcribed_text
        if len(safe_transcript) > max_transcript_chars:
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
            "messages": [system_prompt] + messages + [{"role": "user", "content": prompt_stripped}],
            "temperature": 0.5
        }
        
        reply = "Transcription generated, but failed to connect to AI."
        llm_resp = http_session.post(url, headers=headers, json=payload)
        if llm_resp.status_code == 200:
            reply = llm_resp.json()["choices"][0]["message"]["content"]

        return JSONResponse(content={
            "reply": reply,
            "transcript": transcribed_text,
            "filename": file.filename,
            "has_file": True
        })

    except Exception as e:
        print("Error during immediate upload transcribe:", str(e))
        return JSONResponse(content={"error": str(e)}, status_code=500)


# -----------------------------------------------------
# MongoDB Chat Persistence REST APIs
# -----------------------------------------------------
@app.post("/api/chats")
async def create_chat():
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
    chat = chats_col.find_one({"_id": chat_id})
    if not chat:
        return JSONResponse(status_code=404, content={"error": "Chat not found"})
    chat["id"] = str(chat["_id"])
    del chat["_id"]
    return chat

@app.put("/api/chats/{chat_id}")
async def update_chat_session(chat_id: str, req: UpdateChatRequest):
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
