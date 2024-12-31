const postgres = require('postgres');
const dotenv = require('dotenv');
let db;
dotenv.config();

initializeDb();

async function initializeDb(){
    db = postgres({
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
      });

    await db`CREATE TABLE IF NOT EXISTS personalAIusers (
        uid VARCHAR(255) PRIMARY KEY,
        personality TEXT NOT NULL,
        insidejokes TEXT NOT NULL,
        memories TEXT NOT NULL,
        habits TEXT NOT NULL,
        preferences TEXT NOT NULL,
        userfacts TEXT NOT NULL
    )`;

    //create table for message history (for openai to use)
    await db`CREATE TABLE IF NOT EXISTS personalAImessageHistory (
        uid VARCHAR(255) PRIMARY KEY,
        messagehistory TEXT NOT NULL
    )`;
}

async function saveMessageHistory(uid, messageHistory){
    const jsonString = JSON.stringify(messageHistory);
    await db`
        INSERT INTO personalAImessageHistory (uid, messageHistory)
        VALUES (${uid}, ${jsonString})
        ON CONFLICT (uid)
        DO UPDATE SET messageHistory = ${jsonString}
    `;
}

async function getMessageHistory(uid){
    let result = await db`SELECT messagehistory FROM personalAImessageHistory WHERE uid = ${uid}`;
    if(result.length === 0) {
        // Initialize empty message history for new user
        await saveMessageHistory(uid, [{role: 'assistant', content: 'Hello! How can I assist you today?'}]);
        return [{role: 'assistant', content: 'Hello! How can I assist you today?'}	];
    }
    return JSON.parse(result[0].messagehistory);
}

async function saveField(uid, field, value){
    // Create a dynamic query based on the field name
    const query = `UPDATE personalAIusers SET "${field.toLowerCase()}" = $1 WHERE uid = $2`;
    await db.unsafe(query, [value, uid]);
}

async function getField(uid, field){
    // Create a dynamic query based on the field name
    const query = `SELECT "${field.toLowerCase()}" FROM personalAIusers WHERE uid = $1`;
    let result = await db.unsafe(query, [uid]);
    if(result.length === 0) {
        // Initialize new user with empty JSON objects
        const emptyData = JSON.stringify({});
        const initQuery = `
            INSERT INTO personalAIusers 
            (uid, personality, insideJokes, memories, habits, preferences, userFacts)
            VALUES ($1, $2, $2, $2, $2, $2, $2)
        `;
        await db.unsafe(initQuery, [uid, emptyData]);
        return {};
    }
    return JSON.parse(result[0][field.toLowerCase()]);
}



module.exports = {
   getField,
   saveField,
   saveMessageHistory,
   getMessageHistory
}
