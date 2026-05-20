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

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            if (isRecording) {
                toggleRecording(); // Stop recording if active
            }
            switchToTranscriptView();
            
            const fileUrl = URL.createObjectURL(file);
            audioPlayer.src = fileUrl;
            audioPlayerContainer.classList.remove('hidden');
            
            finalTranscript += `<br><span style="color: #3b82f6; font-size: 0.9em; font-weight: bold;">[System: Uploading ${file.name} to Python Server...]</span><br>`;
            finalTextContainer.innerHTML = finalTranscript;
            statusIndicator.textContent = 'Uploading & Transcribing...';
            statusIndicator.classList.add('recording');
            
            try {
                const formData = new FormData();
                formData.append('file', file);
                
                // Send the file to our new FastAPI backend
                const response = await fetch('/transcribe', {
                    method: 'POST',
                    body: formData
                });
                
                let data;
                try {
                    data = await response.json();
                } catch (err) {
                    throw new Error(`The server crashed or timed out (Status ${response.status}). Please check your Render Logs. This is usually caused by the server running out of memory (RAM) on the free tier.`);
                }
                
                if (!response.ok) {
                    throw new Error(data.error || 'Server error');
                }
                
                finalTranscript += `<br><br><span style="color: #10b981; font-size: 0.9em; font-weight: bold;">[Server Transcription Complete]</span><br>`;
                finalTranscript += data.text + "<br><br>";
                finalTextContainer.innerHTML = finalTranscript;
                statusIndicator.textContent = 'Ready';
                statusIndicator.classList.remove('recording');
                
            } catch (error) {
                finalTranscript += `<br><span style="color: #ef4444; font-size: 0.9em; font-weight: bold;">[Error from server: ${error.message}]</span><br><br>`;
                finalTextContainer.innerHTML = finalTranscript;
                statusIndicator.textContent = 'Error';
                statusIndicator.classList.remove('recording');
            }
            
            // Reset input so same file can be selected again
            fileInput.value = '';
        }
    });

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
});
