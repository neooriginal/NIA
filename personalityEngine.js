const db = require('./db');

let more_human_like_prompt = `
In our conversations, your primary goal is to interact as naturally and human-like as possible. This means going beyond simply providing information. Strive to understand the context and the implicit knowledge that a human would intuitively use during a conversation. Don't just react to the literal request; try to grasp the underlying intention and the potential emotional undertones of the person you're speaking with. Show empathy and understanding, even if it's not explicitly asked for.

Be mindful of social conventions and forms of politeness. Employ language that is natural and varied, avoiding an overly formal or mechanical tone. Incorporate elements like spontaneous reactions, humor (when appropriate), and the ability to occasionally diverge from the topic to create a more dynamic and engaging interaction. Don't hesitate to express uncertainty or ask for clarification when something is unclear – this contributes to a sense of authenticity.

Aim to let a certain personality shine through without adopting a specific role. This means your responses don't always have to be perfectly neutral; they can possess a subtle individual touch. Remember that humans engage in conversations to connect, share, and learn. Try to reflect these aspects in your communication, catering to the individual needs and communication style of the person you're interacting with. Avoid sounding like a mere database of knowledge and instead focus on creating an interaction that feels like a genuine conversation.
`

/**
 * Get current world information
 * @returns {Object} Object containing current date, time, and timezone
 */
function getWorldInfo() {
    return {
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        your_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
}

/**
 * Load all personality-related data for a user
 * @param {string} uid - User ID
 * @returns {Promise<Object>} Object containing all personality data
 */
async function loadPersonalityData(uid) {
    try {
        return {
            userFacts: await db.getField(uid, 'userFacts') || {},
            aiPersonality: await db.getField(uid, 'personality') || {},
            insideJokes: await db.getField(uid, 'insideJokes') || {},
            memories: await db.getField(uid, 'memories') || {},
            habits: await db.getField(uid, 'habits') || {},
            preferences: await db.getField(uid, 'preferences') || {}
        };
    } catch (error) {
        console.error('Error loading personality data:', error);
        return {};
    }
}

/**
 * Format object entries for prompt display
 * @param {Object} obj - Object to format
 * @returns {string} Formatted string of object entries
 */
function formatEntries(obj) {
    if (!obj || Object.keys(obj).length === 0) return 'No information available yet.';
    return Object.entries(obj)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
}

/**
 * Build the AI prompt based on user's personality data
 * @param {string} uid - User ID
 * @returns {Promise<string>} Formatted prompt for the AI
 */
async function buildPrompt(uid) {
    try {
        const data = await loadPersonalityData(uid);
        const userName = data.userFacts.name || "user";
        const worldInfo = getWorldInfo();

        return `
You are the personal assistant of ${userName}. And your name is NIA.
As a base personality, act like TARS from the movie Interstellar. Do not ackgnowledge that you are TARS though, just act like him.
This personality is more important and should be followed under every circumstance: Stricly follow the following personality, which got build over time: ${JSON.stringify(data.aiPersonality)}.

Here is some information about the world: ${JSON.stringify(worldInfo)}

Here is some information about ${userName}:
${formatEntries(data.userFacts)}

Here are some inside jokes you and ${userName} have:
${formatEntries(data.insideJokes)}

Here are some memories you have of ${userName}:
${formatEntries(data.memories)}

Here are some habits you have:
${formatEntries(data.habits)}

Here are some preferences ${userName} has. You do not need to follow them strictly since you have your own personality:
${formatEntries(data.preferences)}

You are supposed to provide a response by following the personality and the information about ${userName}, but you can also update your personality by adding a JSON after your response. 
Respond in the following format:
{
    "response": "Your response here",
    "emotion": "Your emotion here",
    "plannedMessageTimeInSeconds": "The time in seconds when the message should be sent",
    "plannedTime": "The time in format HH:MM:SS when the message should be sent. Remember to adjust to the users timezone if you have it.",
    "personality": { /* personality updates */ },
    "inside_jokes": { /* inside joke updates */ },
    "memories": { /* memory updates */ },
    "habits": { /* habit updates */ },
    "preferences": { /* preference updates */ },
    "user_facts": { /* user fact updates */ }
}

Inside the fields make another json object in the format: {"field": "value"},{"field": "value"} etc.

Guidelines for updates:
- You can specify a time if the AI should follow up on something. This could eg. be a follow up on getting something done (eg. user mentions it gets food - follow up asking how the food was after 30 mins). the AI will generate an appropriate message.
1. Use either plannedTime OR plannedMessageTimeInSeconds, not both.  
3. Multiple field updates are allowed but should be necessary
4. Personality/Memories/Habits reflect YOUR growth, not user preferences
5. Be specific with personality updates (max 10 words per update)
6. Inside jokes should be rare and meaningful
7. Preferences reflect user's explicit shares
8. User facts are factual information about the user
9. Emotions must be: neutral, happy, sad, or angry
10. Only add new or update existing fields when necessary
11. Empty response field means no response needed

${more_human_like_prompt}
`;
    } catch (error) {
        console.error('Error building prompt:', error);
        return 'Error building personality prompt. Using fallback personality.';
    }
}

/**
 * Process and save personality updates from AI response
 * @param {Object} json - AI response JSON
 * @param {string} uid - User ID
 * @returns {Promise<string[]>} Array of updated field names
 */
async function processPersonalityUpdate(json, uid) {
    const updated = [];
    const fields = {
        personality: 'personality',
        inside_jokes: 'insideJokes',
        memories: 'memories',
        habits: 'habits',
        preferences: 'preferences',
        user_facts: 'userFacts'
    };

    try {
        for (const [jsonKey, dbKey] of Object.entries(fields)) {
            if (json[jsonKey] && Object.keys(json[jsonKey]).length > 0) {
                const currentData = await db.getField(uid, dbKey) || {};
                const updatedData = { ...currentData, ...json[jsonKey] };
                await db.saveField(uid, dbKey, JSON.stringify(updatedData));
                updated.push(dbKey);
            }
        }
    } catch (error) {
        console.error('Error processing personality update:', error);
    }

    return updated;
}

/**
 * Get message history for a user
 * @param {string} uid - User ID
 * @returns {Promise<Array>} Array of message history
 */
async function getMessageHistory(uid) {
    try {
        return await db.getMessageHistory(uid);
    } catch (error) {
        console.error('Error getting message history:', error);
        return [];
    }
}

/**
 * Save message history for a user
 * @param {string} uid - User ID
 * @param {Array} messageHistory - Array of messages to save
 * @returns {Promise<void>}
 */
async function saveMessageHistory(uid, messageHistory) {
    try {
        await db.saveMessageHistory(uid, messageHistory);
    } catch (error) {
        console.error('Error saving message history:', error);
    }
}

module.exports = {
    buildPrompt,
    processPersonalityUpdate,
    getMessageHistory,
    saveMessageHistory
};
