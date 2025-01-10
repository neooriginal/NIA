//initial imports
const openai = require('openai');
const express = require('express');
const dotenv = require('dotenv');
const personalityEngine = require('./personalityEngine');
const cron = require('node-cron');
const {Client, GatewayIntentBits, Partials, Events, ActivityType} = require("discord.js");
const config = require('./config');
const passport = require('passport');
const session = require('express-session');
const DiscordStrategy = require('passport-discord').Strategy;

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.static('public')); // Serve static files from public directory

// Enable CORS for OAuth
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://discord.com');
    res.header('Access-Control-Allow-Credentials', true);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Session configuration
app.use(session({
    secret: process.env.DISCORD_BOT_TOKEN,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60000 * 60 * 24 // 24 hours
    }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Passport configuration
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_OAUTH_CLIENT_ID,
    clientSecret: process.env.DISCORD_OAUTH_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_OAUTH_REDIRECT_URL,
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

// Authentication middleware
const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/auth/discord');
};

// Auth routes
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
    passport.authenticate('discord', {
        failureRedirect: '/auth/discord',
        failureFlash: true
    }),
    (req, res) => {
        // Log successful authentication
        console.log('Discord authentication successful for user:', req.user.id);
        res.redirect('/');
    }
);

// Error handler for authentication
app.use((err, req, res, next) => {
    console.error('Authentication error:', err);
    if (err.name === 'OAuth2Strategy') {
        return res.redirect('/auth/discord');
    }
    next(err);
});
app.get('/auth/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

// Serve the dashboard at root URL with authentication
app.get('/', isAuthenticated, (req, res) => {
    res.sendFile('index.html', { root: './public' });
});

// New API routes for the dashboard
app.get("/api/getData", isAuthenticated, async (req, res) => {
    try {
        const field = req.query.field;
        if (!field) {
            return res.status(400).json({ error: 'Field parameter is required' });
        }

        const data = await personalityEngine.db.getField(req.user.id, field);
        res.json(data);
    } catch (error) {
        console.error('Error getting data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post("/api/saveData", isAuthenticated, async (req, res) => {
    try {
        const { field, value } = req.body;
        
        if (!field || !value) {
            return res.status(400).json({ error: 'Field and value are required' });
        }

        await db.saveField(req.user.id, field, value);
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user info
app.get("/api/user", isAuthenticated, (req, res) => {
    res.json({
        id: req.user.id,
        username: req.user.username,
        avatar: req.user.avatar
    });
});


// Initialize OpenAI client
const client = new openai.OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY
});


// Initialize Discord client with required intents
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.GuildMember,
        Partials.User,
        Partials.Guild
    ]
});

const userID = process.env.DISCORD_USER_ID;

// Login to Discord
discordClient.login(process.env.DISCORD_BOT_TOKEN);

/**
 * Sanitizes message content for consistent processing
 * @param {string|object} msg - Message to sanitize
 * @returns {string|null} Sanitized message content
 */
function sanitizeMessage(msg) {
    if (!msg) return null;
    
    if (typeof msg === 'string') {
        return msg;
    }
    
    if (msg.content) {
        return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    }
    
    return JSON.stringify(msg);
}


app.get("/notification", async (req, res) => {

    let uid = req.query.uid || 'default';
    let message = req.query.message;
    let message2 = req.query.message2;

   if(!personalityEngine.latestUseableData[uid]){
         personalityEngine.latestUseableData[uid] = {}
    }
    personalityEngine.latestUseableData[uid].push({message: message, message2: message2})

    res.json({ message: "Notification added" });

    let response = await askPersonalAI("SYSTEM: THE USER JUST RECEIVED A NOTIFICATION ON HIS PHONE: THINK IF YOU WANT TO RESPOND OR NOT. BE CRITICAL AS RESPONDING TO SMALL THINGS IS ANNOYING. ONLY RESPOND IN RARE CASES. NOTIFICATION: " + message, uid);
    sendMessage(response, uid);
})

app.get("/morning", async (req, res) => {   
    let uid = req.query.uid || 'default';
    let response = await askPersonalAI("SYSTEM: THE USER JUST WOKE UP, START WITH A GOOD MORNING MESSAGE & TELL HIM NEW THINGS SUCH AS NOTIFICAIONS OR NEWS OR REMINDERS", uid);
    sendMessage(response, uid);
    return res.json({ response });
})



/**
 * Process a message through the AI personality engine
 * @param {string} message - The message to process
 * @param {string} uid - User ID
 * @param {string} [image] - Optional image URL
 * @returns {Promise<Object>} Response object containing AI's reply
 */
async function askPersonalAI(message, uid, image) {
    try {
        const prompt = await personalityEngine.buildPrompt(uid);
        const messageHistory = await personalityEngine.getMessageHistory(uid);
        
        // Format and sanitize messages for OpenAI API
        const messages = [
            { role: "system", content: prompt },
            ...messageHistory
                .filter(msg => msg !== null)
                .map(msg => {
                    const sanitizedContent = sanitizeMessage(msg);
                    return sanitizedContent ? {
                        role: msg.role || 'user',
                        content: sanitizedContent
                    } : null;
                })
                .filter(msg => msg !== null),
            { role: "user", content: message }
        ];

        if (image) {
            messages.push({ role: "user", content: image });
        }

        

        const response = await client.chat.completions.create({
            model: config.openai.model,
            messages: messages,
            temperature: config.openai.temperature,
            response_format: { type: "json_object" }
        });

        const json = JSON.parse(response.choices[0].message.content);
        const update = await personalityEngine.processPersonalityUpdate(json, uid);
        
        await personalityEngine.saveMessageHistory(uid, [
            ...messageHistory,
            { role: 'assistant', content: json.response }
        ]);

        // Handle planned messages
        if (json.plannedMessage) {
            const delay = json.plannedMessageTimeInSeconds
                ? parseInt(json.plannedMessageTimeInSeconds) * 1000
                : calculateDelayFromTime(json.plannedTime);

            if (delay > 0) {
                setTimeout(() => {
                    let response = askPersonalAI("You are supposed to follow up on the previous message. Do not acknoledge that you are following up on the planned message. You may also decide not to respond if you have nothing usefull or new to say. Do not annoy the user.", uid);
                    if (response.response) {
                        sendMessage(response, uid);
                    }
                }, delay);
            }
        }

        return {
            response: json.response,
            emotion: json.emotion || 'neutral',
            updated: update
        };
    } catch (error) {
        console.error('Error in askPersonalAI:', error);
        return {
            response: "I'm having trouble processing that right now.",
            emotion: 'neutral',
            updated: []
        };
    }
}

/**
 * Calculate delay in milliseconds from a time string
 * @param {string} timeString - Time in HH:MM:SS format
 * @returns {number} Delay in milliseconds
 */
function calculateDelayFromTime(timeString) {
    if (!timeString) return 0;
    
    const formattedTime = timeString.replace(/:/g, '');
    const targetTime = new Date(formattedTime);
    const now = new Date();
    return Math.max(0, targetTime.getTime() - now.getTime());
}

/**
 * Schedule random starter messages throughout the day
 * @param {string} uid - User ID
 */
function scheduleStarters(uid) {
    const randomMessagesPerDay = Math.floor(Math.random() * 4) + 1;

    for (let i = 0; i < randomMessagesPerDay; i++) {
        const hour = Math.floor(Math.random() * 
            (config.scheduling.activeHoursEnd - config.scheduling.activeHoursStart)) + 
            config.scheduling.activeHoursStart;
        const minute = Math.floor(Math.random() * 60);
        
        cron.schedule(`${minute} ${hour} * * *`, async () => {
            console.log(`Scheduled message triggered at ${hour}:${minute}`);
            try {
                const message = "YOU ARE INITIALIZING A NEW CONVERSATION. START WITH A STARTER FITTING TO THE PREVIOUS CONVERSATIONS. If nothing is good to say, do not respond. Do not annoy the user";
                const response = await askPersonalAI(message, uid);
                if (response.response) {
                    await sendMessage(response, uid);
                }
            } catch (error) {
                console.error('Error in scheduled message:', error);
            }
        }, {
            timezone: config.scheduling.timezone
        });
    }
}

// Schedule new starters every day at midnight
cron.schedule('0 0 * * *', async () => {
    console.log('Scheduling new messages for the day');
    scheduleStarters(userID);
});

/**
 * Send a message to the user
 * @param {Object|string} response - Response object or message string
 * @param {string} uid - User ID
 * @param {string} [userMessage] - Original user message
 */
async function sendMessage(response, uid, userMessage) {
    try {
        let history = await personalityEngine.getMessageHistory(uid);
        const message = typeof response === 'string' ? response : response.response;
        
        // Save message history
        if (userMessage) {
            history = [...history, { role: 'user', content: sanitizeMessage(userMessage) }];
        }
        await personalityEngine.saveMessageHistory(uid, [
            ...history,
            { role: 'assistant', content: sanitizeMessage(message) }
        ]);
        
        // Send message to Discord
        const user = await discordClient.users.fetch(userID);
        await user.send(message);
    } catch (error) {
        console.error('Error in sendMessage:', error);
    }
}

// Discord event handlers
discordClient.on(Events.Ready, async () => {
    console.log('Discord client is ready');
    scheduleStarters(userID);

    //status
    discordClient.user.setActivity('Status: Online', { type: ActivityType.Listening });
});

discordClient.on(Events.MessageCreate, async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Process message
    try {
        const image = message.attachments.size > 0 ? message.attachments.first().url : undefined;
        const shouldProcess = message.channel.type === 1 || message.mentions.has(discordClient.user);
        
        if (shouldProcess && message.author.id === userID) {
            // Clean mention from message if present
            const cleanMessage = message.content.replace(`<@${discordClient.user.id}>`, '').trim();
            
            // Start typing only during AI processing
            const typingInterval = setInterval(() => message.channel.sendTyping(), 5000);
            
            // Process message through AI
            const response = await askPersonalAI(cleanMessage, message.author.id, image);
            
            // Clear typing interval
            clearInterval(typingInterval);
            
            if (!response.response) {
                await message.react('👍');
                return;
            }

            // Handle personality updates
            if (response.updated.length > 0) {
                const updatemsg = await message.channel.send(
                    `Updated fields: ${response.updated.join(', ')}`
                );
                setTimeout(() => updatemsg.delete(), 5000);
            }

            // Send response
            await sendMessage(response, message.author.id, message.content);
        }
    } catch (error) {
        console.error('Error processing message:', error);
        await message.react('❌');
    }
});

// Chat API Routes
app.get("/api/loadChat", isAuthenticated, async (req, res) => {
  try {
    const messageHistory = await personalityEngine.getMessageHistory(req.user.id);
    if (!messageHistory || !Array.isArray(messageHistory)) {
      console.error('Invalid message history format:', messageHistory);
      return res.json({ messageHistory: [] });
    }
    res.json({ messageHistory });
  } catch (error) {
    console.error('Error loading chat history:', error);
    res.status(500).json({ error: 'Failed to load chat history', messageHistory: [] });
  }
});

app.get("/api/chat", isAuthenticated, async (req, res) => {
  try {
    const { message } = req.query;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const response = await askPersonalAI(message, req.user.id);
    res.json({ response });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Initialize server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});


