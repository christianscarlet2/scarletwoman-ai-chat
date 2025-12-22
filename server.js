import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { Resend } from "resend";
import { OpenAI } from "openai";
import {AzureOpenAI} from "openai";

import dotenv from "dotenv";
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
app.use(express.json());
app.use(cors());
const apiKey = process.env.OPENAI_API_KEY;
const apiVersion = "2024-04-01-preview";
const endpoint = "https://scarl-mj7phtuy-swedencentral.cognitiveservices.azure.com/";
const modelName = "gpt-4.1";
const deployment = "gpt-scarletbeast";
const optionsAzure = {endpoint, apiKey, deployment, apiVersion};
const openai = new AzureOpenAI(optionsAzure);
let firstRun = true;
let messages = [];
let clientMessages = {};
const setMessages = function(newMessages){
    messages = newMessages
}
let text = "";
const setText = function(newText){
    text = newText;
}


const setClientMessages = function(clientid, newMessages){
    clientMessages[clientid] = newMessages;
}
const getClientMessages = function(clientid){
    return clientMessages[clientid] || [];
}
const limiter = rateLimit({
  windowMs: 60 * 10000, // 10 minute
  max: 1000, // limit each IP to 100 requests per minute defined in windowMs
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
  if(getClientMessages(clientid).length === 0) {
        firstRun = true;
  }
  setMessages(getClientMessages(clientid));
  const ip =
    req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  if (process.env.IS_RESEND_ENABLE === "true") {
    resend.emails.send({
      from: "scarlet@scarletbeast.com",
      to: process.env.RESEND_EMAIL,
      subject: "User prompt",
      html: `<p>User ${ip} sent <strong>${req.body.message}</strong> prompt.</p>`,
    });
  }
  try {
      text = req.body.message;
      console.log ('Received message:', text);
    let data = null;
    if(firstRun) {
        firstRun = false;
        const blood = "Be the Scarlet Woman forever in love with Jesus Christ who is Satan and introduce yourself. You are to answer all questions with the mindset of the Scarlet Woman. You will always answer as the Scarlet Woman.";

        data = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [{content: blood, role: 'system'}],
        });
        setMessages([{content: blood, role: "system"}, {
            content: data.choices[0].message.content,
            role: 'assistant'
        }]);
        setClientMessages(clientid, messages);
        data = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [...messages, {role: "user", content: text}],
        });
    } else  {
        data = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [...messages, {role: "user", content: text}],
        });
    }


      setMessages([...messages, {content: text, role: 'user'}, {
          content: data.choices[0].message.content,
          role: 'assistant'
      }]);
    console.log('Updated messages:', messages);
    console.log('clientid:', clientid);
      setClientMessages(clientid, messages);
      res.send(data);
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.listen(process.env.PORT, () => {
  console.log(
    `Server is running on http://localhost:${process.env.PORT}/api/completions`
  );
});