
function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (char) => map[char]);
}


export function generateMaintenanceHTML(
    title: string | null,
    message: string | null,
    estimatedTime: string | null
): string {
    const safeTitle = escapeHtml(title || 'Service Temporarily Unavailable');
    const safeMessage = escapeHtml(message || 'We are currently experiencing technical difficulties. Please check back soon.');
    const safeEstimatedTime = estimatedTime ? escapeHtml(estimatedTime) : null;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>${safeTitle}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #fff;
            color: #000;
            padding: 1rem;
            line-height: 1.6;
        }
        .container {
            text-align: center;
            padding: 3rem 2rem;
            max-width: 600px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .icon {
            font-size: 4rem;
            margin-bottom: 1.5rem;
            animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }
        h1 {
            font-size: 2.5rem;
            margin-bottom: 1rem;
            font-weight: 700;
            line-height: 1.2;
        }
        .message {
            font-size: 1.2rem;
            margin-bottom: 1rem;
            opacity: 0.95;
        }
        .time {
            margin-top: 1.5rem;
            padding: 1rem;
            background: rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            font-size: 1rem;
            font-weight: 500;
        }
        @media (max-width: 640px) {
            h1 { font-size: 2rem; }
            .message { font-size: 1rem; }
            .container { padding: 2rem 1.5rem; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">🔧</div>
        <h1>${safeTitle}</h1>
        <p class="message">${safeMessage}</p>
        ${safeEstimatedTime ?
            `<div class="time">
                <strong>Estimated completion:</strong><br>
                ${safeEstimatedTime}
            </div>`
            : ''}
    </div>
</body>
</html>`;
}