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
    const btnRemoveAudio = document.getElementById('btnRemoveAudio');
    const mainChatInput = document.getElementById('mainChatInput');
    const recentChatsList = document.getElementById('recentChatsList');

    // Sidebar buttons
    const btnNewChatSidebar = document.getElementById('btnNewChatSidebar');
    const btnGoHome = document.getElementById('btnGoHome');

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
    
    // MongoDB Persistence State
    let currentChatId = null;
    let chatTitle = 'New Chat';
    let chatItems = []; // Array of { type: 'welcome'|'transcript'|'user'|'ai', text: string, title?: string }
    let chatHistory = []; // Array of { role: 'user'|'assistant', content: string }
    let currentTypewriterTimeout = null;
    let pendingFile = null;

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
            audioPlayerContainer.style.display = 'none';
            audioPlayer.pause();
            try { recognition.start(); } catch(e) { console.error(e); }
        }
    }

    btnRecord.addEventListener('click', toggleRecording);
    btnAddFile.addEventListener('click', () => { fileInput.click(); });
    
    if (btnRemoveAudio) {
        btnRemoveAudio.addEventListener('click', () => {
            pendingFile = null;
            audioPlayerContainer.style.display = 'none';
            audioPlayer.src = '';
        });
    }

    // File Stage (Upload occurs on hitting Send)
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            if (isRecording) toggleRecording();
            switchToTranscriptView();
            
            pendingFile = file;
            const fileUrl = URL.createObjectURL(file);
            audioPlayer.src = fileUrl;
            document.getElementById('audioFileName').textContent = file.name;
            audioPlayerContainer.style.display = 'flex';
            
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
    function createTranscriptCell(text, title, isFromLoad = false) {
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

        if (!isFromLoad) {
            chatItems.push({ type: 'transcript', text, title });
            saveCurrentChatState();
        }
    }

    function createChatCell(role, text, isFromLoad = false) {
        const cell = document.createElement('div');
        cell.className = `transcript-cell ${role === 'user' ? 'user-cell' : 'ai-cell'}`;
        
        const content = document.createElement('div');
        content.className = 'cell-content';
        
        if (text.includes('typing-indicator')) {
            content.innerHTML = text;
        } else {
            content.innerHTML = text.replace(/\n/g, '<br>');
        }
        
        cell.appendChild(content);
        
        transcriptContainer.insertBefore(cell, liveTextContainer);
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;

        if (!isFromLoad && !text.includes('typing-indicator')) {
            chatItems.push({ type: role, text });
        }
        return cell;
    }

    function typeWriterHTML(element, htmlText, speed = 15, callback) {
        if (currentTypewriterTimeout) {
            clearTimeout(currentTypewriterTimeout);
        }
        element.innerHTML = '';
        const regex = /(<[^>]+>|[^<>\s]+|\s+)/g;
        const tokens = htmlText.match(regex) || [];
        let i = 0;
        
        function type() {
            if (i < tokens.length) {
                element.innerHTML += tokens[i];
                i++;
                transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
                currentTypewriterTimeout = setTimeout(type, speed);
            } else {
                currentTypewriterTimeout = null;
                if (callback) callback();
            }
        }
        type();
    }

    async function sendChatMessage() {
        const text = mainChatInput.value.trim();
        if (!text && !pendingFile) return;
        
        switchToTranscriptView();
        
        if (pendingFile) {
            const fileToUpload = pendingFile;
            pendingFile = null;
            audioPlayerContainer.style.display = 'none';
            
            progressContainer.classList.remove('hidden');
            progressTitle.textContent = `Processing: ${fileToUpload.name}`;
            progressTitle.style.color = 'var(--text-primary)';
            progressBar.classList.remove('indeterminate');
            progressBar.style.backgroundColor = 'var(--accent-blue)';
            progressBar.style.width = '0%';
            progressPercent.textContent = '0%';
            progressStatus.textContent = 'Uploading to Server...';
            
            statusIndicator.textContent = 'Uploading...';
            statusIndicator.classList.add('recording');
            
            const formData = new FormData();
            formData.append('file', fileToUpload);
            
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
            
            xhr.addEventListener('load', async () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (data.error) throw new Error(data.error);
                        
                        progressTitle.textContent = 'Transcription Complete';
                        progressStatus.textContent = 'Added to workspace.';
                        progressBar.style.backgroundColor = '#10b981';
                        progressBar.classList.remove('indeterminate');
                        progressBar.style.width = '100%';
                        progressPercent.textContent = '';
                        
                        createTranscriptCell(data.text, fileToUpload.name);
                        
                        setTimeout(() => { progressContainer.classList.add('hidden'); }, 3000);
                        
                        // If user also typed a message, execute AI query
                        if (text) {
                            await executeChatQuery(text);
                        }
                        
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
        } else {
            await executeChatQuery(text);
        }
    }

    async function executeChatQuery(text) {
        // Grab current text from all transcription cells
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

        // Update chat title based on the first user question if it's currently 'New Chat'
        if (chatTitle === 'New Chat') {
            chatTitle = text.slice(0, 30) + (text.length > 30 ? '...' : '');
        }

        // Save state after user message
        saveCurrentChatState();
        
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
            
            const contentDiv = loadingCell.querySelector('.cell-content');
            const formattedReply = data.reply.replace(/\n/g, '<br>');
            
            // Modern typing effect word-by-word/token-by-token
            typeWriterHTML(contentDiv, formattedReply, 12, () => {
                chatHistory.push({ role: 'assistant', content: data.reply });
                chatItems.push({ type: 'ai', text: data.reply });
                saveCurrentChatState();
            });
            
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
            audioPlayerContainer.style.display = 'none';
            audioPlayer.pause();
            audioPlayer.src = '';
            
            // Clear current chat state in MongoDB
            chatItems = [];
            chatHistory = [];
            chatTitle = 'New Chat';
            saveCurrentChatState();
        }
    });

    // -----------------------------------------------------
    // MongoDB Chat History Integration
    // -----------------------------------------------------
    async function createNewChat() {
        if (currentTypewriterTimeout) {
            clearTimeout(currentTypewriterTimeout);
            currentTypewriterTimeout = null;
        }
        try {
            const response = await fetch('/api/chats', { method: 'POST' });
            const data = await response.json();
            
            if (data.chat_id) {
                currentChatId = data.chat_id;
                chatTitle = 'New Chat';
                chatItems = [];
                chatHistory = [];
                
                // Clear UI to pristine new chat state
                const cells = transcriptContainer.querySelectorAll('.transcript-cell');
                cells.forEach((c, idx) => {
                    if (idx !== 0) c.remove();
                });
                liveTranscript = '';
                finalTextContainer.innerHTML = '';
                interimTextContainer.innerHTML = '';
                audioPlayerContainer.style.display = 'none';
                audioPlayer.pause();
                audioPlayer.src = '';

                // Update route URL smoothly
                window.history.pushState(null, "", `/chat/${currentChatId}`);
                
                // Refresh Sidebar History
                fetchRecentChats();
                
                // Switch view to Workspace
                switchToTranscriptView();
            }
        } catch (err) {
            console.error("Failed to create new chat session:", err);
        }
    }

    async function loadChat(chatId) {
        if (currentTypewriterTimeout) {
            clearTimeout(currentTypewriterTimeout);
            currentTypewriterTimeout = null;
        }
        try {
            const response = await fetch(`/api/chats/${chatId}`);
            if (!response.ok) {
                // If chat not found, default to home/new chat
                createNewChat();
                return;
            }
            const chat = await response.json();
            
            currentChatId = chat.id;
            chatTitle = chat.title;
            chatItems = chat.items || [];
            chatHistory = chat.chatHistory || [];

            // Clear existing timeline cells (keep welcome cell)
            const cells = transcriptContainer.querySelectorAll('.transcript-cell');
            cells.forEach((c, idx) => {
                if (idx !== 0) c.remove();
            });

            // Populate all cells from DB
            chatItems.forEach(item => {
                if (item.type === 'transcript') {
                    createTranscriptCell(item.text, item.title, true);
                } else {
                    createChatCell(item.type, item.text, true);
                }
            });

            liveTranscript = '';
            finalTextContainer.innerHTML = '';
            interimTextContainer.innerHTML = '';
            audioPlayerContainer.style.display = 'none';
            audioPlayer.pause();
            audioPlayer.src = '';

            // Update route URL smoothly
            window.history.pushState(null, "", `/chat/${currentChatId}`);

            // Refresh Sidebar Active Indicators
            fetchRecentChats();

            // Switch view to Workspace
            switchToTranscriptView();
        } catch (err) {
            console.error("Failed to load chat:", err);
        }
    }

    async function saveCurrentChatState() {
        if (!currentChatId) return;
        try {
            await fetch(`/api/chats/${currentChatId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: chatTitle,
                    items: chatItems,
                    chatHistory: chatHistory
                })
            });
            // Update the sidebar text dynamically
            fetchRecentChats();
        } catch (err) {
            console.error("Failed to save chat state:", err);
        }
    }

    async function fetchRecentChats() {
        try {
            const response = await fetch('/api/chats');
            const chats = await response.json();
            
            recentChatsList.innerHTML = '';
            chats.forEach(c => {
                const a = document.createElement('a');
                a.href = `/chat/${c.id}`;
                a.className = `sub-item ${c.id === currentChatId ? 'active' : ''}`;
                a.style.display = 'flex';
                a.style.alignItems = 'center';
                a.style.gap = '0.5rem';
                a.style.justifyContent = 'space-between';
                a.style.padding = '0.5rem 0.75rem';
                a.style.borderRadius = '8px';
                a.style.marginBottom = '0.25rem';
                a.style.fontSize = '0.85rem';
                a.style.textDecoration = 'none';
                a.style.color = c.id === currentChatId ? 'var(--text-primary)' : 'var(--text-secondary)';
                a.style.background = c.id === currentChatId ? '#f3f4f6' : 'transparent';
                
                const titleSpan = document.createElement('span');
                titleSpan.style.overflow = 'hidden';
                titleSpan.style.textOverflow = 'ellipsis';
                titleSpan.style.whiteSpace = 'nowrap';
                titleSpan.innerHTML = `<i class="ph ph-chat-circle" style="margin-right:0.4rem; font-size:1.1rem; color: #71717a;"></i> ${c.title}`;
                
                const deleteBtn = document.createElement('button');
                deleteBtn.style.background = 'transparent';
                deleteBtn.style.border = 'none';
                deleteBtn.style.color = '#ef4444';
                deleteBtn.style.cursor = 'pointer';
                deleteBtn.style.display = 'none'; // Will show on hover
                deleteBtn.innerHTML = '<i class="ph ph-trash"></i>';
                
                a.appendChild(titleSpan);
                a.appendChild(deleteBtn);
                
                // Show delete button on hover
                a.addEventListener('mouseenter', () => deleteBtn.style.display = 'inline-block');
                a.addEventListener('mouseleave', () => deleteBtn.style.display = 'none');
                
                deleteBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (confirm('Delete this conversation?')) {
                        try {
                            await fetch(`/api/chats/${c.id}`, { method: 'DELETE' });
                            if (currentChatId === c.id) {
                                createNewChat();
                            } else {
                                fetchRecentChats();
                            }
                        } catch (err) {
                            console.error(err);
                        }
                    }
                });

                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    loadChat(c.id);
                });

                recentChatsList.appendChild(a);
            });
        } catch (err) {
            console.error("Failed to load recent chats:", err);
        }
    }

    // Sidebar listeners
    btnNewChatSidebar.addEventListener('click', (e) => {
        e.preventDefault();
        createNewChat();
    });

    btnGoHome.addEventListener('click', (e) => {
        e.preventDefault();
        // Load default main state
        dashboardView.classList.remove('hidden');
        transcriptView.classList.add('hidden');
        currentChatId = null;
        window.history.pushState(null, "", "/");
        // De-activate sidebar items
        const activeItems = recentChatsList.querySelectorAll('.sub-item');
        activeItems.forEach(item => {
            item.classList.remove('active');
            item.style.background = 'transparent';
        });
    });

    // Check dynamic routing on page load
    const pathParts = window.location.pathname.split('/');
    const chatIdFromUrl = pathParts[pathParts.length - 1];
    
    if (chatIdFromUrl && chatIdFromUrl !== 'chat' && chatIdFromUrl !== '') {
        loadChat(chatIdFromUrl);
    } else {
        // Initialize by fetching lists, keep home screen visible until they make action
        fetchRecentChats();
    }
});
