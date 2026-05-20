document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dashboardView = document.getElementById('dashboard-view');
    const transcriptView = document.getElementById('transcript-view');
    const btnRecord = document.getElementById('btnRecord');
    const btnAddFile = document.getElementById('btnAddFile');
    const fileInput = document.getElementById('fileInput');
    const statusIndicator = document.getElementById('statusIndicator');
    
    // Transcript & Chat Elements
    const transcriptContainer = document.getElementById('transcript');
    const liveTextContainer = document.getElementById('liveTextContainer');
    const finalTextContainer = document.getElementById('finalText');
    const interimTextContainer = document.getElementById('interimText');
    const languageSelect = document.getElementById('languageSelect');
    const btnClear = document.getElementById('btnClear');
    const audioPlayerContainer = document.getElementById('audioPlayerContainer');
    const audioPlayer = document.getElementById('audioPlayer');
    const mainChatInput = document.getElementById('mainChatInput');

    // Progress UI Elements
    const progressContainer = document.getElementById('uploadProgressContainer');
    const progressTitle = document.getElementById('progressTitle');
    const progressPercent = document.getElementById('progressPercent');
    const progressBar = document.getElementById('progressBar');
    const progressStatus = document.getElementById('progressStatus');

    // State
    window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isRecording = false;
    let liveTranscript = '';
    let chatHistory = [];

    // Initialize Speech Recognition
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
            liveTextContainer.classList.remove('hidden');
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    liveTranscript += event.results[i][0].transcript + ' ';
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            finalTextContainer.innerHTML = liveTranscript.replace(/\n/g, '<br>');
            interimTextContainer.innerHTML = interimTranscript;
            transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
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
        
        if (liveTranscript.trim() || interimTextContainer.textContent.trim()) {
            const fullText = liveTranscript + interimTextContainer.textContent;
            createTranscriptCell(fullText.trim(), `Live Dictation (${new Date().toLocaleTimeString()})`);
            liveTranscript = '';
            finalTextContainer.innerHTML = '';
            interimTextContainer.innerHTML = '';
        }
        liveTextContainer.classList.add('hidden');
    }

    function toggleRecording() {
        if (!recognition) return alert('Speech Recognition not supported in this browser.');
        
        if (isRecording) {
            stopRecording();
            recognition.stop();
        } else {
            audioPlayerContainer.classList.add('hidden');
            audioPlayer.pause();
            try { recognition.start(); } catch(e) { console.error(e); }
        }
    }

    btnRecord.addEventListener('click', toggleRecording);
    btnAddFile.addEventListener('click', () => { fileInput.click(); });

    // File Upload & Progress
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            if (isRecording) toggleRecording();
            switchToTranscriptView();
            
            const fileUrl = URL.createObjectURL(file);
            audioPlayer.src = fileUrl;
            audioPlayerContainer.classList.remove('hidden');
            
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
            
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (data.error) throw new Error(data.error);
                        
                        progressTitle.textContent = 'Transcription Complete';
                        progressStatus.textContent = 'Text has been added as a new cell.';
                        progressBar.style.backgroundColor = '#10b981';
                        progressBar.classList.remove('indeterminate');
                        progressBar.style.width = '100%';
                        progressPercent.textContent = '';
                        
                        createTranscriptCell(data.text, file.name);
                        
                        setTimeout(() => { progressContainer.classList.add('hidden'); }, 4000);
                        
                    } catch (err) { showError(err.message); }
                } else {
                    let errMsg = `Server error (Status ${xhr.status}).`;
                    try { errMsg = JSON.parse(xhr.responseText).error || errMsg; } catch(e){}
                    showError(errMsg);
                }
                statusIndicator.textContent = 'Ready';
                statusIndicator.classList.remove('recording');
            });
            
            xhr.addEventListener('error', () => { showError('Network error occurred during upload.'); });
            xhr.open('POST', '/transcribe', true);
            xhr.send(formData);
            fileInput.value = ''; 
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

    // -----------------------------------------------------
    // Transcript Cells & AI Chat Cells
    // -----------------------------------------------------
    function createTranscriptCell(text, title) {
        if (!text.trim()) return;

        const cell = document.createElement('div');
        cell.className = 'transcript-cell transcript-item';
        
        const content = document.createElement('div');
        content.className = 'cell-content collapsed';
        content.innerHTML = text.replace(/\n/g, '<br>');
        
        const actions = document.createElement('div');
        actions.className = 'cell-actions';
        
        const btnToggle = document.createElement('button');
        btnToggle.className = 'btn-cell-action';
        btnToggle.innerHTML = '<i class="ph ph-caret-down"></i> Show the rest';
        
        btnToggle.addEventListener('click', () => {
            if (content.classList.contains('collapsed')) {
                content.classList.remove('collapsed');
                btnToggle.innerHTML = '<i class="ph ph-caret-up"></i> Show less';
            } else {
                content.classList.add('collapsed');
                btnToggle.innerHTML = '<i class="ph ph-caret-down"></i> Show the rest';
            }
        });
        
        const btnDownload = document.createElement('button');
        btnDownload.className = 'btn-cell-action';
        btnDownload.innerHTML = '<i class="ph ph-file-doc"></i> Download Word File';
        btnDownload.addEventListener('click', () => downloadWord(text, title));
        
        actions.appendChild(btnToggle);
        actions.appendChild(btnDownload);
        
        cell.appendChild(content);
        cell.appendChild(actions);
        
        transcriptContainer.insertBefore(cell, liveTextContainer);
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    }

    function createChatCell(role, text) {
        const cell = document.createElement('div');
        cell.className = `transcript-cell ${role === 'user' ? 'user-cell' : 'ai-cell'}`;
        
        const content = document.createElement('div');
        content.className = 'cell-content';
        // Check if the text contains html like typing-indicator to avoid breaking it with replace
        if (text.includes('typing-indicator')) {
            content.innerHTML = text;
        } else {
            content.innerHTML = text.replace(/\n/g, '<br>');
        }
        
        cell.appendChild(content);
        
        transcriptContainer.insertBefore(cell, liveTextContainer);
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
        return cell;
    }

    async function sendChatMessage() {
        const text = mainChatInput.value.trim();
        if (!text) return;
        
        switchToTranscriptView();
        
        // Grab current text from all transcription cells (ignore AI/user chat cells)
        let currentTranscript = '';
        const cells = transcriptContainer.querySelectorAll('.transcript-item .cell-content');
        cells.forEach(cell => {
            currentTranscript += cell.textContent + '\n\n';
        });
        currentTranscript += finalTextContainer.innerText.trim() + " " + interimTextContainer.innerText.trim();

        // Create user message cell
        createChatCell('user', text);
        mainChatInput.value = '';
        chatHistory.push({ role: 'user', content: text });
        
        // Create pulsing typing loader cell instead of raw text
        const loadingCell = createChatCell('assistant', '<div class="typing-indicator"><span></span><span></span><span></span></div>');

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
            
            if (!response.ok) {
                throw new Error(data.error || 'Server error');
            }
            
            loadingCell.querySelector('.cell-content').innerHTML = data.reply.replace(/\n/g, '<br>');
            chatHistory.push({ role: 'assistant', content: data.reply });
            
        } catch (error) {
            loadingCell.querySelector('.cell-content').innerHTML = `<span style="color:#ef4444;">Error: ${error.message}</span>`;
            chatHistory.pop();
        }
    }

    mainChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    async function downloadWord(text, filename) {
        if (!window.docx || !window.saveAs) {
            alert("Word document library is still loading. Please try again in a moment.");
            return;
        }
        try {
            const { Document, Packer, Paragraph, TextRun, HeadingLevel } = window.docx;
            const doc = new Document({
                sections: [{
                    properties: {},
                    children: [
                        new Paragraph({ text: "Audio Transcription", heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
                        new Paragraph({ text: `Source: ${filename}`, heading: HeadingLevel.HEADING_2, spacing: { after: 400 } }),
                        new Paragraph({ children: [ new TextRun({ text: text, size: 24 }) ] }),
                    ],
                }],
            });
            const blob = await Packer.toBlob(doc);
            const safeFilename = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            window.saveAs(blob, `${safeFilename}_transcript.docx`);
        } catch (e) {
            console.error(e);
            alert("Error generating Word document.");
        }
    }

    btnClear.addEventListener('click', () => {
        if (confirm('Clear entire workspace?')) {
            const cells = transcriptContainer.querySelectorAll('.transcript-cell');
            // Remove all cells except the initial AI welcome cell
            cells.forEach((c, idx) => {
                if (idx !== 0) c.remove();
            });
            
            liveTranscript = '';
            finalTextContainer.innerHTML = '';
            interimTextContainer.innerHTML = '';
            audioPlayerContainer.classList.add('hidden');
            audioPlayer.pause();
            audioPlayer.src = '';
            chatHistory = [];
        }
    });
});
