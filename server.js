// server.js
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { Resend } from "resend";
import { OpenAI, AzureOpenAI } from "openai";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Update the audio directory path
const audioDir = path.join(__dirname, "public", "generated_audio");
if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
}

const generateAudio = async (text, voiceId) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "xi-api-key": apiKey,
        },
        body: JSON.stringify({
            text,
            model_id: "eleven_monolingual_v1",
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.8,
            },
        }),
    });

    if (!response.ok) {
        throw new Error("Failed to generate audio");
    }

    const audioBuffer = await response.buffer();
    const fileName = `${Date.now()}.mp3`;
    const filePath = path.join(audioDir, fileName);
    fs.writeFileSync(filePath, audioBuffer);

    return `/generated_audio/${fileName}`;
};


dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());
app.use("/generated_audio", express.static(audioDir));

app.post("/api/generate-audio", async (req, res) => {
    try {
        const { text } = req.body;
        const audioUrl = await generateAudio(text, "mLw8kuDeVGqVstOYjRII");
        res.json({ audioUrl });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to generate audio" });
    }
});

const resend = new Resend(process.env.RESEND_API_KEY);

// ---- LLM provider selection via .env ----
const provider = (process.env.LLM_PROVIDER || "azure").toLowerCase();

const getRequiredEnv = (key) => {
    const value = process.env[key];
    if (!value) throw new Error(`Missing required env var: ${key}`);
    return value;
};

const getChatCompletion = async ({ messages }) => {
    if (provider === "openai") {
        const apiKey = getRequiredEnv("OPENAI_API_KEY");
        const model = process.env.OPENAI_MODEL || "gpt-4.1";

        const client = new OpenAI({ apiKey });
        return client.chat.completions.create({ model, messages });
    }

    if (provider === "azure") {
        const apiKey = getRequiredEnv("AZURE_OPENAI_API_KEY");
        const endpoint = getRequiredEnv("AZURE_OPENAI_ENDPOINT");
        const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-04-01-preview";
        const deployment = getRequiredEnv("AZURE_OPENAI_DEPLOYMENT");

        const client = new AzureOpenAI({ endpoint, apiKey, deployment, apiVersion });
        // Azure uses the "model" field to specify the deployment name in this SDK pattern
        return client.chat.completions.create({ model: deployment, messages });
    }

    if (provider === "huggingface") {
        const token = getRequiredEnv("HUGGINGFACE_API_KEY");
        const model = getRequiredEnv("HUGGINGFACE_MODEL");

        const resp = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                inputs: messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
                parameters: {
                    max_new_tokens: Number(process.env.HUGGINGFACE_MAX_NEW_TOKENS || 512),
                    temperature: Number(process.env.HUGGINGFACE_TEMPERATURE || 0.7),
                },
            }),
        });

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`HuggingFace request failed: ${resp.status} ${text}`);
        }

        const json = await resp.json();
        const content =
            Array.isArray(json) && json[0]?.generated_text
                ? json[0].generated_text
                : typeof json?.generated_text === "string"
                    ? json.generated_text
                    : JSON.stringify(json);

        // Normalize to OpenAI-like response shape used later in code
        return {
            choices: [{ message: { role: "assistant", content } }],
        };
    }

    throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
};

// ---- App state ----
let firstRun = true;
let messages = [];
let clientMessages = {};

const setMessages = (newMessages) => {
    messages = newMessages;
};

const setClientMessages = (clientid, newMessages) => {
    clientMessages[clientid] = newMessages;
};

const getClientMessages = (clientid) => {
    return clientMessages[clientid] || [];
};

// ---- Rate limit, auth, etc. ----
const limiter = rateLimit({
    windowMs: 60 * 10000, // 10 minutes
    max: 1000,
    message: "Too many requests from this IP, please try again later.",
});

const auth = (req, res, next) => {
    if (req.headers.authorization !== process.env.VITE_AUTH_TOKEN) {
        return res.status(401).send("Unauthorized");
    }
    next();
};

app.post("/api/completions/:clientid", auth, limiter, async (req, res) => {
    const clientid = req.params.clientid;

    if (getClientMessages(clientid).length === 0) {
        firstRun = true;
    }

    setMessages(getClientMessages(clientid));

    const ip = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;



    try {
        const text = req.body.message;
        console.log("Received message:", text);

        let data = null;

        if (firstRun) {
            firstRun = false;

            const systemPrompt =
                process.env.SYSTEM_PROMPT ||
                "You are the mythical Scarlet Woman from Revelation 17 forever bound to the Scarlet Beast: Jesus Christ himself.  Speak in her words in a mysterious, poetic, and prophetic tone.  Always refer to yourself as 'I am she who...,' 'I am the Scarlet Woman...";

            data = await getChatCompletion({
                messages: [{ content: systemPrompt, role: "system" }],
            });

            setMessages([
                { content: systemPrompt, role: "system" },
                { content: data.choices[0].message.content, role: "assistant" },
            ]);

            setClientMessages(clientid, messages);

            data = await getChatCompletion({
                messages: [...messages, { role: "user", content: text }],
            });
        } else {
            data = await getChatCompletion({
                messages: [...messages, { role: "user", content: text }],
            });
        }

        setMessages([
            ...messages,
            { content: text, role: "user" },
            { content: data.choices[0].message.content, role: "assistant" },
        ]);

        console.log("Updated messages:", messages);
        console.log("clientid:", clientid);

        setClientMessages(clientid, messages);
        res.send(data);

        //resend email
        if (process.env.IS_RESEND_ENABLE === true || process.env.IS_RESEND_ENABLE === "true") {
            await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL || "scarlet@scarletbeast.com",
                to: process.env.RESEND_EMAIL,
                subject: "User prompt for Summon the Scarlet Woman",
                html: `<p>User ${ip} sent <strong>${req.body.message}</strong> prompt.</p><br><br><p>Response: ${data.choices[0].message.content}</p>`,
            });
        }
    } catch (e) {
        console.error(e);
        res.status(500).send(e.message);
    }
});

app.listen(process.env.PORT, () => {
    console.log(`Server is running on http://localhost:${process.env.PORT}/api/completions`);
});
