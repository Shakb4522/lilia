import os
import requests
import uuid
import json
import shutil
import asyncio
import websockets
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect
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
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

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
    if OPENAI_API_KEY:
        api_key = OPENAI_API_KEY
        url = "https://api.openai.com/v1/chat/completions"
        model_name = "gpt-4o"
        provider_name = "OpenAI"
    elif GROQ_API_KEY:
        api_key = GROQ_API_KEY
        url = "https://api.groq.com/openai/v1/chat/completions"
        model_name = "llama-3.3-70b-versatile"
        provider_name = "Groq"
    else:
        return JSONResponse(
            content={"error": "Neither OPENAI_API_KEY nor GROQ_API_KEY is configured in the environment variables."}, 
            status_code=500
        )
        
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
        transcribe_keywords = [
            "transcribe", "transcript", "transcription", 
            "translate", "summarize", "explain", "read", "écris", "traduire", 
            "analyse", "what is in this", "what is this audio", "process"
        ]
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
        "Authorization": f"Bearer {api_key}",
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
        "model": model_name,
        "messages": [system_prompt] + req.messages,
        "temperature": 0.5
    }
    
    try:
        response = http_session.post(url, headers=headers, json=payload)
        
        if response.status_code != 200:
            err_data = response.json()
            raise Exception(f"{provider_name} Chat API Error: {err_data.get('error', {}).get('message', 'Unknown Error')}")
            
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
    
    # Always perform immediate transcription on upload
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

        # Call LLM with safe truncated transcript context
        if OPENAI_API_KEY:
            api_key = OPENAI_API_KEY
            url = "https://api.openai.com/v1/chat/completions"
            model_name = "gpt-4o"
            provider_name = "OpenAI"
        elif GROQ_API_KEY:
            api_key = GROQ_API_KEY
            url = "https://api.groq.com/openai/v1/chat/completions"
            model_name = "llama-3.3-70b-versatile"
            provider_name = "Groq"
        else:
            raise Exception("Neither OPENAI_API_KEY nor GROQ_API_KEY is configured.")

        max_transcript_chars = 12000
        safe_transcript = transcribed_text
        if len(safe_transcript) > max_transcript_chars:
            safe_transcript = safe_transcript[:max_transcript_chars] + "\n\n[... Transcript truncated here to fit rate limits ...]"

        headers = {
            "Authorization": f"Bearer {api_key}",
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
        
        active_user_prompt = prompt_stripped
        if not active_user_prompt:
            active_user_prompt = "Please provide the transcription and summarize this audio file."

        payload = {
            "model": model_name,
            "messages": [system_prompt] + messages + [{"role": "user", "content": active_user_prompt}],
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

class LiveSpeechSaveReq(BaseModel):
    chat_id: Optional[str] = None
    text: str

@app.post("/api/chats/live-speech")
async def save_live_speech(req: LiveSpeechSaveReq):
    title_text = req.text.strip()
    if not title_text:
        title_text = "Live Speech Session"
    title = title_text[:30] + ("..." if len(title_text) > 30 else "")
    
    if req.chat_id:
        # Update existing
        chats_col.update_one(
            {"_id": req.chat_id},
            {"$set": {
                "title": title,
                "items": [
                    {
                        "type": "user",
                        "text": req.text
                    }
                ],
                "chatHistory": [
                    {
                        "role": "user",
                        "content": req.text
                    }
                ]
            }}
        )
        return {"chat_id": req.chat_id, "title": title}
    else:
        # Create new
        chat_id = str(uuid.uuid4())
        new_chat = {
            "_id": chat_id,
            "title": title,
            "type": "live_speech",
            "created_at": datetime.utcnow().isoformat(),
            "items": [
                {
                    "type": "user",
                    "text": req.text
                }
            ],
            "chatHistory": [
                {
                    "role": "user",
                    "content": req.text
                }
            ]
        }
        chats_col.insert_one(new_chat)
        return {"chat_id": chat_id, "title": title}

@app.get("/api/chats")
async def get_chats_list():
    try:
        chats = list(chats_col.find({}, {"_id": 1, "title": 1, "created_at": 1, "type": 1}).sort("created_at", -1))
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


@app.websocket("/ws/live-speech")
async def websocket_endpoint(websocket: WebSocket, lang: str = "en"):
    await websocket.accept()
    print(f"Client connected to live speech WebSocket (Language: {lang})")
    
    if not DEEPGRAM_API_KEY:
        print("Deepgram API Key not set, sending error to client and closing websocket")
        try:
            await websocket.send_json({"error": "Deepgram API Key is missing on the server. Please set the DEEPGRAM_API_KEY environment variable to use live speech transcription."})
            await websocket.close(code=1008)  # Policy Violation
        except:
            pass
        return
        
    deepgram_url = f"wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&interim_results=true&language={lang}"
    headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}
    
    client_task = None
    dg_task = None
    try:
        async with websockets.connect(deepgram_url, extra_headers=headers) as dg_ws:
            print("Connected to Deepgram WebSocket")
            
            async def receive_from_client():
                while True:
                    data = await websocket.receive_bytes()
                    await dg_ws.send(data)
                    
            async def receive_from_deepgram():
                async for message in dg_ws:
                    dg_data = json.loads(message)
                    channel = dg_data.get("channel", {})
                    alternatives = channel.get("alternatives", [{}])
                    transcript = alternatives[0].get("transcript", "")
                    is_final = dg_data.get("is_final", False)
                    
                    if transcript:
                        await websocket.send_json({
                            "transcript": transcript,
                            "is_final": is_final
                        })
            
            client_task = asyncio.create_task(receive_from_client())
            dg_task = asyncio.create_task(receive_from_deepgram())
            
            done, pending = await asyncio.wait(
                [client_task, dg_task],
                return_when=asyncio.FIRST_COMPLETED
            )
            
            # Cancel whatever is still running
            for task in pending:
                task.cancel()
                try:
                    await task
                except:
                    pass
                    
            # Propagate any exception that occurred
            for task in done:
                if task.exception():
                    raise task.exception()
            
            print("Speech proxy loops finished normally. Closing client socket.")
            await websocket.close(code=1000, reason="Speech streams completed.")
            
    except WebSocketDisconnect:
        print("Client disconnected from WebSocket")
    except Exception as e:
        err_msg = str(e)
        print("Error connecting/proxying to Deepgram:", err_msg)
        # Cancel tasks if they exist
        for t in [client_task, dg_task]:
            if t and not t.done():
                t.cancel()
                try:
                    await t
                except:
                    pass
        try:
            # Send the error message as a standard JSON frame first
            await websocket.send_json({"error": f"Deepgram connection failed: {err_msg}"})
            await websocket.close(code=1011)  # Internal Server Error
        except Exception as close_err:
            print("Failed to close client websocket cleanly:", str(close_err))


# Dynamic routing: serve index.html for specific pages
@app.get("/live-speech")
async def serve_live_speech_page():
    return FileResponse("index.html")

@app.get("/chat/{chat_id}")
async def serve_chat_page(chat_id: str):
    return FileResponse("index.html")

# Serve the static files
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
