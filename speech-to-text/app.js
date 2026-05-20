document.addEventListener('DOMContentLoaded', () => {
    // -----------------------------------------------------
    // Theme Management (Sombre Mode)
    // -----------------------------------------------------
    const btnDarkModeToggle = document.getElementById('btnDarkModeToggle');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('theme') || (systemPrefersDark ? 'dark' : 'light');
    
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateDarkModeButton(savedTheme);
    
    if (btnDarkModeToggle) {
        btnDarkModeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateDarkModeButton(newTheme);
        });
    }
    
    function updateDarkModeButton(theme) {
        if (!btnDarkModeToggle) return;
        if (theme === 'dark') {
            btnDarkModeToggle.innerHTML = '<i class="ph ph-sun"></i> <span>Clair Mode</span>';
        } else {
            btnDarkModeToggle.innerHTML = '<i class="ph ph-moon"></i> <span>Sombre Mode</span>';
        }
    }

    // -----------------------------------------------------
    // Sidebar Collapse Toggle
    // -----------------------------------------------------
    const sidebar = document.querySelector('.sidebar');
    const btnToggleSidebarFloating = document.getElementById('btnToggleSidebarFloating');

    function toggleSidebar() {
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed');
    }

    if (btnToggleSidebarFloating) {
        btnToggleSidebarFloating.addEventListener('click', toggleSidebar);
    }

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
    
    // Inline Staging Progress Elements
    const stagingProgressWrapper = document.getElementById('stagingProgressWrapper');
    const stagingStatusText = document.getElementById('stagingStatusText');
    const stagingProgressPercent = document.getElementById('stagingProgressPercent');
    const stagingProgressBarFill = document.getElementById('stagingProgressBarFill');
    const audioFileIcon = document.getElementById('audioFileIcon');

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
    
    // Staging / Audio Upload States
    let stagedFile = null;
    let stagedTranscriptText = '';
    let stagedTranscriptTitle = '';
    let isUploadingAudio = false;
    let activeUploadXHR = null;

    // Helper to auto-create and persist a chat session if starting from the Home dashboard
    async function ensureActiveChatId() {
        if (currentChatId) return currentChatId;
        
        try {
            const response = await fetch('/api/chats', { method: 'POST' });
            const data = await response.json();
            if (data.chat_id) {
                currentChatId = data.chat_id;
                chatTitle = 'New Chat';
                chatItems = [];
                chatHistory = [];
                
                // Update URL route path smoothly
                window.history.pushState(null, "", `/chat/${currentChatId}`);
                
                // Refresh Sidebar History List
                fetchRecentChats();
                return currentChatId;
            }
        } catch (err) {
            console.error("Failed to auto-create chat session:", err);
        }
        return null;
    }

    // -----------------------------------------------------
    // Real-Time Live Speech Dictation (Deepgram via WebSockets)
    // -----------------------------------------------------
    const btnLiveSpeechView = document.getElementById('btnLiveSpeechView');
    const liveSpeechView = document.getElementById('live-speech-view');
    
    const btnLiveSpeechRecord = document.getElementById('btnLiveSpeechRecord');
    const liveSpeechFinal = document.getElementById('liveSpeechFinal');
    const liveSpeechInterim = document.getElementById('liveSpeechInterim');
    const liveSpeechPlaceholder = document.getElementById('liveSpeechPlaceholder');
    const btnLiveSpeechCopy = document.getElementById('btnLiveSpeechCopy');
    const btnLiveSpeechWord = document.getElementById('btnLiveSpeechWord');
    const btnLiveSpeechClear = document.getElementById('btnLiveSpeechClear');
    const liveSpeechLanguage = document.getElementById('liveSpeechLanguage');
    const liveSpeechStatus = document.getElementById('liveSpeechStatus');

    let liveSpeechSocket = null;
    let liveMediaRecorder = null;
    let liveMediaStream = null;
    let isLiveSpeechRecording = false;

    function switchToDashboardView() {
        dashboardView.classList.remove('hidden');
        transcriptView.classList.add('hidden');
        liveSpeechView.classList.add('hidden');
        
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        if (btnGoHome) btnGoHome.classList.add('active');
        
        const bottomBar = document.querySelector('.bottom-bar-container');
        if (bottomBar) bottomBar.style.display = 'flex';
        
        if (window.location.pathname === '/live-speech') {
            window.history.pushState(null, "", "/");
        }
    }

    function switchToTranscriptView() {
        dashboardView.classList.add('hidden');
        transcriptView.classList.remove('hidden');
        liveSpeechView.classList.add('hidden');
        
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        
        const bottomBar = document.querySelector('.bottom-bar-container');
        if (bottomBar) bottomBar.style.display = 'flex';
        
        if (window.location.pathname === '/live-speech') {
            window.history.pushState(null, "", currentChatId ? `/chat/${currentChatId}` : "/");
        }
    }

    function switchToLiveSpeechView() {
        dashboardView.classList.add('hidden');
        transcriptView.classList.add('hidden');
        liveSpeechView.classList.remove('hidden');
        
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        if (btnLiveSpeechView) btnLiveSpeechView.classList.add('active');
        
        const bottomBar = document.querySelector('.bottom-bar-container');
        if (bottomBar) bottomBar.style.display = 'none';
        
        // Stop any chat player if playing
        if (audioPlayer) audioPlayer.pause();
        
        window.history.pushState(null, "", "/live-speech");
    }

    if (btnLiveSpeechView) {
        btnLiveSpeechView.addEventListener('click', (e) => {
            e.preventDefault();
            switchToLiveSpeechView();
        });
    }

    // Toggle live recording
    if (btnLiveSpeechRecord) {
        btnLiveSpeechRecord.addEventListener('click', async () => {
            if (isLiveSpeechRecording) {
                stopLiveSpeechDictation();
            } else {
                await startLiveSpeechDictation();
            }
        });
    }

    async function startLiveSpeechDictation() {
        try {
            // Get microphone permission
            liveMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log("[Live Speech] getUserMedia returned:", liveMediaStream);
            if (!liveMediaStream || !(liveMediaStream instanceof MediaStream)) {
                throw new Error("Microphone stream is not a valid MediaStream object.");
            }
            
            // Open WebSocket Connection to FastAPI Proxy
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            let lang = 'fr'; // Default to French
            if (liveSpeechLanguage) {
                lang = liveSpeechLanguage.value;
            }
            const socketUrl = `${protocol}//${window.location.host}/ws/live-speech?lang=${lang}`;
            
            liveSpeechSocket = new WebSocket(socketUrl);
            
            liveSpeechSocket.onopen = () => {
                try {
                    isLiveSpeechRecording = true;
                    if (liveSpeechStatus) {
                        liveSpeechStatus.textContent = 'Streaming...';
                        liveSpeechStatus.classList.add('recording');
                    }
                    if (btnLiveSpeechRecord) {
                        btnLiveSpeechRecord.classList.add('active');
                        btnLiveSpeechRecord.innerHTML = '<i class="ph-fill ph-stop-circle"></i><span class="ls-mic-ring"></span>';
                    }
                    
                    // Choose supported mimeType for browser safety (Safari/Chrome/Firefox fallback)
                    let options = {};
                    if (typeof MediaRecorder.isTypeSupported === 'function') {
                        if (MediaRecorder.isTypeSupported('audio/webm')) {
                            options = { mimeType: 'audio/webm' };
                        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
                            options = { mimeType: 'audio/ogg' };
                        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                            options = { mimeType: 'audio/mp4' };
                        }
                    }
                    
                    liveMediaRecorder = new MediaRecorder(liveMediaStream, options);
                    liveMediaRecorder.ondataavailable = (event) => {
                        if (event.data && event.data.size > 0 && liveSpeechSocket && liveSpeechSocket.readyState === WebSocket.OPEN) {
                            liveSpeechSocket.send(event.data);
                        }
                    };
                    liveMediaRecorder.start(250); // Send chunks every 250ms
                } catch (recErr) {
                    console.error("Failed to initialize MediaRecorder:", recErr);
                    alert("Your browser does not support audio recording in a compatible format: " + recErr.message);
                    stopLiveSpeechDictation();
                }
            };
            
            liveSpeechSocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.error) {
                        alert(data.error);
                        stopLiveSpeechDictation();
                        return;
                    }
                    
                    // Hide placeholder on first result
                    if (liveSpeechPlaceholder) {
                        liveSpeechPlaceholder.style.display = 'none';
                    }
                    
                    if (data.is_final) {
                        if (liveSpeechFinal) {
                            liveSpeechFinal.textContent += data.transcript + ' ';
                        }
                        if (liveSpeechInterim) {
                            liveSpeechInterim.textContent = '';
                        }
                    } else {
                        if (liveSpeechInterim) {
                            liveSpeechInterim.textContent = data.transcript;
                        }
                    }
                    
                    // Auto-scroll
                    const outBox = document.getElementById('liveSpeechOutputBox');
                    if (outBox) {
                        outBox.scrollTop = outBox.scrollHeight;
                    }
                } catch (err) {
                    console.error("Error parsing WebSocket message:", err);
                }
            };
            
            liveSpeechSocket.onerror = (err) => {
                console.error("WebSocket Error:", err);
                alert("WebSocket connection error. Please make sure the backend server is running and supports websockets.");
                stopLiveSpeechDictation();
            };
            
            liveSpeechSocket.onclose = (event) => {
                console.log("WebSocket closed. Code:", event.code, "Reason:", event.reason);
                if (event.code === 4000) {
                    alert("Deepgram API Key is missing on the server. Please set the DEEPGRAM_API_KEY environment variable on the server.");
                } else if (event.code !== 1000 && event.code !== 1001 && event.code !== 1005) {
                    alert(`Connection closed: ${event.reason || 'Server connection failed.'} (Code: ${event.code})`);
                }
                stopLiveSpeechDictation();
            };
            
        } catch (err) {
            console.error("Failed to start dictation:", err);
            alert("Microphone permission denied or WebSocket connection failed.");
            stopLiveSpeechDictation();
        }
    }

    function stopLiveSpeechDictation() {
        isLiveSpeechRecording = false;
        if (liveSpeechStatus) {
            liveSpeechStatus.textContent = 'Ready';
            liveSpeechStatus.classList.remove('recording');
        }
        
        if (btnLiveSpeechRecord) {
            btnLiveSpeechRecord.classList.remove('active');
            btnLiveSpeechRecord.innerHTML = '<i class="ph-fill ph-microphone"></i><span class="ls-mic-ring"></span>';
        }
        
        // Stop WebSocket
        if (liveSpeechSocket) {
            if (liveSpeechSocket.readyState === WebSocket.OPEN) {
                liveSpeechSocket.close();
            }
            liveSpeechSocket = null;
        }
        
        // Stop MediaRecorder
        if (liveMediaRecorder && liveMediaRecorder.state !== 'inactive') {
            liveMediaRecorder.stop();
            liveMediaRecorder = null;
        }
        
        // Stop Microphone tracks
        if (liveMediaStream) {
            liveMediaStream.getTracks().forEach(track => track.stop());
            liveMediaStream = null;
        }

        // Save transcript to history if not empty
        const finalContent = (liveSpeechFinal ? liveSpeechFinal.textContent : '') + ' ' + (liveSpeechInterim ? liveSpeechInterim.textContent : '');
        const trimmedContent = finalContent.trim();
        if (trimmedContent.length > 0) {
            saveLiveSpeechToHistory(trimmedContent);
        }
    }

    async function saveLiveSpeechToHistory(text) {
        try {
            const response = await fetch('/api/chats/live-speech', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text })
            });
            if (response.ok) {
                // Refresh recent chats to show the newly saved session
                await fetchRecentChats();
            }
        } catch (e) {
            console.error("Failed to save live speech history", e);
        }
    }

    // Actions Controls
    if (btnLiveSpeechCopy) {
        btnLiveSpeechCopy.addEventListener('click', () => {
            if (!liveSpeechFinal) return;
            const textToCopy = liveSpeechFinal.textContent.trim();
            if (!textToCopy) return alert("Nothing to copy!");
            
            navigator.clipboard.writeText(textToCopy);
            btnLiveSpeechCopy.innerHTML = '<i class="ph ph-check" style="color: #10b981;"></i> Copied!';
            setTimeout(() => {
                btnLiveSpeechCopy.innerHTML = '<i class="ph ph-copy"></i> Copy Text';
            }, 2000);
        });
    }

    if (btnLiveSpeechClear) {
        btnLiveSpeechClear.addEventListener('click', () => {
            if (confirm("Clear live dictation text?")) {
                if (liveSpeechFinal) liveSpeechFinal.textContent = '';
                if (liveSpeechInterim) liveSpeechInterim.textContent = '';
                if (liveSpeechPlaceholder) liveSpeechPlaceholder.style.display = 'block';
            }
        });
    }

    // High-End Word Document Generator for Live Speech Dictation
    if (btnLiveSpeechWord) {
        btnLiveSpeechWord.addEventListener('click', async () => {
            if (!liveSpeechFinal) return;
            const text = liveSpeechFinal.textContent.trim();
            if (!text) return alert("Nothing to export!");
            
            btnLiveSpeechWord.disabled = true;
            btnLiveSpeechWord.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Exporting...';
            
            try {
                if (typeof docx === 'undefined') {
                    throw new Error("Word document library is still loading. Please try again in a moment.");
                }
                
                const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;
                
                const doc = new Document({
                    sections: [{
                        properties: {},
                        children: [
                            new Paragraph({
                                heading: HeadingLevel.HEADING_1,
                                alignment: AlignmentType.CENTER,
                                spacing: { after: 200 },
                                children: [
                                    new TextRun({
                                        text: "Live Speech Dictation",
                                        bold: true,
                                        size: 32,
                                        font: "Inter",
                                        color: "1f2937"
                                    })
                                ]
                            }),
                            new Paragraph({
                                spacing: { before: 120, after: 120 },
                                children: [
                                    new TextRun({
                                        text: `Exported on: ${new Date().toLocaleString()}`,
                                        italics: true,
                                        size: 18,
                                        font: "Inter",
                                        color: "6b7280"
                                    })
                                ]
                            }),
                            new Paragraph({
                                spacing: { before: 240 },
                                children: [
                                    new TextRun({
                                        text: text,
                                        size: 24,
                                        font: "Inter",
                                        color: "374151"
                                    })
                                ]
                            })
                        ]
                    }]
                });
                
                const blob = await Packer.toBlob(doc);
                saveAs(blob, `live-speech-dictation-${Date.now()}.docx`);
                
            } catch (err) {
                console.error("Export Word failed:", err);
                alert(err.message);
            } finally {
                btnLiveSpeechWord.disabled = false;
                btnLiveSpeechWord.innerHTML = '<i class="ph ph-file-doc"></i> Download Word';
            }
        });
    }

    btnAddFile.addEventListener('click', () => { fileInput.click(); });
    
    if (btnRemoveAudio) {
        btnRemoveAudio.addEventListener('click', () => {
            if (activeUploadXHR) {
                activeUploadXHR.abort();
                activeUploadXHR = null;
            }
            stagedFile = null;
            stagedTranscriptText = '';
            stagedTranscriptTitle = '';
            isUploadingAudio = false;
            
            audioPlayerContainer.style.display = 'none';
            audioPlayer.src = '';
            
            // Re-enable inputs
            mainChatInput.disabled = false;
            mainChatInput.placeholder = "Ask Lilia GPT anything...";
            btnAddFile.disabled = false;
            if (btnRecord) btnRecord.disabled = false;
        });
    }

    // File Stage - Holds file in staging card (Upload happens on Send)
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            switchToTranscriptView();
            
            stagedFile = file;
            stagedTranscriptText = '';
            stagedTranscriptTitle = '';
            isUploadingAudio = false;
            
            // Re-initialize staged card status
            audioFileIcon.className = 'ph ph-music-note';
            audioFileIcon.style.color = 'var(--accent-blue)';
            document.getElementById('audioFileName').textContent = file.name;
            audioPlayerContainer.style.display = 'flex';
            stagingProgressWrapper.style.display = 'none'; // Keep hidden during staging
            
            fileInput.value = '';
        }
    });

    function showError(msg) {
        if (isUploadingAudio) {
            stagingStatusText.textContent = `Error: ${msg}`;
            stagingStatusText.style.color = '#ef4444';
            stagingProgressBarFill.style.backgroundColor = '#ef4444';
            stagingProgressBarFill.style.width = '100%';
            stagingProgressPercent.textContent = '';
        }
        progressTitle.textContent = 'Error Processing File';
        progressTitle.style.color = '#ef4444';
        progressStatus.textContent = msg;
        progressBar.classList.remove('indeterminate');
        progressBar.style.backgroundColor = '#ef4444';
        progressBar.style.width = '100%';
        progressPercent.textContent = '';
        if (statusIndicator) {
            statusIndicator.textContent = 'Error';
            statusIndicator.classList.remove('recording');
        }
    }

    // -----------------------------------------------------
    // Transcript Cells & AI Chat Cells
    // -----------------------------------------------------
    function createTranscriptCell(text, title, isFromLoad = false) {
        if (!text.trim()) return;

        const cell = document.createElement('div');
        cell.className = 'transcript-cell transcript-item';
        
        if (title) {
            const titleEl = document.createElement('div');
            titleEl.className = 'transcript-file-title';
            titleEl.style.fontWeight = '600';
            titleEl.style.fontSize = '0.85rem';
            titleEl.style.color = 'var(--accent-blue)';
            titleEl.style.marginBottom = '0.5rem';
            titleEl.style.display = 'flex';
            titleEl.style.alignItems = 'center';
            titleEl.style.gap = '0.35rem';
            titleEl.innerHTML = `<i class="ph ph-music-note"></i> ${title}`;
            cell.appendChild(titleEl);
        }
        
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
        
        const btnCopyTranscript = document.createElement('button');
        btnCopyTranscript.className = 'btn-cell-action';
        btnCopyTranscript.innerHTML = '<i class="ph ph-copy"></i> Copy Transcript';
        btnCopyTranscript.addEventListener('click', () => {
            navigator.clipboard.writeText(text);
            btnCopyTranscript.innerHTML = '<i class="ph ph-check" style="color: #10b981;"></i> Copied!';
            setTimeout(() => {
                btnCopyTranscript.innerHTML = '<i class="ph ph-copy"></i> Copy Transcript';
            }, 2000);
        });
        
        actions.appendChild(btnToggle);
        actions.appendChild(btnDownload);
        actions.appendChild(btnCopyTranscript);
        
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
        
        // Create premium top-bar header
        const topBar = document.createElement('div');
        topBar.className = 'cell-top-bar';
        
        const label = document.createElement('span');
        label.className = 'cell-label';
        if (role === 'user') {
            label.innerHTML = '<i class="ph ph-user"></i> You';
        } else {
            label.innerHTML = '<i class="ph ph-sparkle"></i> Lilia GPT';
        }
        
        const content = document.createElement('div');
        content.className = 'cell-content';
        
        const btnCopy = document.createElement('button');
        btnCopy.className = 'btn-copy-cell';
        btnCopy.innerHTML = '<i class="ph ph-copy"></i> Copy';
        btnCopy.addEventListener('click', () => {
            if (text.includes('typing-indicator')) return;
            const plainText = content.innerText || content.textContent;
            navigator.clipboard.writeText(plainText);
            btnCopy.innerHTML = '<i class="ph ph-check" style="color: #10b981;"></i> Copied!';
            setTimeout(() => {
                btnCopy.innerHTML = '<i class="ph ph-copy"></i> Copy';
            }, 2000);
        });
        
        topBar.appendChild(label);
        // Only show copy button if it's not a loading typing indicator
        if (!text.includes('typing-indicator')) {
            topBar.appendChild(btnCopy);
        }
        
        if (text.includes('typing-indicator')) {
            content.innerHTML = text;
        } else {
            content.innerHTML = text.replace(/\n/g, '<br>');
        }
        
        cell.appendChild(topBar);
        cell.appendChild(content);
        
        transcriptContainer.appendChild(cell);
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;

        if (!isFromLoad && !text.includes('typing-indicator')) {
            chatItems.push({ type: role, text });
            saveCurrentChatState();
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
        if (isUploadingAudio) return; // Prevent clicking send while still uploading!
        
        const text = mainChatInput.value.trim();
        if (!text && !stagedFile) return;
        
        switchToTranscriptView();
        
        // Auto-create chat session if we are on the home screen
        await ensureActiveChatId();
        
        if (stagedFile) {
            const fileToUpload = stagedFile;
            stagedFile = null; // Clear staging reference immediately
            
            isUploadingAudio = true;
            
            // Show staging progress wrapper inside card
            stagingProgressWrapper.style.display = 'flex';
            stagingStatusText.textContent = 'Uploading file to Server...';
            stagingStatusText.style.color = '#71717a';
            stagingProgressBarFill.style.backgroundColor = 'var(--accent-blue)';
            stagingProgressBarFill.style.width = '0%';
            stagingProgressPercent.textContent = '0%';
            
            // Disable interface elements to prevent duplicate submits / chatting while uploading
            mainChatInput.disabled = true;
            mainChatInput.placeholder = "Please wait, uploading your audio file...";
            btnAddFile.disabled = true;
            if (btnRecord) btnRecord.disabled = true;
            if (btnRemoveAudio) btnRemoveAudio.disabled = true;
            
            // Create user bubble if prompt was typed
            if (text) {
                createChatCell('user', text);
                chatHistory.push({ role: 'user', content: text });
                mainChatInput.value = '';
                if (chatTitle === 'New Chat') {
                    chatTitle = text.slice(0, 30) + (text.length > 30 ? '...' : '');
                }
            } else {
                if (chatTitle === 'New Chat') {
                    chatTitle = `Audio: ${fileToUpload.name.slice(0, 20)}`;
                }
            }
            
            // Build Multipart Form
            const formData = new FormData();
            formData.append('file', fileToUpload);
            formData.append('prompt', text);
            formData.append('chat_id', currentChatId || '');
            formData.append('history', JSON.stringify(chatHistory));
            
            activeUploadXHR = new XMLHttpRequest();
            
            activeUploadXHR.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    stagingProgressBarFill.style.width = percentComplete + '%';
                    stagingProgressPercent.textContent = percentComplete + '%';
                    if (percentComplete === 100) {
                        stagingStatusText.textContent = 'Processing file...';
                        stagingProgressBarFill.classList.add('indeterminate');
                        stagingProgressPercent.textContent = '';
                    }
                }
            });
            
            const enableInputs = () => {
                isUploadingAudio = false;
                mainChatInput.disabled = false;
                mainChatInput.placeholder = "Ask Lilia GPT anything...";
                btnAddFile.disabled = false;
                if (btnRecord) btnRecord.disabled = false;
                if (btnRemoveAudio) btnRemoveAudio.disabled = false;
                mainChatInput.focus();
                activeUploadXHR = null;
            };
            
            activeUploadXHR.addEventListener('load', () => {
                stagingProgressBarFill.classList.remove('indeterminate');
                
                if (activeUploadXHR.status >= 200 && activeUploadXHR.status < 300) {
                    try {
                        const data = JSON.parse(activeUploadXHR.responseText);
                        if (data.error) throw new Error(data.error);
                        
                        // Hide staging player
                        audioPlayerContainer.style.display = 'none';
                        
                        // If transcription was requested and returned:
                        if (data.transcript) {
                            createTranscriptCell(data.transcript, data.filename);
                        }
                        
                        // Display AI response only if user typed a prompt
                        if (text && text.trim() !== '') {
                            const loadingCell = createChatCell('assistant', '<div class="typing-indicator"><span></span><span></span><span></span></div>');
                            const contentDiv = loadingCell.querySelector('.cell-content');
                            const formattedReply = data.reply.replace(/\n/g, '<br>');
                            
                            typeWriterHTML(contentDiv, formattedReply, 12, () => {
                                // Dynamically append copy button now that text is loaded
                                const topBar = loadingCell.querySelector('.cell-top-bar');
                                if (topBar && !topBar.querySelector('.btn-copy-cell')) {
                                    const btnCopy = document.createElement('button');
                                    btnCopy.className = 'btn-copy-cell';
                                    btnCopy.innerHTML = '<i class="ph ph-copy"></i> Copy';
                                    btnCopy.addEventListener('click', () => {
                                        navigator.clipboard.writeText(data.reply);
                                        btnCopy.innerHTML = '<i class="ph ph-check" style="color: #10b981;"></i> Copied!';
                                        setTimeout(() => {
                                            btnCopy.innerHTML = '<i class="ph ph-copy"></i> Copy';
                                        }, 2000);
                                    });
                                    topBar.appendChild(btnCopy);
                                }
                                chatHistory.push({ role: 'assistant', content: data.reply });
                                chatItems.push({ type: 'ai', text: data.reply });
                                saveCurrentChatState();
                            });
                        } else {
                            saveCurrentChatState();
                        }
                        
                        enableInputs();
                        
                    } catch (err) {
                        showError(err.message);
                        enableInputs();
                    }
                } else {
                    let errMsg = `Server error (Status ${activeUploadXHR.status}).`;
                    try { errMsg = JSON.parse(activeUploadXHR.responseText).error || errMsg; } catch(e){}
                    showError(errMsg);
                    enableInputs();
                }
            });
            
            activeUploadXHR.addEventListener('error', () => {
                showError('Network error occurred during upload.');
                enableInputs();
            });
            
            activeUploadXHR.open('POST', '/chat_file', true);
            activeUploadXHR.send(formData);
            
        } else {
            await executeChatQuery(text);
        }
    }

    async function executeChatQuery(text) {
        let currentTranscript = '';
        const cells = transcriptContainer.querySelectorAll('.transcript-item .cell-content');
        cells.forEach(cell => {
            currentTranscript += cell.textContent + '\n\n';
        });
        if (finalTextContainer) currentTranscript += (finalTextContainer.innerText || '').trim() + " ";
        if (interimTextContainer) currentTranscript += (interimTextContainer.innerText || '').trim() + " ";
        if (typeof liveSpeechFinal !== 'undefined' && liveSpeechFinal) {
            currentTranscript += (liveSpeechFinal.textContent || '').trim() + " ";
        }
        if (typeof liveSpeechInterim !== 'undefined' && liveSpeechInterim) {
            currentTranscript += (liveSpeechInterim.textContent || '').trim();
        }
        currentTranscript = currentTranscript.trim();

        // Auto-create chat session if we are on the home screen
        await ensureActiveChatId();

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
                    chat_id: currentChatId,
                    transcript: currentTranscript,
                    messages: chatHistory
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Server error');
            }
            
            // If the server performed lazy transcription, render the cell timeline bubble
            if (data.transcript) {
                createTranscriptCell(data.transcript, data.filename);
            }
            
            const contentDiv = loadingCell.querySelector('.cell-content');
            const formattedReply = data.reply.replace(/\n/g, '<br>');
            
            // Modern typing effect word-by-word/token-by-token
            typeWriterHTML(contentDiv, formattedReply, 12, () => {
                // Dynamically append copy button now that text is loaded
                const topBar = loadingCell.querySelector('.cell-top-bar');
                if (topBar && !topBar.querySelector('.btn-copy-cell')) {
                    const btnCopy = document.createElement('button');
                    btnCopy.className = 'btn-copy-cell';
                    btnCopy.innerHTML = '<i class="ph ph-copy"></i> Copy';
                    btnCopy.addEventListener('click', () => {
                        navigator.clipboard.writeText(data.reply);
                        btnCopy.innerHTML = '<i class="ph ph-check" style="color: #10b981;"></i> Copied!';
                        setTimeout(() => {
                            btnCopy.innerHTML = '<i class="ph ph-copy"></i> Copy';
                        }, 2000);
                    });
                    topBar.appendChild(btnCopy);
                }
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
            if (finalTextContainer) finalTextContainer.innerHTML = '';
            if (interimTextContainer) interimTextContainer.innerHTML = '';
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
                if (finalTextContainer) finalTextContainer.innerHTML = '';
                if (interimTextContainer) interimTextContainer.innerHTML = '';
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
            const response = await fetch(`/api/chats/${chatId}?t=${Date.now()}`);
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
            if (finalTextContainer) finalTextContainer.innerHTML = '';
            if (interimTextContainer) interimTextContainer.innerHTML = '';
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
            const response = await fetch(`/api/chats?t=${Date.now()}`);
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
                a.style.background = c.id === currentChatId ? 'var(--hover-bg)' : 'transparent';
                
                const titleSpan = document.createElement('span');
                titleSpan.style.overflow = 'hidden';
                titleSpan.style.textOverflow = 'ellipsis';
                titleSpan.style.whiteSpace = 'nowrap';
                const iconClass = c.type === 'live_speech' ? 'ph ph-microphone' : 'ph ph-chat-circle';
                titleSpan.innerHTML = `<i class="${iconClass}" style="margin-right:0.4rem; font-size:1.1rem; color: #71717a;"></i> ${c.title}`;
                
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
        // Stop live speech if active
        if (isLiveSpeechRecording) stopLiveSpeechDictation();
        // Switch to dashboard
        switchToDashboardView();
        currentChatId = null;
        window.history.pushState(null, "", "/");
        // De-activate sidebar items
        const activeItems = recentChatsList.querySelectorAll('.sub-item');
        activeItems.forEach(item => {
            item.classList.remove('active');
            item.style.background = 'transparent';
        });
    });

    // Welcome message copy button
    const btnCopyWelcome = document.getElementById('btnCopyWelcome');
    if (btnCopyWelcome) {
        btnCopyWelcome.addEventListener('click', () => {
            const welcomeCell = document.getElementById('welcomeCell');
            const welcomeText = welcomeCell.querySelector('.cell-content').innerText;
            navigator.clipboard.writeText(welcomeText);
            btnCopyWelcome.innerHTML = '<i class="ph ph-check" style="color: #10b981;"></i> Copied!';
            setTimeout(() => {
                btnCopyWelcome.innerHTML = '<i class="ph ph-copy"></i> Copy';
            }, 2000);
        });
    }

    // Check dynamic routing on page load
    const pathParts = window.location.pathname.split('/');
    const chatIdFromUrl = pathParts[pathParts.length - 1];
    
    if (window.location.pathname === '/live-speech') {
        switchToLiveSpeechView();
        fetchRecentChats();
    } else if (chatIdFromUrl && chatIdFromUrl !== 'chat' && chatIdFromUrl !== '') {
        loadChat(chatIdFromUrl);
    } else {
        // Initialize by fetching lists, keep home screen visible until they make action
        fetchRecentChats();
    }
});
