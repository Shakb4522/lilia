document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dashboardView = document.getElementById('dashboard-view');
    const transcriptView = document.getElementById('transcript-view');
    const btnRecord = document.getElementById('btnRecord');
    const btnAddFile = document.getElementById('btnAddFile');
    const fileInput = document.getElementById('fileInput');
    const statusIndicator = document.getElementById('statusIndicator');
    
    // Transcript Elements
    const finalTextContainer = document.getElementById('finalText');
    const interimTextContainer = document.getElementById('interimText');
    const languageSelect = document.getElementById('languageSelect');
    const btnCopy = document.getElementById('btnCopy');
    const btnDownload = document.getElementById('btnDownload');
    const btnClear = document.getElementById('btnClear');
    const audioPlayerContainer = document.getElementById('audioPlayerContainer');
    const audioPlayer = document.getElementById('audioPlayer');

    // State
    window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isRecording = false;
    let finalTranscript = '';

    // Initialize Speech Recognition if supported
    if (window.SpeechRecognition) {
        recognition = new window.SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = languageSelect.value;

        recognition.onstart = () => {
            isRecording = true;
            statusIndicator.textContent = 'Recording...';
            statusIndicator.classList.add('recording');
            btnRecord.classList.add('active');
            btnRecord.innerHTML = '<i class="ph-fill ph-stop-circle"></i>';
            switchToTranscriptView();
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript + ' ';
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            finalTextContainer.innerHTML = finalTranscript.replace(/\n/g, '<br>');
            interimTextContainer.innerHTML = interimTranscript;
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error', event.error);
            stopRecording();
            statusIndicator.textContent = 'Error: ' + event.error;
        };

        recognition.onend = () => {
            if (isRecording) {
                try { recognition.start(); } catch(e) {}
            } else {
                stopRecording();
            }
        };

        languageSelect.addEventListener('change', (e) => {
            recognition.lang = e.target.value;
            if (isRecording) {
                recognition.stop();
                setTimeout(() => recognition.start(), 100);
            }
        });
    } else {
        statusIndicator.textContent = 'Speech API not supported';
        btnRecord.disabled = true;
    }

    // Handlers
    function switchToTranscriptView() {
        dashboardView.classList.add('hidden');
        transcriptView.classList.remove('hidden');
    }

    function stopRecording() {
        isRecording = false;
        statusIndicator.textContent = 'Ready';
        statusIndicator.classList.remove('recording');
        btnRecord.classList.remove('active');
        btnRecord.innerHTML = '<i class="ph-fill ph-microphone"></i>';
    }

    function toggleRecording() {
        if (!recognition) return alert('Speech Recognition not supported in this browser.');
        
        if (isRecording) {
            isRecording = false;
            recognition.stop();
        } else {
            // Hide audio player if starting live rec
            audioPlayerContainer.classList.add('hidden');
            audioPlayer.pause();
            try { recognition.start(); } catch(e) { console.error(e); }
        }
    }

    // Button Listeners
    btnRecord.addEventListener('click', toggleRecording);

    btnAddFile.addEventListener('click', () => {
        fileInput.click();
    });

    // Progress UI Elements
    const progressContainer = document.getElementById('uploadProgressContainer');
    const progressTitle = document.getElementById('progressTitle');
    const progressPercent = document.getElementById('progressPercent');
    const progressBar = document.getElementById('progressBar');
    const progressStatus = document.getElementById('progressStatus');

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            if (isRecording) toggleRecording();
            switchToTranscriptView();
            
            const fileUrl = URL.createObjectURL(file);
            audioPlayer.src = fileUrl;
            audioPlayerContainer.classList.remove('hidden');
            
            // Show Progress UI instead of raw text
            progressContainer.classList.remove('hidden');
            progressTitle.textContent = `Processing: ${file.name}`;
            progressTitle.style.color = 'var(--text-primary)';
            progressBar.classList.remove('indeterminate');
            progressBar.style.backgroundColor = 'var(--accent-blue)';
            progressBar.style.width = '0%';
            progressPercent.textContent = '0%';
            progressStatus.textContent = 'Uploading to Server...';
            
            statusIndicator.textContent = 'Uploading...';
            statusIndicator.classList.add('recording');
            
            const formData = new FormData();
            formData.append('file', file);
            
            const xhr = new XMLHttpRequest();
            
            // Track Upload Progress
            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    progressBar.style.width = percentComplete + '%';
                    progressPercent.textContent = percentComplete + '%';
                    
                    if (percentComplete === 100) {
                        progressStatus.textContent = 'Transcribing with AI...';
                        progressBar.classList.add('indeterminate');
                        progressPercent.textContent = '';
                        statusIndicator.textContent = 'Transcribing...';
                    }
                }
            });
            
            // Handle Completion
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (data.error) throw new Error(data.error);
                        
                        progressTitle.textContent = 'Transcription Complete';
                        progressStatus.textContent = 'Text has been added to your workspace.';
                        progressBar.style.backgroundColor = '#10b981'; // Green
                        progressBar.classList.remove('indeterminate');
                        progressBar.style.width = '100%';
                        progressPercent.textContent = '';
                        
                        // Append actual text cleanly
                        finalTranscript += data.text + "<br><br>";
                        finalTextContainer.innerHTML = finalTranscript;
                        
                        // Hide success message after 4 seconds
                        setTimeout(() => {
                            progressContainer.classList.add('hidden');
                        }, 4000);
                        
                    } catch (err) {
                        showError(err.message);
                    }
                } else {
                    let errMsg = `Server crashed or timed out (Status ${xhr.status}). Check Render logs.`;
                    try { errMsg = JSON.parse(xhr.responseText).error || errMsg; } catch(e){}
                    showError(errMsg);
                }
                
                statusIndicator.textContent = 'Ready';
                statusIndicator.classList.remove('recording');
            });
            
            xhr.addEventListener('error', () => {
                showError('Network error occurred during upload.');
            });
            
            xhr.open('POST', '/transcribe', true);
            xhr.send(formData);
            
            fileInput.value = ''; // Reset input
        }
    });

    function showError(msg) {
        progressTitle.textContent = 'Error Processing File';
        progressTitle.style.color = '#ef4444';
        progressStatus.textContent = msg;
        progressBar.classList.remove('indeterminate');
        progressBar.style.backgroundColor = '#ef4444';
        progressBar.style.width = '100%';
        progressPercent.textContent = '';
        statusIndicator.textContent = 'Error';
        statusIndicator.classList.remove('recording');
    }

    btnClear.addEventListener('click', () => {
        if (confirm('Clear all transcript text?')) {
            finalTranscript = '';
            finalTextContainer.innerHTML = '';
            interimTextContainer.innerHTML = '';
            audioPlayerContainer.classList.add('hidden');
            audioPlayer.pause();
            audioPlayer.src = '';
        }
    });

    btnCopy.addEventListener('click', () => {
        // Create a temporary element to extract plain text without HTML tags
        const temp = document.createElement('div');
        temp.innerHTML = finalTranscript;
        const textToCopy = temp.textContent || temp.innerText || "";
        
        if (!textToCopy.trim()) return alert('Nothing to copy.');
        
        navigator.clipboard.writeText(textToCopy.trim()).then(() => {
            const originalText = btnCopy.innerHTML;
            btnCopy.innerHTML = '<i class="ph ph-check"></i> Copied!';
            setTimeout(() => {
                btnCopy.innerHTML = originalText;
            }, 2000);
        });
    });

    btnDownload.addEventListener('click', () => {
        const temp = document.createElement('div');
        temp.innerHTML = finalTranscript;
        const textToDownload = temp.textContent || temp.innerText || "";
        
        if (!textToDownload.trim()) return alert('Nothing to download.');
        
        const blob = new Blob([textToDownload.trim()], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transcript_${new Date().toISOString().slice(0,10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // -----------------------------------------------------
    // AI Chat Assistant Logic
    // -----------------------------------------------------
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const btnSendChat = document.getElementById('btnSendChat');
    
    // Maintain chat history for context
    let chatHistory = [];

    function addChatMessage(role, text) {
        const div = document.createElement('div');
        div.className = `chat-message ${role}`;
        div.textContent = text;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function sendChatMessage() {
        const text = chatInput.value.trim();
        if (!text) return;
        
        // Grab current text directly from the UI
        const currentTranscript = finalTextContainer.innerText.trim() + " " + interimTextContainer.innerText.trim();
        if (!currentTranscript.trim()) {
            addChatMessage('assistant', 'Please transcribe some audio on the left first so I have context to answer your questions!');
            return;
        }

        // Add user message to UI and history
        addChatMessage('user', text);
        chatInput.value = '';
        chatHistory.push({ role: 'user', content: text });
        
        // Add loading indicator
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'chat-message assistant';
        loadingDiv.textContent = 'Thinking...';
        chatMessages.appendChild(loadingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transcript: currentTranscript,
                    messages: chatHistory
                })
            });
            
            const data = await response.json();
            chatMessages.removeChild(loadingDiv);
            
            if (!response.ok) {
                throw new Error(data.error || 'Server error');
            }
            
            addChatMessage('assistant', data.reply);
            chatHistory.push({ role: 'assistant', content: data.reply });
            
        } catch (error) {
            chatMessages.removeChild(loadingDiv);
            addChatMessage('assistant', `Error: ${error.message}`);
            // Remove the failed user message from history so they can try again
            chatHistory.pop();
        }
    }

    btnSendChat.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
});
