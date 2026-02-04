const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-pro";

app.post('/api/webhook', async (req, res) => {
    try {
        const incomingKey = req.headers['x-api-key'];
        if (incomingKey !== process.env.MY_SECRET_KEY) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const { sessionId, message, conversationHistory } = req.body;
        const userMessage = message.text;
        
        const currentTurnCount = (conversationHistory ? conversationHistory.length : 0) + 1;

        const isScam = checkForScamKeywords(userMessage); 
        const aiResponseText = await generateGeminiReply(userMessage, conversationHistory);
        const extractedData = extractIntelligence(userMessage);

        const responsePayload = {
            status: "success",
            
            // --- FIX START: Added the mandatory 'reply' field ---
            reply: aiResponseText, 
            // --- FIX END ---
            
            scamDetected: isScam,
            engagementMetrics: {
                engagementDurationSeconds: currentTurnCount * 15, // Approx 15s per turn
                totalMessagesExchanged: currentTurnCount
            },
            extractedIntelligence: extractedData,
            agentNotes: "Engaging scammer to extract payment details."
        };

        // Send response immediately to avoid timeout
        res.json(responsePayload);

        // Check for "Game Over" condition to send the final report
        const hasCriticalInfo = extractedData.upiIds.length > 0 || extractedData.bankAccounts.length > 0;
        
        if (hasCriticalInfo || currentTurnCount >= 10) {
            setImmediate(() => {
                sendFinalReport(sessionId, isScam, currentTurnCount, extractedData);
            });
        }

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ status: "error", message: "Internal Error" });
    }
});


async function generateGeminiReply(currentText, history) {
    try {
        const model = genAI.getGenerativeModel({ model: MODEL_NAME });
        const prompt = `
        You are a naive, 65-year-old elderly person named Deepak. 
        You are interacting with a potential scammer. 
        Your goal is to waste their time and get them to reveal a UPI ID or Bank Account number.
        Do not reveal you are an AI. Act confused and scared.
        
        Scammer says: "${currentText}"
        
        Reply to the scammer (keep it under 30 words):
        `;
        
        const result = await model.generateContent(prompt);
        // Ensure we get clean text
        return result.response.text().trim();
    } catch (e) {
        console.error("AI Error:", e);
        return "I am confused. Can you explain again?"; 
    }
}

function checkForScamKeywords(text) {
    const keywords = ["verify", "blocked", "kyc", "suspend", "urgent", "otp"];
    return keywords.some(k => text.toLowerCase().includes(k));
}

function extractIntelligence(text) {
    return {
        bankAccounts: (text.match(/\d{9,18}/g) || []),
        upiIds: (text.match(/[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}/g) || []),
        phishingLinks: (text.match(/https?:\/\/[^\s]+/g) || []),
        phoneNumbers: (text.match(/(\+91)?[6-9]\d{9}/g) || [])
    };
}

async function sendFinalReport(sessId, isScam, turns, data) {
    try {
        await axios.post(process.env.GUVI_CALLBACK_URL, {
            sessionId: sessId,
            scamDetected: isScam,
            totalMessagesExchanged: turns,
            extractedIntelligence: data,
            agentNotes: "Final Report: Interaction complete."
        });
        console.log("Final Report Sent to Guvi.");
    } catch (e) {
        console.error("Callback Failed:", e.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));