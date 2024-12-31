/**
 * Configuration settings for the AI Personality Bot
 */
module.exports = {
    // OpenAI API Configuration
    openai: {
        model: "gpt-4o",        // The OpenAI model to use for responses
        temperature: 0.7,       // Controls randomness in responses (0 = deterministic, 1 = creative)
    },

    // Message Scheduling Configuration
    scheduling: {
        timezone: 'UTC',        // Timezone for scheduled messages
        activeHoursStart: 8,    // Start hour for sending messages (24h format)
        activeHoursEnd: 22,     // End hour for sending messages (24h format)
        minTimeBetweenMessages: 3600000  // Minimum milliseconds between random messages
    }
}; 