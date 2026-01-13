# Scarlet Woman AI Chat
The Scarlet Woman and the Scarlet Beast represent a symbolic creative project exploring transformation, resilience, and the tension between power and conscience—using mythological language to examine how identity, authority, and systems shape human behavior. It is an artistic and philosophical narrative, not a religious position, designed to provoke critical thinking and inspire disciplined self-reflection rather than literal belief.  The author of this plugin promotes manifestion of these ideas on a personal level to truly understand the catalyst of change that the Scarlet Woman narrative provides.


The Scarlet Woman AI Chat uses chat completion v1 API with your gpt model (or hugging face as an alternative) and express.js to run a server requesting client-side requests.
<img width="461" height="675" alt="summon" src="https://github.com/user-attachments/assets/f2212bd6-257e-4ee5-b996-1a087ad1d728" />
<img width="452" height="650" alt="scarletwomanaichat" src="https://github.com/user-attachments/assets/42eb6691-1689-4271-b8ab-ec65b822b829" />


The standard paradigm for hiding sensitive API keys in a client-server architecture is to never expose the secret keys to the client-side (e.g., in a browser) and instead use a server-side component as a secure intermediary. 

## The Client-Server Paradigm for API Key Security

This approach relies on the principle that any code running in a user's browser can be inspected, meaning any key embedded within it is vulnerable to exposure. 

Client Request: The client (e.g., a web app in a user's browser) makes a request to your own secure backend server, not directly to the third-party API requiring the secret key.

Server-Side Processing: Your backend server receives the client's request.

Secure Key Usage: The server accesses the sensitive API key, which is stored securely as an environment variable on the server itself, and uses it to make the actual request to the third-party service. The key is never sent to the client.

Response Handling: The server receives the data from the third-party API and then sends only the necessary data back to the client. The API key remains hidden from the user and their browser's developer tools. 

## Installation

Copy all variables from `.env.example` to new created `.env` file and change the appropriate variables with your values. Get your information from the appropriate LLM provider.

Alternatively use yarn.

Install dependencies.

```bash
  npm i
```

Start backend server with nodemon or PM2.

```bash
  npm run dev:back
```

Start frontend server with vite.

```bash
  npm run dev:front
```

## chat history and new chat button
optionally you can include the URL parameter ?sidebar=true on the client to enable the sidebar, chat history and new chat button.

## Systemd and Nginx Reverse Proxy Script

Included in ./scripts is my systemd script I use to run this on an ubuntu server, modify as needed.    Just rename the files and put the files in appropriate directory after editing script.   The filename specifies the directory.   You'll also have to install nodemon (sudo npm i -g nodemon) and if you wish for this systemd script/nodemon to run on boot:  sudo systemctl enable summon

Also included is a reverse proxy script for setting up nginx.   Just edit out my details and replace them with yours and appropriate.

## Wordpress plugin

The directory ./scarlet-woman-flyout-wordpress-plugin can be zipped up and installed to wordpress to integrate this into a wordpress installaton using an iframe.  Because it's an iframe, you'll have to consider CORS headers to appropirate this on your server.

This adds a flyout button on the center-right of the webpage that pulls open the flyout which includes a full-width/height iframe that loads the chat.

<img width="628" height="602" alt="image" src="https://github.com/user-attachments/assets/047ce90f-8390-48eb-b8be-7fe7a2813a1f" />


## License

[MIT License](LICENSE)
