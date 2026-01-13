#!/bin/bash
# Your custom commands go here.
# Example:
/usr/bin/sudo su - bryan
source /home/bryan/.bashrc
cd /var/www/scarletwoman-ai-chat
echo "Service is running"
/usr/bin/sudo /usr/local/bin/nodemon /var/www/scarletwoman-ai-chat/server.js
# Keep the script running if it's meant to be a long-running service, e.g., with a while loop or by running your application directly.
