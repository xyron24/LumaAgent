// Initialize Lucide Icons
lucide.createIcons();

const textarea = document.getElementById('chat-textarea');

// Auto-resize logic
textarea.addEventListener('input', function() {
    // Reset height to calculate scrollHeight correctly
    this.style.height = 'auto';
    
    // Calculate new height, bounded by min and max
    const minHeight = 48; // Note: padding and line-height might require adjustments depending on the exact box model, but setting inline style directly
    let targetHeight = this.scrollHeight;
    
    if (targetHeight < minHeight) {
        targetHeight = minHeight;
    }
    
    const maxHeight = 150;
    const newHeight = Math.min(targetHeight, maxHeight);
    this.style.height = newHeight + 'px';
    
    // Enable scroll if we hit the max height
    if (targetHeight > maxHeight) {
        this.style.overflowY = 'auto';
    } else {
        this.style.overflowY = 'hidden';
    }
});

// Set initial height to minimum 48px
textarea.style.height = '48px';

const sendBtn = document.querySelector('.send-btn');
const messagesContainer = document.getElementById('chat-messages');
const container = document.querySelector('.container');

async function sendMessage() {
    const text = textarea.value.trim();
    if (!text) return;

    // Switch layout to chat active mode
    container.classList.add('chat-active');

    // Add user message to UI
    addMessage(text, 'user');
    
    // Clear textarea
    textarea.value = '';
    textarea.style.height = '48px';

    try {
        // Send to backend
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: text })
        });
        
        const data = await response.json();
        if (data.error) {
            addMessage('Error: ' + data.error, 'bot');
        } else {
            addMessage(data.response, 'bot');
        }
    } catch (err) {
        addMessage('Error connecting to the backend. Is the server running?', 'bot');
    }
}

function addMessage(text, sender) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('msg', `msg-${sender}`);
    
    // Replace newlines with <br> to preserve formatting in plain text
    msgDiv.innerHTML = text.replace(/\n/g, '<br>');
    
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Event Listeners for sending message
sendBtn.addEventListener('click', sendMessage);

textarea.addEventListener('keydown', (e) => {
    // Send on Enter without Shift
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});
